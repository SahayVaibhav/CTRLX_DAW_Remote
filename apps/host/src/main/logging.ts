import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  createTimestamp,
  type CtrlxLogContext,
  type CtrlxLogEntry,
  type CtrlxLogLevel,
  type CtrlxLogSource
} from "#protocol";

type HostLoggingServiceOptions = {
  sessionCode: () => string;
  appendToUi: (entry: CtrlxLogEntry) => void;
  forwardToClient?: (entry: CtrlxLogEntry) => void;
};

type HostLogOptions = {
  level: CtrlxLogLevel;
  message: string;
  source: CtrlxLogSource;
  context?: CtrlxLogContext;
  forwardToClient?: boolean;
};

export class HostLoggingService {
  private logFilePath: string | null = null;
  private writeChain = Promise.resolve();
  private didWarnAboutPersistenceFailure = false;

  constructor(private readonly options: HostLoggingServiceOptions) {}

  async initialize(userDataPath: string): Promise<string | null> {
    const logsDirectory = join(userDataPath, "logs");

    try {
      await mkdir(logsDirectory, { recursive: true });
    } catch (error) {
      this.emitPersistenceWarning(`Failed to create CTRLX log directory: ${this.describeError(error)}`);
      return null;
    }

    const sessionCode = this.options.sessionCode().replace(/[^A-Z0-9_-]+/gi, "_");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    this.logFilePath = join(logsDirectory, `ctrlx-${sessionCode || "session"}-${timestamp}.ndjson`);
    return this.logFilePath;
  }

  log(options: HostLogOptions): CtrlxLogEntry {
    const entry: CtrlxLogEntry = {
      id: randomUUID(),
      level: options.level,
      message: options.message,
      at: createTimestamp(),
      source: options.source,
      context: options.context
    };

    this.options.appendToUi(entry);

    if (options.forwardToClient !== false) {
      this.options.forwardToClient?.(entry);
    }

    this.persist(entry);
    return entry;
  }

  private persist(entry: CtrlxLogEntry): void {
    if (!this.logFilePath) {
      return;
    }

    const serialized = `${JSON.stringify(entry)}\n`;
    this.writeChain = this.writeChain
      .then(async () => {
        if (!this.logFilePath) {
          return;
        }

        await appendFile(this.logFilePath, serialized, "utf8");
      })
      .catch((error) => {
        this.logFilePath = null;
        this.emitPersistenceWarning(`Host log persistence disabled: ${this.describeError(error)}`);
      });
  }

  private emitPersistenceWarning(message: string): void {
    if (this.didWarnAboutPersistenceFailure) {
      return;
    }

    this.didWarnAboutPersistenceFailure = true;
    const entry: CtrlxLogEntry = {
      id: randomUUID(),
      level: "warn",
      message,
      at: createTimestamp(),
      source: "host"
    };
    this.options.appendToUi(entry);
    this.options.forwardToClient?.(entry);
  }

  private describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
