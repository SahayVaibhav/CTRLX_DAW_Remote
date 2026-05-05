import type { CommandResultPayload } from "#protocol";
import type { AppleScriptRunner } from "../automation/applescript.js";
import type { ImportUploadResult, ImportUploadSession } from "../importUploadManager.js";

export type CtrlxCommandCategory = "transport" | "track" | "session" | "edit" | "system" | "import";

export type CommandInputSchema = {
  type: "object";
  description?: string;
  properties?: Record<string, string>;
};

export type CommandExecutionInput = Record<string, unknown> | undefined;

export type CommandExecutionContext = {
  logger: (message: string) => void;
  applescript: AppleScriptRunner;
  runCommandById: (commandId: string, input?: CommandExecutionInput) => Promise<CommandResultPayload>;
  getImportUploadSession?: (sessionId: string) => ImportUploadSession | null;
  requestImportSelection?: (options?: { allowFolders?: boolean }) => Promise<ImportUploadResult | null>;
  emitStatus?: (message: string, data?: Record<string, unknown>) => void;
};

export type RegisteredCommand = {
  id: string;
  name: string;
  category: CtrlxCommandCategory;
  inputSchema?: CommandInputSchema;
  execute: (context: CommandExecutionContext, input?: CommandExecutionInput) => Promise<CommandResultPayload>;
};

export type MacroStep = {
  commandId: string;
  delayMs?: number;
  input?: CommandExecutionInput;
};

export type RegisteredMacro = {
  id: string;
  name: string;
  steps: MacroStep[];
};
