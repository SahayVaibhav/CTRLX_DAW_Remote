import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { KeyPressInputEvent, RemoteInputEvent } from "@ctrlx/shared-protocol";

const execFileAsync = promisify(execFile);

type DisplayBounds = {
  width: number;
  height: number;
  x: number;
  y: number;
};

let pendingAbsoluteMove: { x: number; y: number; bounds: DisplayBounds } | null = null;
let pendingRelativeMove: { deltaX: number; deltaY: number; bounds: DisplayBounds } | null = null;
let movePumpActive = false;

function clampNormalized(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function screenPoint(event: { x: number; y: number }, bounds: DisplayBounds): { x: number; y: number } {
  return {
    x: bounds.x + clampNormalized(event.x) * bounds.width,
    y: bounds.y + clampNormalized(event.y) * bounds.height
  };
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function modifiersForAppleScript(event: KeyPressInputEvent): string[] {
  const modifiers: string[] = [];
  if (event.metaKey) {
    modifiers.push("command down");
  }
  if (event.ctrlKey) {
    modifiers.push("control down");
  }
  if (event.altKey) {
    modifiers.push("option down");
  }
  if (event.shiftKey) {
    modifiers.push("shift down");
  }
  return modifiers;
}

function specialKeyCode(code: string): number | null {
  const map: Record<string, number> = {
    Space: 49,
    Enter: 36,
    NumpadEnter: 76,
    Tab: 48,
    Backspace: 51,
    Escape: 53,
    ArrowLeft: 123,
    ArrowRight: 124,
    ArrowDown: 125,
    ArrowUp: 126,
    Delete: 117
  };

  return map[code] ?? null;
}

async function runSwift(code: string): Promise<void> {
  await execFileAsync("swift", ["-e", code]);
}

async function moveMouse(x: number, y: number): Promise<void> {
  await runSwift(`
import Cocoa
import CoreGraphics
let point = CGPoint(x: ${x}, y: ${y})
if let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) {
  event.post(tap: .cghidEventTap)
}
`);
}

async function moveMouseRelative(deltaX: number, deltaY: number, bounds: DisplayBounds): Promise<void> {
  await runSwift(`
import Cocoa
import CoreGraphics

let currentPoint = CGEvent(source: nil)?.location ?? CGPoint(x: ${bounds.x + bounds.width / 2}, y: ${bounds.y + bounds.height / 2})
var nextX = currentPoint.x + CGFloat(${deltaX})
var nextY = currentPoint.y + CGFloat(${deltaY})

nextX = min(CGFloat(${bounds.x + bounds.width - 1}), max(CGFloat(${bounds.x}), nextX))
nextY = min(CGFloat(${bounds.y + bounds.height - 1}), max(CGFloat(${bounds.y}), nextY))

let point = CGPoint(x: nextX, y: nextY)
if let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) {
  event.post(tap: .cghidEventTap)
}
`);
}

async function pumpMouseMoves(): Promise<void> {
  if (movePumpActive) {
    return;
  }

  movePumpActive = true;

  try {
    while (pendingAbsoluteMove || pendingRelativeMove) {
      if (pendingAbsoluteMove) {
        const move = pendingAbsoluteMove;
        pendingAbsoluteMove = null;
        const point = screenPoint(move, move.bounds);
        await moveMouse(point.x, point.y);
        continue;
      }

      if (pendingRelativeMove) {
        const move = pendingRelativeMove;
        pendingRelativeMove = null;
        const sensitivity = 1.2;
        await moveMouseRelative(move.deltaX * sensitivity, move.deltaY * sensitivity, move.bounds);
      }
    }
  } finally {
    movePumpActive = false;
  }
}

function queueAbsoluteMove(x: number, y: number, bounds: DisplayBounds): void {
  pendingRelativeMove = null;
  pendingAbsoluteMove = { x, y, bounds };
  void pumpMouseMoves();
}

function queueRelativeMove(deltaX: number, deltaY: number, bounds: DisplayBounds): void {
  if (pendingRelativeMove) {
    pendingRelativeMove = {
      deltaX: pendingRelativeMove.deltaX + deltaX,
      deltaY: pendingRelativeMove.deltaY + deltaY,
      bounds
    };
  } else {
    pendingRelativeMove = { deltaX, deltaY, bounds };
  }
  void pumpMouseMoves();
}

async function clickMouse(x: number, y: number, button: "left" | "middle" | "right", action: "down" | "up" | "click"): Promise<void> {
  const swiftButton = button === "right" ? ".right" : button === "middle" ? ".center" : ".left";
  const downType = button === "right" ? ".rightMouseDown" : button === "middle" ? ".otherMouseDown" : ".leftMouseDown";
  const upType = button === "right" ? ".rightMouseUp" : button === "middle" ? ".otherMouseUp" : ".leftMouseUp";

  const emit = (eventType: string) => `
if let event = CGEvent(mouseEventSource: nil, mouseType: ${eventType}, mouseCursorPosition: point, mouseButton: ${swiftButton}) {
  event.post(tap: .cghidEventTap)
}
`;

  const body =
    action === "down"
      ? emit(downType)
      : action === "up"
        ? emit(upType)
        : `${emit(downType)}${emit(upType)}`;

  await runSwift(`
import Cocoa
import CoreGraphics
let point = CGPoint(x: ${x}, y: ${y})
${body}
`);
}

async function scrollMouse(deltaX: number, deltaY: number): Promise<void> {
  await runSwift(`
import Cocoa
import CoreGraphics
if let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: Int32(${Math.round(-deltaY)}), wheel2: Int32(${Math.round(-deltaX)}), wheel3: 0) {
  event.post(tap: .cghidEventTap)
}
`);
}

async function sendKeyPress(event: KeyPressInputEvent): Promise<void> {
  const modifiers = modifiersForAppleScript(event);
  const modifierText = modifiers.length > 0 ? ` using {${modifiers.join(", ")}}` : "";
  const specialCode = specialKeyCode(event.code);

  const script =
    specialCode !== null
      ? [
          'tell application "System Events"',
          `  key code ${specialCode}${modifierText}`,
          "end tell"
        ]
      : [
          'tell application "System Events"',
          `  keystroke "${escapeAppleScriptString(event.key)}"${modifierText}`,
          "end tell"
        ];

  await execFileAsync("osascript", ["-e", script.join("\n")]);
}

export async function executeRemoteInput(event: RemoteInputEvent, bounds: DisplayBounds): Promise<void> {
  switch (event.kind) {
    case "mouse_move": {
      queueAbsoluteMove(event.x, event.y, bounds);
      return;
    }
    case "mouse_move_relative": {
      queueRelativeMove(event.deltaX, event.deltaY, bounds);
      return;
    }
    case "mouse_button": {
      const point = screenPoint(event, bounds);
      await clickMouse(point.x, point.y, event.button, event.action);
      return;
    }
    case "wheel":
      await scrollMouse(event.deltaX, event.deltaY);
      return;
    case "key_press":
      await sendKeyPress(event);
      return;
  }
}
