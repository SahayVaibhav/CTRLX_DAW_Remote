import type { CommandPayload, CommandResultPayload } from "#protocol";
import type { ImportUploadResult, ImportUploadSession } from "../importUploadManager.js";
import { getRegisteredCommand } from "../commands/registry.js";
import { getRegisteredMacro } from "../commands/macros.js";
import { runMacro } from "../commands/macroEngine.js";
import type { CommandExecutionContext, CommandExecutionInput } from "../commands/types.js";
import { AppleScriptRunner } from "./applescript.js";

export class Executor {
  private readonly applescript = new AppleScriptRunner();

  constructor(
    private readonly logger: (message: string) => void,
    private readonly dependencies: {
      getImportUploadSession?: (sessionId: string) => ImportUploadSession | null;
      requestImportSelection?: (options?: { allowFolders?: boolean }) => Promise<ImportUploadResult | null>;
      emitStatus?: (message: string, data?: Record<string, unknown>) => void;
    } = {}
  ) {}

  updateDependencies(
    nextDependencies: Partial<{
      getImportUploadSession?: (sessionId: string) => ImportUploadSession | null;
      requestImportSelection?: (options?: { allowFolders?: boolean }) => Promise<ImportUploadResult | null>;
      emitStatus?: (message: string, data?: Record<string, unknown>) => void;
    }>
  ): void {
    Object.assign(this.dependencies, nextDependencies);
  }

  async execute(payload: CommandPayload): Promise<CommandResultPayload> {
    return this.executeCommandById(payload.command, "input" in payload ? payload.input : undefined);
  }

  hasCommand(commandId: string): boolean {
    return getRegisteredCommand(commandId) !== null;
  }

  hasMacro(macroId: string): boolean {
    return getRegisteredMacro(macroId) !== null;
  }

  async executeCommandById(commandId: string, input?: CommandExecutionInput): Promise<CommandResultPayload> {
    this.logger(`Executor received ${commandId}`);

    const command = getRegisteredCommand(commandId);
    if (!command) {
      throw new Error(`Unknown command: ${commandId}`);
    }

    return command.execute(this.createContext(), input);
  }

  async executeMacroById(macroId: string): Promise<CommandResultPayload> {
    this.logger(`Executor received macro ${macroId}`);

    const macro = getRegisteredMacro(macroId);
    if (!macro) {
      throw new Error(`Unknown macro: ${macroId}`);
    }

    return runMacro(macro, this.createContext());
  }

  private createContext(): CommandExecutionContext {
    return {
      logger: this.logger,
      applescript: this.applescript,
      runCommandById: (commandId, input) => this.executeCommandById(commandId, input),
      getImportUploadSession: this.dependencies.getImportUploadSession,
      requestImportSelection: this.dependencies.requestImportSelection,
      emitStatus: this.dependencies.emitStatus
    };
  }
}
