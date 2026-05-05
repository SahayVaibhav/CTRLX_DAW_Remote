import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { InputMessage } from "#protocol";
import { AppleScriptRunner } from "./automation/applescript.js";
import { openSelectedEditor as triggerOpenSelectedEditor, runLogicKeyCodeAction } from "./logic/actions.js";

const execFileAsync = promisify(execFile);
const CURSOR_HELPER_SCRIPT_PATH = join(tmpdir(), "ctrlx-cursor-helper.swift");
const GESTURE_HELPER_SCRIPT_PATH = join(tmpdir(), "ctrlx-gesture-helper.swift");
const CURSOR_HELPER_READY_TIMEOUT_MS = 1500;
const GESTURE_HELPER_READY_TIMEOUT_MS = 1500;
const CURSOR_HELPER_SWIFT = `
import Cocoa
import CoreGraphics
import Darwin
import Foundation

func postMove(_ command: String, x: Double, y: Double) {
  let point = CGPoint(x: x, y: y)
  let eventType: CGEventType = command == "drag" ? .leftMouseDragged : .mouseMoved
  if let event = CGEvent(mouseEventSource: nil, mouseType: eventType, mouseCursorPosition: point, mouseButton: .left) {
    event.post(tap: .cghidEventTap)
  }
}

print("READY")
fflush(stdout)

while let line = readLine() {
  let parts = line.split(separator: " ")
  guard parts.count == 3 else { continue }
  guard let x = Double(parts[1]), let y = Double(parts[2]) else { continue }
  postMove(String(parts[0]), x: x, y: y)
}
`;

const GESTURE_HELPER_SWIFT = `
import Cocoa
import CoreGraphics
import Foundation

func postScroll(deltaX: Double, deltaY: Double) {
  let vertical = Int32(deltaY.rounded())
  let horizontal = Int32(deltaX.rounded())
  if let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: vertical, wheel2: horizontal, wheel3: 0) {
    event.post(tap: .cghidEventTap)
  }
}

print("READY")
fflush(stdout)

while let line = readLine() {
  let parts = line.split(separator: " ")
  guard parts.count == 3 else { continue }
  guard parts[0] == "scroll" else { continue }
  guard let deltaX = Double(parts[1]), let deltaY = Double(parts[2]) else { continue }
  postScroll(deltaX: deltaX, deltaY: deltaY)
}
`;

type ScreenLike = {
  getPrimaryDisplay: () => {
    bounds: {
      width: number;
      height: number;
      x?: number;
      y?: number;
    };
  };
};

export type HostScreenCoordinates = {
  x: number;
  y: number;
  originX: number;
  originY: number;
  displayWidth: number;
  displayHeight: number;
};

type DragSession = {
  isPointerDown: boolean;
  lastX: number;
  lastY: number;
};

type PendingPointerMove = {
  x: number;
  y: number;
  requestId?: string;
  hostReceivedAt?: number;
};

export type PointerMoveTelemetryEvent =
  | {
      kind: "replaced";
      at: number;
      requestId?: string;
      replacedRequestId?: string;
      x: number;
      y: number;
    }
  | {
      kind: "skipped_no_delta";
      at: number;
      requestId?: string;
      x: number;
      y: number;
    }
  | {
      kind: "execute_start";
      at: number;
      requestId?: string;
      hostReceivedAt?: number;
      x: number;
      y: number;
    }
  | {
      kind: "execute_end";
      at: number;
      requestId?: string;
      hostReceivedAt?: number;
      executeStartAt: number;
      x: number;
      y: number;
    };

function hasMeaningfulDelta(previous: PendingPointerMove | null, next: PendingPointerMove, threshold = 1): boolean {
  if (!previous) {
    return true;
  }

  return Math.abs(previous.x - next.x) >= threshold || Math.abs(previous.y - next.y) >= threshold;
}

