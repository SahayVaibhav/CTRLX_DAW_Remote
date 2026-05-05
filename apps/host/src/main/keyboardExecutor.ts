import { AppleScriptRunner } from "./automation/applescript.js";
import type { KeyboardInputMessage } from "#protocol";

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

type KeyboardTextSegment =
  | { type: "text"; value: string }
  | { type: "spaces"; count: number };

function segmentKeyboardText(value: string): KeyboardTextSegment[] {
  const segments: KeyboardTextSegment[] = [];
  let textBuffer = "";
  let spaceCount = 0;

  for (const char of value) {
    if (char === " ") {
      if (textBuffer.length > 0) {
        segments.push({ type: "text", value: textBuffer });
        textBuffer = "";
      }
      spaceCount += 1;
      continue;
    }

    if (spaceCount > 0) {
      segments.push({ type: "spaces", count: spaceCount });
      spaceCount = 0;
    }

    textBuffer += char;
  }

  if (textBuffer.length > 0) {
    segments.push({ type: "text", value: textBuffer });
  }

  if (spaceCount > 0) {
    segments.push({ type: "spaces", count: spaceCount });
  }

  return segments;
}

function formatWhitespaceForLog(value: string): string {
  return value
    .replace(/ /g, "␠")
    .replace(/\t/g, "⇥")
    .replace(/\r/g, "␍")
    .replace(/\n/g, "␊");
}

export class KeyboardExecutor {
  private readonly applescript = new AppleScriptRunner();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly logger: (message: string) => void) {}

  async execute(message: KeyboardInputMessage): Promise<void> {
    const task = this.queue.then(async () => {
      if (message.payload.action === "insert_text") {
        await this.typeText(message.payload.text ?? "");
        return;
      }

      if (message.payload.action === "backspace") {
        await this.pressKeyCode(51);
        return;
      }

      if (message.payload.action === "enter") {
        await this.pressKeyCode(36);
        return;
      }

      await this.pressKeyCode(53);
    });

    this.queue = task.catch(() => undefined);
    await task;
  }

  private async typeText(text: string): Promise<void> {
    for (const segment of segmentKeyboardText(text)) {
      if (segment.type === "text") {
        const escapedText = escapeAppleScriptString(segment.value);
        await this.applescript.run([
          `set ctrlxInsertedText to "${escapedText}"`,
          'tell application "System Events"',
          "  keystroke ctrlxInsertedText",
          "end tell"
        ]);
        continue;
      }

      for (let index = 0; index < segment.count; index += 1) {
        await this.pressKeyCode(49);
      }
    }

    this.logger(
      `Typed keyboard input (${text.length} chars): "${formatWhitespaceForLog(text)}".`
    );
  }

  private async pressKeyCode(keyCode: number): Promise<void> {
    await this.applescript.run([
      'tell application "System Events"',
      `  key code ${keyCode}`,
      "end tell"
    ]);
    this.logger(`Sent keyboard key code ${keyCode}.`);
  }
}
