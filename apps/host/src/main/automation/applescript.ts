import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type AppleScriptExecutionResult = {
  stdout: string;
  stderr: string;
};

export type AppleScriptExecutionOptions = {
  timeoutMs?: number;
};

export class AppleScriptRunner {
  async run(lines: string[], options: AppleScriptExecutionOptions = {}): Promise<AppleScriptExecutionResult> {
    const trimmedLines = lines.map((line) => line.trimEnd()).filter((line) => line.length > 0);

    const args = trimmedLines.flatMap((line) => ["-e", line]);
    try {
      const { stdout = "", stderr = "" } = await execFileAsync("/usr/bin/osascript", args, {
        timeout: options.timeoutMs ?? 10_000,
        maxBuffer: 1024 * 1024
      });

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };
    } catch (error) {
      const execError = error as {
        message?: string;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        code?: number | string | null;
        signal?: string | null;
        killed?: boolean;
      };
      const stdout =
        typeof execError.stdout === "string"
          ? execError.stdout.trim()
          : Buffer.isBuffer(execError.stdout)
            ? execError.stdout.toString("utf8").trim()
            : "";
      const stderr =
        typeof execError.stderr === "string"
          ? execError.stderr.trim()
          : Buffer.isBuffer(execError.stderr)
            ? execError.stderr.toString("utf8").trim()
            : "";
      const details = [
        stderr,
        stdout && stdout !== stderr ? `stdout: ${stdout}` : "",
        execError.killed ? "process timed out" : "",
        execError.signal ? `signal: ${execError.signal}` : "",
        execError.code !== undefined && execError.code !== null ? `code: ${String(execError.code)}` : "",
        execError.message ?? ""
      ]
        .map((part) => part.trim())
        .filter((part, index, parts) => part.length > 0 && parts.indexOf(part) === index);

      throw new Error(details.join(" | ") || "AppleScript execution failed.");
    }
  }
}