function clampNormalized(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function mapNormalizedToHostCoordinates(
  message: InputMessage,
  screen: ScreenLike
): HostScreenCoordinates | null {
  const { xNorm, yNorm } = message.payload;

  if (!Number.isFinite(xNorm) || !Number.isFinite(yNorm)) {
    return null;
  }

  if (xNorm < 0 || xNorm > 1 || yNorm < 0 || yNorm > 1) {
    return null;
  }

  const display = screen.getPrimaryDisplay();
  const bounds = display.bounds;
  const originX = bounds.x ?? 0;
  const originY = bounds.y ?? 0;

  return {
    x: originX + clampNormalized(xNorm) * bounds.width,
    y: originY + clampNormalized(yNorm) * bounds.height,
    originX,
    originY,
    displayWidth: bounds.width,
    displayHeight: bounds.height
  };
}

export class InputExecutor {
  private readonly experimentalDragEnabled =
    process.env.CTRLX_EXPERIMENTAL_DRAG === "0"
      ? false
      : process.env.CTRLX_EXPERIMENTAL_DRAG === "1" || process.env.CTRLX_DISABLE_POINTER_DRAG !== "1";
  private readonly debugCursorMoveEnabled = process.env.CTRLX_DEBUG_CURSOR_MOVE === "1";
  private readonly applescript = new AppleScriptRunner();
  private dragSession: DragSession | null = null;
  private pointerMoveInFlight = false;
  private pendingPointerMove: PendingPointerMove | null = null;
  private lastPointerMove: PendingPointerMove | null = null;
  private cursorHelperProcess: ChildProcessWithoutNullStreams | null = null;
  private cursorHelperReadyPromise: Promise<void> | null = null;
  private gestureHelperProcess: ChildProcessWithoutNullStreams | null = null;
  private gestureHelperReadyPromise: Promise<void> | null = null;
  private pointerMoveFlushPromise: Promise<void> | null = null;

  constructor(
    private readonly screen: ScreenLike,
    private readonly logger: (message: string) => void,
    private readonly onPointerMoveTelemetry?: (event: PointerMoveTelemetryEvent) => void
  ) {}

  isExperimentalDragEnabled(): boolean {
    return this.experimentalDragEnabled;
  }

  isDebugCursorMoveEnabled(): boolean {
    return this.debugCursorMoveEnabled;
  }

  async prewarmRealtimeCursorPath(): Promise<void> {
    await this.ensureCursorHelper();
  }

  async execute(message: InputMessage, coordinates?: HostScreenCoordinates): Promise<void> {
    if (message.payload.action === "gesture_pan") {
      await this.scrollBy(message.payload.deltaX ?? 0, message.payload.deltaY ?? 0);
      return;
    }

    if (message.payload.action === "gesture_zoom") {
      await this.zoomBy(message.payload.zoomDelta ?? 0, message.payload.zoomAxis ?? "horizontal");
      return;
    }

    const mappedCoordinates = coordinates ?? mapNormalizedToHostCoordinates(message, this.screen);
    if (!mappedCoordinates) {
      throw new Error("Input coordinates are out of bounds or invalid.");
    }

    const pointX = mappedCoordinates.x;
    const pointY = mappedCoordinates.y;

    if (message.payload.action === "pointer_move") {
      this.queuePointerMove(
        { x: pointX, y: pointY },
        {
          requestId: message.requestId
        }
      );
      return;
    }

    if (message.payload.action === "gesture_region_move") {
      await this.handleRegionMove(message.payload.gesturePhase ?? "move", pointX, pointY);
      return;
    }

    if (message.payload.action === "pointer_down") {
      if (!this.experimentalDragEnabled) {
        await this.handlePointerDownHover(pointX, pointY);
        return;
      }

      await this.handlePointerDown(pointX, pointY);
      return;
    }

    if (message.payload.action === "pointer_up") {
      if (!this.experimentalDragEnabled) {
        await this.handlePointerUpHover(pointX, pointY);
        return;
      }

      await this.handlePointerUp(pointX, pointY);
      return;
    }

    if (message.payload.action === "double_tap") {
      await this.clickAt(pointX, pointY, 2);
      await this.openSelectedEditor();
      this.logger(`Executed double tap at ${Math.round(pointX)},${Math.round(pointY)}.`);
      return;
    }

    await this.clickAt(pointX, pointY, 1);
    this.logger(`Executed click at ${Math.round(pointX)},${Math.round(pointY)}.`);
  }

  queuePointerMove(
    coordinates: Pick<HostScreenCoordinates, "x" | "y">,
    metadata?: {
      requestId?: string;
      hostReceivedAt?: number;
    }
  ): void {
    const nextMove = {
      x: coordinates.x,
      y: coordinates.y,
      requestId: metadata?.requestId,
      hostReceivedAt: metadata?.hostReceivedAt
    };
    const previousMove = this.pendingPointerMove ?? this.lastPointerMove;
    if (!hasMeaningfulDelta(previousMove, nextMove)) {
      this.onPointerMoveTelemetry?.({
        kind: "skipped_no_delta",
        at: Date.now(),
        requestId: nextMove.requestId,
        x: nextMove.x,
        y: nextMove.y
      });
      return;
    }

    if (this.pendingPointerMove) {
      this.onPointerMoveTelemetry?.({
        kind: "replaced",
        at: Date.now(),
        requestId: nextMove.requestId,
        replacedRequestId: this.pendingPointerMove.requestId,
        x: nextMove.x,
        y: nextMove.y
      });
    }

    this.pendingPointerMove = nextMove;
    if (this.pointerMoveFlushPromise) {
      return;
    }

    this.pointerMoveFlushPromise = this.flushPointerMoves().finally(() => {
      this.pointerMoveFlushPromise = null;
      if (this.pendingPointerMove) {
        this.queuePointerMove(this.pendingPointerMove);
      }
    });
  }

  async executeTap(coordinates: HostScreenCoordinates): Promise<void> {
    await this.clickAt(coordinates.x, coordinates.y, 1);
    this.logger(`Executed click at ${Math.round(coordinates.x)},${Math.round(coordinates.y)}.`);
  }

  private async handlePointerDownHover(x: number, y: number): Promise<void> {
    this.pendingPointerMove = null;
    const nextMove = { x, y };
    if (hasMeaningfulDelta(this.lastPointerMove, nextMove)) {
      await this.moveTo(x, y);
      this.lastPointerMove = nextMove;
    }
    if (this.debugCursorMoveEnabled) {
      this.logger(`Pointer down hover at ${Math.round(x)},${Math.round(y)}.`);
    }
  }

  private async handlePointerDown(x: number, y: number): Promise<void> {
    this.pendingPointerMove = null;
    this.lastPointerMove = { x, y };
    this.dragSession = {
      isPointerDown: true,
      lastX: x,
      lastY: y
    };

    await this.postMouseEvent("leftMouseDown", x, y);
    this.logger(`Pointer down at ${Math.round(x)},${Math.round(y)}.`);
  }

  private async handlePointerMove(x: number, y: number): Promise<void> {
    this.queuePointerMove({ x, y });
    await this.pointerMoveFlushPromise;
  }

  private async flushPointerMoves(): Promise<void> {
    if (this.pointerMoveInFlight) {
      return;
    }

    this.pointerMoveInFlight = true;

    try {
      while (this.pendingPointerMove) {
        const nextMove = this.pendingPointerMove;
        this.pendingPointerMove = null;
        const executeStartAt = Date.now();
        this.onPointerMoveTelemetry?.({
          kind: "execute_start",
          at: executeStartAt,
          requestId: nextMove.requestId,
          hostReceivedAt: nextMove.hostReceivedAt,
          x: nextMove.x,
          y: nextMove.y
        });

        if (this.dragSession?.isPointerDown) {
          this.dragSession.lastX = nextMove.x;
          this.dragSession.lastY = nextMove.y;
          await this.sendCursorCommand("drag", nextMove.x, nextMove.y);
          this.lastPointerMove = nextMove;
          this.onPointerMoveTelemetry?.({
            kind: "execute_end",
            at: Date.now(),
            requestId: nextMove.requestId,
            hostReceivedAt: nextMove.hostReceivedAt,
            executeStartAt,
            x: nextMove.x,
            y: nextMove.y
          });
          if (this.debugCursorMoveEnabled) {
            this.logger(`Dragged pointer to ${Math.round(nextMove.x)},${Math.round(nextMove.y)}.`);
          }
          continue;
        }

        await this.moveTo(nextMove.x, nextMove.y);
        this.lastPointerMove = nextMove;
        this.onPointerMoveTelemetry?.({
          kind: "execute_end",
          at: Date.now(),
          requestId: nextMove.requestId,
          hostReceivedAt: nextMove.hostReceivedAt,
          executeStartAt,
          x: nextMove.x,
          y: nextMove.y
        });
        if (this.debugCursorMoveEnabled) {
          this.logger(`Moved pointer to ${Math.round(nextMove.x)},${Math.round(nextMove.y)}.`);
        }
      }
    } finally {
      this.pointerMoveInFlight = false;
    }
  }

  private async handlePointerUp(x: number, y: number): Promise<void> {
    this.pendingPointerMove = null;
    const nextMove = { x, y };
    if (!this.dragSession?.isPointerDown) {
      if (hasMeaningfulDelta(this.lastPointerMove, nextMove)) {
        await this.moveTo(x, y);
        this.lastPointerMove = nextMove;
      }
      if (this.debugCursorMoveEnabled) {
        this.logger(`Pointer up with no active drag at ${Math.round(x)},${Math.round(y)}.`);
      }
      return;
    }

    await this.postMouseEvent("leftMouseUp", x, y);
    this.lastPointerMove = nextMove;
    this.dragSession = null;
    this.logger(`Pointer up at ${Math.round(x)},${Math.round(y)}.`);
  }

  private async handlePointerUpHover(x: number, y: number): Promise<void> {
    this.pendingPointerMove = null;
    const nextMove = { x, y };
    if (hasMeaningfulDelta(this.lastPointerMove, nextMove)) {
      await this.moveTo(x, y);
      this.lastPointerMove = nextMove;
    }
    if (this.debugCursorMoveEnabled) {
      this.logger(`Pointer up hover at ${Math.round(x)},${Math.round(y)}.`);
    }
  }

  private async clickAt(x: number, y: number, clicks: 1 | 2): Promise<void> {
    this.pendingPointerMove = null;
    this.lastPointerMove = { x, y };
    this.dragSession = null;
    const events =
      clicks === 2
        ? `
for _ in 0..<2 {
  if let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left) {
    down.post(tap: .cghidEventTap)
  }
  if let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) {
    up.post(tap: .cghidEventTap)
  }
}
`
        : `
if let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left) {
  down.post(tap: .cghidEventTap)
}
if let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left) {
  up.post(tap: .cghidEventTap)
}
`;

    await execFileAsync("swift", [
      "-e",
      `
import Cocoa
import CoreGraphics
let point = CGPoint(x: ${x}, y: ${y})
if let move = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left) {
  move.post(tap: .cghidEventTap)
}
${events}
`
    ]);
  }

  private async moveTo(x: number, y: number): Promise<void> {
    await this.sendCursorCommand("move", x, y);
  }

  private async scrollBy(deltaX: number, deltaY: number): Promise<void> {
    const scaledX = Math.round(-deltaX * 1.75);
    const scaledY = Math.round(-deltaY * 1.75);
    if (scaledX === 0 && scaledY === 0) {
      return;
    }

    try {
      const helper = await this.ensureGestureHelper();
      helper.stdin.write(`scroll ${scaledX} ${scaledY}\n`);
    } catch {
      await execFileAsync("swift", [
        "-e",
        `
import Cocoa
import CoreGraphics
if let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 2, wheel1: ${scaledY}, wheel2: ${scaledX}, wheel3: 0) {
  event.post(tap: .cghidEventTap)
}
`
      ]);
    }
  }

  private async zoomBy(zoomDelta: number, zoomAxis: "horizontal" | "vertical"): Promise<void> {
    if (!Number.isFinite(zoomDelta) || zoomDelta === 0) {
      return;
    }

    const zoomIn = zoomDelta > 0;
    const steps = Math.min(4, Math.max(1, Math.round(Math.abs(zoomDelta))));
    const keyCode =
      zoomAxis === "horizontal"
        ? zoomIn
          ? 19
          : 18
        : zoomIn
          ? 21
          : 20;
    await runLogicKeyCodeAction(
      {
        applescript: this.applescript,
        logger: this.logger
      },
      {
        commandId: "gesture_zoom",
        description: `Triggered Logic ${zoomAxis} zoom ${zoomIn ? "in" : "out"} gesture.`,
        keyCode,
        repeatCount: steps,
        strategy: "gesture_zoom_number_row_key_code"
      }
    );
  }

  private async openSelectedEditor(): Promise<void> {
    await triggerOpenSelectedEditor({
      applescript: this.applescript,
      logger: this.logger
    });
  }

  private async handleRegionMove(phase: "start" | "move" | "end", x: number, y: number): Promise<void> {
    if (phase === "start") {
      this.pendingPointerMove = null;
      this.lastPointerMove = { x, y };
      this.dragSession = {
        isPointerDown: true,
        lastX: x,
        lastY: y
      };
      await this.postMouseEvent("leftMouseDown", x, y);
      this.logger(`Region move start at ${Math.round(x)},${Math.round(y)}.`);
      return;
    }

    if (phase === "move") {
      if (!this.dragSession?.isPointerDown) {
        return;
      }

      this.dragSession.lastX = x;
      this.dragSession.lastY = y;
      this.lastPointerMove = { x, y };
      await this.sendCursorCommand("drag", x, y);
      return;
    }

    if (!this.dragSession?.isPointerDown) {
      return;
    }

    await this.postMouseEvent("leftMouseUp", x, y);
    this.lastPointerMove = { x, y };
    this.dragSession = null;
    this.logger(`Region move end at ${Math.round(x)},${Math.round(y)}.`);
  }

  private async sendCursorCommand(command: "move" | "drag", x: number, y: number): Promise<void> {
    try {
      const helper = await this.ensureCursorHelper();
      helper.stdin.write(`${command} ${x} ${y}\n`);
    } catch {
      await this.postMouseEvent(command === "drag" ? "leftMouseDragged" : "mouseMoved", x, y);
    }
  }

  private async ensureCursorHelper(): Promise<ChildProcessWithoutNullStreams> {
    if (this.cursorHelperProcess && !this.cursorHelperProcess.killed) {
      if (this.cursorHelperReadyPromise) {
        await this.cursorHelperReadyPromise;
      }
      return this.cursorHelperProcess;
    }

    if (!existsSync(CURSOR_HELPER_SCRIPT_PATH)) {
      writeFileSync(CURSOR_HELPER_SCRIPT_PATH, CURSOR_HELPER_SWIFT, "utf8");
    }

    const helper = spawn("swift", [CURSOR_HELPER_SCRIPT_PATH], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.cursorHelperProcess = helper;
    this.cursorHelperReadyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Cursor helper readiness timed out."));
      }, CURSOR_HELPER_READY_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        helper.stdout.off("data", handleStdout);
        helper.stderr.off("data", handleStderr);
        helper.off("error", handleError);
        helper.off("exit", handleExit);
      };

      const handleStdout = (chunk: Buffer) => {
        if (chunk.toString("utf8").includes("READY")) {
          cleanup();
          resolve();
        }
      };

      const handleStderr = (chunk: Buffer) => {
        const message = chunk.toString("utf8").trim();
        if (message && this.debugCursorMoveEnabled) {
          this.logger(`Cursor helper stderr: ${message}`);
        }
      };

      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const handleExit = (code: number | null) => {
        cleanup();
        reject(new Error(`Cursor helper exited before ready (code=${code ?? "null"}).`));
      };

      helper.stdout.on("data", handleStdout);
      helper.stderr.on("data", handleStderr);
      helper.on("error", handleError);
      helper.on("exit", handleExit);
    });

    helper.on("exit", () => {
      if (this.cursorHelperProcess === helper) {
        this.cursorHelperProcess = null;
        this.cursorHelperReadyPromise = null;
      }
    });

    helper.on("error", () => {
      if (this.cursorHelperProcess === helper) {
        this.cursorHelperProcess = null;
        this.cursorHelperReadyPromise = null;
      }
    });

    await this.cursorHelperReadyPromise;
    return helper;
  }

  private async ensureGestureHelper(): Promise<ChildProcessWithoutNullStreams> {
    if (this.gestureHelperProcess && !this.gestureHelperProcess.killed) {
      if (this.gestureHelperReadyPromise) {
        await this.gestureHelperReadyPromise;
      }
      return this.gestureHelperProcess;
    }

    if (!existsSync(GESTURE_HELPER_SCRIPT_PATH)) {
      writeFileSync(GESTURE_HELPER_SCRIPT_PATH, GESTURE_HELPER_SWIFT, "utf8");
    }

    const helper = spawn("swift", [GESTURE_HELPER_SCRIPT_PATH], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.gestureHelperProcess = helper;
    this.gestureHelperReadyPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Gesture helper readiness timed out."));
      }, GESTURE_HELPER_READY_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        helper.stdout.off("data", handleStdout);
        helper.stderr.off("data", handleStderr);
        helper.off("error", handleError);
        helper.off("exit", handleExit);
      };

      const handleStdout = (chunk: Buffer) => {
        if (chunk.toString("utf8").includes("READY")) {
          cleanup();
          resolve();
        }
      };

      const handleStderr = (chunk: Buffer) => {
        const message = chunk.toString("utf8").trim();
        if (message && this.debugCursorMoveEnabled) {
          this.logger(`Gesture helper stderr: ${message}`);
        }
      };

      const handleError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const handleExit = (code: number | null) => {
        cleanup();
        reject(new Error(`Gesture helper exited before ready (code=${code ?? "null"}).`));
      };

      helper.stdout.on("data", handleStdout);
      helper.stderr.on("data", handleStderr);
      helper.on("error", handleError);
      helper.on("exit", handleExit);
    });

    helper.on("exit", () => {
      if (this.gestureHelperProcess === helper) {
        this.gestureHelperProcess = null;
        this.gestureHelperReadyPromise = null;
      }
    });

    helper.on("error", () => {
      if (this.gestureHelperProcess === helper) {
        this.gestureHelperProcess = null;
        this.gestureHelperReadyPromise = null;
      }
    });

    await this.gestureHelperReadyPromise;
    return helper;
  }

  private async postMouseEvent(
    mouseType: "mouseMoved" | "leftMouseDown" | "leftMouseDragged" | "leftMouseUp",
    x: number,
    y: number
  ): Promise<void> {
    await execFileAsync("swift", [
      "-e",
      `
import Cocoa
import CoreGraphics
let point = CGPoint(x: ${x}, y: ${y})
if let move = CGEvent(mouseEventSource: nil, mouseType: .${mouseType}, mouseCursorPosition: point, mouseButton: .left) {
  move.post(tap: .cghidEventTap)
}
`
    ]);
  }
}
