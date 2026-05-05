import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { promisify } from "node:util";
import {
  buildImportAutomationPlanFromReviewedItems,
  createSelectedImportAutomationTrackTarget,
  CtrlxCommand,
  createTimestamp,
  executePreparedImportAutomationPlan,
  type CreateAudioTrackCommandInput,
  type ExecuteImportPlanCommandInput,
  type RequestImportSelectionCommandInput,
  type ImportAutomationExecutionReport,
  type ImportAutomationExecutableActionRequest,
  type ImportAutomationItem,
  type ImportAutomationPlan,
  type ImportExecutionProgressUpdate,
  type ImportAutomationTrackTarget,
  type CommandResultPayload,
  type ImportAutomationColor,
  type RenameTrackCommandInput,
  type SetTrackColorCommandInput
} from "#protocol";
import { AppleScriptRunner } from "../automation/applescript.js";
import type { CommandExecutionContext, CommandExecutionInput } from "../commands/types.js";
import { describeLogicTrackTarget, parseLogicTrackTarget, resolveLogicTrackTarget } from "./trackTargeting.js";
import { buildLogicImportPipelinePlan } from "./importPipeline.js";

export type LogicActionContext = Pick<CommandExecutionContext, "logger" | "applescript"> &
  Partial<
    Pick<
      CommandExecutionContext,
      "runCommandById" | "getImportUploadSession" | "requestImportSelection" | "emitStatus"
    >
  >;

const execFileAsync = promisify(execFile);
const DIRECT_FOLDER_IMPORT_AUDIO_EXTENSIONS = new Set([".wav", ".wave", ".aif", ".aiff", ".caf", ".mp3", ".m4a", ".flac"]);

const CTRLX_LOGIC_TEMPLATE_PATH =
  "/Users/kuhusingh/Music/Audio Music Apps/Project Templates/LOGIC FOR CTRLX.logicx";
const LOGIC_TRACK_COLOR_SWATCH_COUNT = 96;
const LOGIC_TRACK_COLOR_PALETTE_CLICK_MAP: Record<
  ImportAutomationColor,
  {
    label: string;
    xRatio: number;
    yRatio: number;
  }
> = {
  red: {
    label: "Red",
    xRatio: 0.09,
    yRatio: 0.36
  },
  orange: {
    label: "Orange",
    xRatio: 0.16,
    yRatio: 0.36
  },
  yellow: {
    label: "Yellow",
    xRatio: 0.27,
    yRatio: 0.36
  },
  green: {
    label: "Green",
    xRatio: 0.45,
    yRatio: 0.36
  },
  cyan: {
    label: "Cyan",
    xRatio: 0.64,
    yRatio: 0.36
  },
  blue: {
    label: "Blue",
    xRatio: 0.78,
    yRatio: 0.36
  },
  purple: {
    label: "Purple",
    xRatio: 0.88,
    yRatio: 0.36
  },
  pink: {
    label: "Pink",
    xRatio: 0.96,
    yRatio: 0.36
  },
  gray: {
    label: "Gray",
    xRatio: 0.78,
    yRatio: 0.83
  },
  neutral: {
    label: "Neutral",
    xRatio: 0.78,
    yRatio: 0.83
  }
};
const LOGIC_TRACK_COLOR_INDEX_FALLBACK_MAP: Record<
  ImportAutomationColor,
  {
    label: string;
    semanticLabels: readonly string[];
    fallbackButtonIndex: number;
  }
> = {
  red: {
    label: "Red",
    semanticLabels: ["red", "scarlet", "crimson"],
    fallbackButtonIndex: 1
  },
  orange: {
    label: "Orange",
    semanticLabels: ["orange", "amber"],
    fallbackButtonIndex: 3
  },
  yellow: {
    label: "Yellow",
    semanticLabels: ["yellow", "gold"],
    fallbackButtonIndex: 5
  },
  green: {
    label: "Green",
    semanticLabels: ["green", "lime"],
    fallbackButtonIndex: 19
  },
  cyan: {
    label: "Cyan",
    semanticLabels: ["cyan", "aqua", "teal"],
    fallbackButtonIndex: 31
  },
  blue: {
    label: "Blue",
    semanticLabels: ["blue", "sky", "azure"],
    fallbackButtonIndex: 43
  },
  purple: {
    label: "Purple",
    semanticLabels: ["purple", "violet"],
    fallbackButtonIndex: 55
  },
  pink: {
    label: "Pink",
    semanticLabels: ["pink", "magenta", "rose"],
    fallbackButtonIndex: 11
  },
  gray: {
    label: "Gray",
    semanticLabels: ["gray", "grey", "slate", "neutral"],
    fallbackButtonIndex: 85
  },
  neutral: {
    label: "Neutral",
    semanticLabels: ["gray", "grey", "neutral", "slate"],
    fallbackButtonIndex: 86
  }
};
const HOST_COMMAND_DEBUG =
  process.env.NODE_ENV !== "production" && process.env.CTRLX_DEBUG_COMMANDS === "1";
const HOST_IMPORT_AUTOMATION_DEBUG =
  process.env.NODE_ENV !== "production" && process.env.CTRLX_DEBUG_IMPORT_AUTOMATION === "1";

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unknown AppleScript execution failure.";
}

function debugImportAutomationHost(event: string, payload: Record<string, unknown>): void {
  if (!HOST_IMPORT_AUTOMATION_DEBUG) {
    return;
  }

  console.debug(`[CTRLX import host] ${event}`, payload);
}

async function clickScreenPoint(x: number, y: number, clicks = 1): Promise<void> {
  const clickEvents =
    clicks >= 2
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
${clickEvents}
`
  ]);
}

function parseRenameTrackTarget(input: CommandExecutionInput): ImportAutomationTrackTarget {
  if (!isRecord(input)) {
    throw new Error("track.rename requires an input payload.");
  }

  return parseLogicTrackTarget(input.target, "track.rename");
}

function parseRenameTrackInput(input: CommandExecutionInput): RenameTrackCommandInput {
  if (!isRecord(input)) {
    throw new Error("track.rename requires an input payload.");
  }

  const rawInput = input;
  const target = parseRenameTrackTarget(input);

  if (typeof rawInput.newName !== "string" || rawInput.newName.trim().length === 0) {
    throw new Error("track.rename requires a non-empty newName.");
  }

  if (
    "previousName" in rawInput &&
    rawInput.previousName !== undefined &&
    rawInput.previousName !== null &&
    typeof rawInput.previousName !== "string"
  ) {
    throw new Error("track.rename previousName must be a string or null when provided.");
  }

  const previousName =
    "previousName" in rawInput && (typeof rawInput.previousName === "string" || rawInput.previousName === null)
      ? rawInput.previousName
      : undefined;

  return {
    target,
    newName: rawInput.newName.trim(),
    previousName
  };
}

function isImportAutomationColor(value: unknown): value is ImportAutomationColor {
  return typeof value === "string" && value in LOGIC_TRACK_COLOR_INDEX_FALLBACK_MAP;
}

function parseSetTrackColorInput(input: CommandExecutionInput): SetTrackColorCommandInput {
  if (!isRecord(input)) {
    throw new Error("track.set_color requires an input payload.");
  }

  const rawInput = input;
  const target = parseLogicTrackTarget(rawInput.target, "track.set_color");

  if (!isImportAutomationColor(rawInput.color)) {
    throw new Error("track.set_color requires a supported normalized color.");
  }

  if (
    "previousColor" in rawInput &&
    rawInput.previousColor !== undefined &&
    rawInput.previousColor !== null &&
    !isImportAutomationColor(rawInput.previousColor)
  ) {
    throw new Error("track.set_color previousColor must be a supported normalized color or null when provided.");
  }

  const previousColor =
    "previousColor" in rawInput &&
    (isImportAutomationColor(rawInput.previousColor) || rawInput.previousColor === null)
      ? rawInput.previousColor
      : undefined;

  return {
    target,
    color: rawInput.color,
    previousColor
  };
}

function parseCreateAudioTrackInput(input: CommandExecutionInput): CreateAudioTrackCommandInput {
  if (input === undefined) {
    return {};
  }

  if (!isRecord(input)) {
    throw new Error("track.create_audio requires an object input payload when provided.");
  }

  if ("count" in input && input.count !== undefined) {
    if (
      typeof input.count !== "number" ||
      !Number.isFinite(input.count) ||
      !Number.isInteger(input.count) ||
      input.count < 1 ||
      input.count > 128
    ) {
      throw new Error("track.create_audio count must be a positive integer between 1 and 128.");
    }

    return {
      count: input.count
    };
  }

  return {};
}

function parseExecuteImportPlanInput(input: CommandExecutionInput): ExecuteImportPlanCommandInput {
  if (
    !isRecord(input) ||
    !isRecord(input.plan) ||
    !Array.isArray(input.plan.items)
  ) {
    throw new Error("import.execute_plan requires a reviewed plan with items.");
  }

  const importSessionId =
    typeof input.importSessionId === "string" && input.importSessionId.trim().length > 0
      ? input.importSessionId.trim()
      : undefined;
  const folderPath =
    typeof input.folderPath === "string" && input.folderPath.trim().length > 0 ? input.folderPath.trim() : undefined;

  if (!importSessionId && !folderPath) {
    throw new Error("import.execute_plan requires either an importSessionId or a folderPath.");
  }

  const rawItems = input.plan.items;
  const reviewedItems = rawItems.filter((item): item is ImportAutomationItem => {
    return (
      isRecord(item) &&
      typeof item.originalFilename === "string" &&
      typeof item.normalizedFilename === "string" &&
      typeof item.cleanTrackName === "string" &&
      typeof item.detectedCategory === "string" &&
      typeof item.assignedColor === "string" &&
      typeof item.confidence === "string"
    );
  });

  if (reviewedItems.length !== rawItems.length) {
    throw new Error("import.execute_plan received one or more invalid reviewed items.");
  }

  return {
    importSessionId,
    folderPath,
    plan: buildImportAutomationPlanFromReviewedItems(reviewedItems)
  };
}

async function discoverDirectFolderImportAudioFiles(folderPath: string) {
  const entries = await readdir(folderPath, { withFileTypes: true });
  const discoveredFiles = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .filter((entry) => DIRECT_FOLDER_IMPORT_AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }))
      .map(async (entry) => {
        const absolutePath = join(folderPath, entry.name);
        const metadata = await stat(absolutePath);
        return {
          filename: entry.name,
          path: absolutePath,
          extension: extname(entry.name).toLowerCase(),
          size: metadata.size,
          sourceType: "direct_file" as const,
          relativePath: entry.name,
          sourceSelectionPath: folderPath,
          sourceArchiveName: null
        };
      })
  );

  return discoveredFiles;
}

function parseRequestImportSelectionInput(input: CommandExecutionInput): RequestImportSelectionCommandInput {
  if (input === undefined) {
    return {};
  }

  if (!isRecord(input)) {
    throw new Error("import.request_selection requires an object input when provided.");
  }

  if ("allowFolders" in input && input.allowFolders !== undefined && typeof input.allowFolders !== "boolean") {
    throw new Error("import.request_selection allowFolders must be a boolean when provided.");
  }

  return {
    allowFolders: typeof input.allowFolders === "boolean" ? input.allowFolders : undefined
  };
}

function createSystemEventsKeystrokeAction(
  commandId: string,
  description: string,
  keystroke: string,
  modifiers: string[] = []
): (context: LogicActionContext, _input?: CommandExecutionInput) => Promise<CommandResultPayload> {
  return async ({ applescript, logger }) => {
    logger(`Running Logic action ${commandId}`);

    const modifierClause =
      modifiers.length > 0 ? ` using {${modifiers.map((modifier) => `${modifier} down`).join(", ")}}` : "";

    const result = await applescript.run([
      'tell application "Logic Pro" to activate',
      'tell application "System Events"',
      `  keystroke "${keystroke}"${modifierClause}`,
      "end tell"
    ]);

    return {
      command: commandId,
      ok: true,
      message: description,
      data: {
        stdout: result.stdout || undefined,
        stderr: result.stderr || undefined
      }
    };
  };
}

export async function runLogicKeyCodeAction(
  { applescript, logger }: LogicActionContext,
  options: {
    commandId: string;
    description: string;
    keyCode: number;
    repeatCount?: number;
    strategy: string;
  }
): Promise<CommandResultPayload> {
  const { commandId, description, keyCode, repeatCount = 1, strategy } = options;
  const steps = Math.max(1, Math.floor(repeatCount));

  logger(`Running Logic action ${commandId}`);

  const result = await applescript.run([
    'tell application "Logic Pro" to activate',
    'tell application "System Events"',
    ...Array.from({ length: steps }, () => `  key code ${keyCode}`),
    "end tell"
  ]);

  return {
    command: commandId,
    ok: true,
    message: description,
    data: {
      keyCode,
      steps,
      strategy,
      stdout: result.stdout || undefined,
      stderr: result.stderr || undefined
    }
  };
}

export async function openLogic({ applescript, logger }: LogicActionContext): Promise<CommandResultPayload> {
  logger("Running Logic action session.open_logic");

  if (!existsSync(CTRLX_LOGIC_TEMPLATE_PATH)) {
    throw new Error(`CTRLX Logic template not found at ${CTRLX_LOGIC_TEMPLATE_PATH}`);
  }

  const escapedTemplatePath = CTRLX_LOGIC_TEMPLATE_PATH.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

  const result = await applescript.run(
    [
      `set ctrlxTemplateFile to POSIX file "${escapedTemplatePath}"`,
      'tell application "Logic Pro"',
      "  activate",
      "  open ctrlxTemplateFile",
      "end tell",
      'return "ctrlx_template_opened"'
    ],
    { timeoutMs: 20_000 }
  );

  return {
    command: "session.open_logic",
    ok: true,
    message: "Opened the CTRLX Logic template session.",
    data: {
      templatePath: CTRLX_LOGIC_TEMPLATE_PATH,
      stdout: result.stdout || undefined,
      stderr: result.stderr || undefined
    }
  };
}

export async function createAudioTrack(
  { applescript, logger }: LogicActionContext,
  input?: CommandExecutionInput
): Promise<CommandResultPayload> {
  const createInput = parseCreateAudioTrackInput(input);
  const count = createInput.count ?? 1;

  logger(`Running Logic action ${CtrlxCommand.CreateAudioTrack}`);
  if (HOST_COMMAND_DEBUG) {
    logger(`[debug] track.create_audio count=${count}`);
  }
  debugImportAutomationHost("host_action_start", {
    commandId: CtrlxCommand.CreateAudioTrack,
    actionType: "create_audio_track",
    count
  });

  try {
    const result = await applescript.run(
      [
        `set ctrlxRequestedTrackCount to ${count}`,
        `set ctrlxDiagnosticsEnabled to ${HOST_IMPORT_AUTOMATION_DEBUG ? "true" : "false"}`,
        'tell application "Logic Pro" to activate',
        "delay 0.2",
        'tell application "System Events"',
        '  tell process "Logic Pro"',
        "    set frontmost to true",
        '    keystroke "n" using {option down, command down}',
        "    delay 0.7",
        "    set ctrlxCreateWindow to missing value",
        '    set ctrlxFrontWindowName to ""',
        '    set ctrlxFrontWindowRole to ""',
        '    set ctrlxFrontWindowSubrole to ""',
        '    set ctrlxWindowDiagnostics to {}',
        "    try",
        "      set ctrlxFrontWindow to front window",
        "      try",
        '        set ctrlxFrontWindowName to name of ctrlxFrontWindow',
        "      end try",
        "      try",
        '        set ctrlxFrontWindowRole to role of ctrlxFrontWindow',
        "      end try",
        "      try",
        '        set ctrlxFrontWindowSubrole to subrole of ctrlxFrontWindow',
        "      end try",
        "    on error",
        "      set ctrlxFrontWindow to missing value",
        "    end try",
        "    if ctrlxDiagnosticsEnabled then",
        "      repeat with ctrlxWindow in every window",
        '        set ctrlxWindowName to ""',
        '        set ctrlxWindowRole to ""',
        '        set ctrlxWindowSubrole to ""',
        '        set ctrlxSheetSummary to ""',
        "        try",
        '          set ctrlxWindowName to name of ctrlxWindow',
        "        end try",
        "        try",
        '          set ctrlxWindowRole to role of ctrlxWindow',
        "        end try",
        "        try",
        '          set ctrlxWindowSubrole to subrole of ctrlxWindow',
        "        end try",
        "        try",
        '          set ctrlxSheetNames to {}',
        "          repeat with ctrlxSheet in every sheet of ctrlxWindow",
        '            set ctrlxSheetName to ""',
        '            set ctrlxSheetRole to ""',
        '            set ctrlxSheetSubrole to ""',
        "            try",
        '              set ctrlxSheetName to name of ctrlxSheet',
        "            end try",
        "            try",
        '              set ctrlxSheetRole to role of ctrlxSheet',
        "            end try",
        "            try",
        '              set ctrlxSheetSubrole to subrole of ctrlxSheet',
        "            end try",
        '            set end of ctrlxSheetNames to (ctrlxSheetName & "/" & ctrlxSheetRole & "/" & ctrlxSheetSubrole)',
        "          end repeat",
        '          set AppleScript\'s text item delimiters to ","',
        '          set ctrlxSheetSummary to ctrlxSheetNames as text',
        '          set AppleScript\'s text item delimiters to ""',
        "        end try",
        '        set end of ctrlxWindowDiagnostics to (ctrlxWindowName & "/" & ctrlxWindowRole & "/" & ctrlxWindowSubrole & "/sheets:" & ctrlxSheetSummary)',
        "      end repeat",
        "    end if",
        "    if ctrlxFrontWindow is not missing value then",
        "      try",
        "        if (count of sheets of ctrlxFrontWindow) > 0 then",
        "          set ctrlxCreateWindow to item 1 of sheets of ctrlxFrontWindow",
        "        end if",
        "      end try",
        "    end if",
        "    if ctrlxCreateWindow is missing value and ctrlxFrontWindow is not missing value then",
        "      repeat with ctrlxSheet in every sheet of ctrlxFrontWindow",
        "        try",
          '          set ctrlxSheetName to name of ctrlxSheet',
        "        on error",
          '          set ctrlxSheetName to ""',
        "        end try",
        '        if ctrlxSheetName contains "New Track" or ctrlxSheetName contains "Create New Track" then',
        "          set ctrlxCreateWindow to ctrlxSheet",
        "          exit repeat",
        "        end if",
        "      end repeat",
        "    end if",
        "    if ctrlxCreateWindow is missing value then",
        "      repeat with ctrlxWindow in every window",
        "        try",
          '          set ctrlxWindowName to name of ctrlxWindow',
        "        on error",
          '          set ctrlxWindowName to ""',
        "        end try",
        "        try",
        '          set ctrlxWindowRole to role of ctrlxWindow',
        "        on error",
        '          set ctrlxWindowRole to ""',
        "        end try",
        "        try",
        '          set ctrlxWindowSubrole to subrole of ctrlxWindow',
        "        on error",
        '          set ctrlxWindowSubrole to ""',
        "        end try",
        '        if ctrlxWindowRole is "AXSheet" or ctrlxWindowSubrole is "AXSystemDialog" then',
        "          set ctrlxCreateWindow to ctrlxWindow",
        "          exit repeat",
        "        end if",
        '        if ctrlxWindowName contains "New Track" or ctrlxWindowName contains "Create New Track" then',
        "          set ctrlxCreateWindow to ctrlxWindow",
        "          exit repeat",
        "        end if",
        "        try",
        "          repeat with ctrlxSheet in every sheet of ctrlxWindow",
        "            try",
        '              set ctrlxSheetName to name of ctrlxSheet',
        "            on error",
        '              set ctrlxSheetName to ""',
        "            end try",
        '            if ctrlxSheetName contains "New Track" or ctrlxSheetName contains "Create New Track" then',
        "              set ctrlxCreateWindow to ctrlxSheet",
        "              exit repeat",
        "            end if",
        "          end repeat",
        "        end try",
        "        if ctrlxCreateWindow is not missing value then exit repeat",
        "      end repeat",
        "    end if",
        "    if ctrlxCreateWindow is missing value then",
        "      if ctrlxDiagnosticsEnabled then",
        '        set AppleScript\'s text item delimiters to " || "',
        '        set ctrlxWindowDiagnosticsText to ctrlxWindowDiagnostics as text',
        '        set AppleScript\'s text item delimiters to ""',
        '        error "Could not find the Logic Create New Track dialog. front_window=" & ctrlxFrontWindowName & " role=" & ctrlxFrontWindowRole & " subrole=" & ctrlxFrontWindowSubrole & " windows=" & ctrlxWindowDiagnosticsText',
        "      else",
        '        error "Could not find the Logic Create New Track dialog."',
        "      end if",
        "    end if",
        "    try",
        '      click radio button "Audio" of ctrlxCreateWindow',
        "    on error",
        "      try",
        '        click button "Audio" of ctrlxCreateWindow',
        "      end try",
        "    end try",
        "    delay 0.1",
        "    try",
        "      set value of text field 1 of ctrlxCreateWindow to (ctrlxRequestedTrackCount as text)",
        "    on error",
        "      try",
        '        keystroke "a" using {command down}',
        "        delay 0.05",
        "        keystroke (ctrlxRequestedTrackCount as text)",
        "      on error",
        '        error "Could not set the number of Logic audio tracks to create."',
        "      end try",
        "    end try",
        "    delay 0.1",
        '    set ctrlxCreateConfirmedWith to ""',
        "    try",
        "      key code 36",
        '      set ctrlxCreateConfirmedWith to "return_key"',
        "    on error",
        "      try",
        '        perform action "AXPress" of button "Create" of ctrlxCreateWindow',
        '        set ctrlxCreateConfirmedWith to "create_button_axpress"',
        "      on error",
        "        try",
        '          click button "Create" of ctrlxCreateWindow',
        '          set ctrlxCreateConfirmedWith to "create_button_click"',
        "        on error",
        '          error "Could not confirm the Logic Create New Track dialog."',
        "        end try",
        "      end try",
        "    end try",
        "    delay 0.8",
        "    return (ctrlxRequestedTrackCount as text) & \"|\" & ctrlxCreateConfirmedWith",
        "  end tell",
        "end tell"
      ],
      { timeoutMs: 12_000 }
    );

    const [createdCount = String(count), createConfirmedWith = "unknown"] = (result.stdout || "").split("|");

    debugImportAutomationHost("host_action_succeeded", {
      commandId: CtrlxCommand.CreateAudioTrack,
      actionType: "create_audio_track",
      count,
      createConfirmedWith
    });

    return {
      command: CtrlxCommand.CreateAudioTrack,
      ok: true,
      message: `Created ${count} Logic audio track${count === 1 ? "" : "s"}.`,
      data: {
        count,
        strategy: "logic_create_new_track_dialog_audio",
        createConfirmedWith,
        createdCount: Number.parseInt(createdCount, 10) || count,
        stdout: result.stdout || undefined,
        stderr: result.stderr || undefined
      }
    };
  } catch (error) {
    debugImportAutomationHost("host_action_failed", {
      commandId: CtrlxCommand.CreateAudioTrack,
      actionType: "create_audio_track",
      count,
      reason: getErrorMessage(error)
    });
    throw new Error(`Failed to create Logic audio track${count === 1 ? "" : "s"}: ${getErrorMessage(error)}`);
  }
}

export async function requestImportSelection(
  context: LogicActionContext,
  input?: CommandExecutionInput
): Promise<CommandResultPayload> {
  if (!context.requestImportSelection) {
    throw new Error("import.request_selection requires host file picker support.");
  }

  const requestInput = parseRequestImportSelectionInput(input);
  context.logger(`Running Logic action ${CtrlxCommand.RequestImportSelection}`);

  const result = await context.requestImportSelection({
    allowFolders: requestInput.allowFolders
  });

  if (!result) {
    return {
      command: CtrlxCommand.RequestImportSelection,
      ok: true,
      message: "Host import selection was cancelled.",
      data: {
        cancelled: true
      }
    };
  }

  return {
    command: CtrlxCommand.RequestImportSelection,
    ok: true,
    message:
      result.acceptedCount > 0
        ? `Host prepared an import plan for ${result.acceptedCount} audio file${result.acceptedCount === 1 ? "" : "s"}.`
        : `No supported audio files were found in ${result.sourceName}.`,
    data: {
      cancelled: false,
      ...result
    }
  };
}

function buildImportExecutionCommandInput(action: ImportAutomationExecutableActionRequest): CommandExecutionInput {
  if (action.type === "create_audio_track") {
    return {
      count: action.count ?? 1
    };
  }

  if (action.type === "rename_track") {
    return {
      target: action.target,
      newName: action.intendedName ?? "",
      previousName: action.previousName ?? undefined
    };
  }

  return {
    target: action.target,
    color: action.intendedColor ?? "neutral",
    previousColor: null
  };
}

function getPinnedSelectedTarget(expectedCurrentName: string | null): ImportAutomationTrackTarget {
  return createSelectedImportAutomationTrackTarget(expectedCurrentName);
}

function getExpectedCurrentNameFromTarget(target: ImportAutomationTrackTarget | null): string | null {
  if (!target || !("expectedCurrentName" in target)) {
    return null;
  }

  return typeof target.expectedCurrentName === "string" || target.expectedCurrentName === null
    ? target.expectedCurrentName
    : null;
}

function getPinnedTargetFromImportedTrackResult(
  importResult: Record<string, unknown> | null,
  fallbackName: string | null
): ImportAutomationTrackTarget {
  const postImportTrack =
    importResult && typeof importResult.postImportTrack === "object" && importResult.postImportTrack !== null
      ? (importResult.postImportTrack as Record<string, unknown>)
      : null;
  const mappedTarget =
    postImportTrack &&
    typeof postImportTrack.target === "object" &&
    postImportTrack.target !== null &&
    typeof (postImportTrack.target as Record<string, unknown>).kind === "string"
      ? ((postImportTrack.target as Record<string, unknown>) as ImportAutomationTrackTarget)
      : null;

  if (mappedTarget?.kind === "index" && typeof mappedTarget.trackIndex === "number") {
    return {
      kind: "index",
      trackIndex: mappedTarget.trackIndex,
      expectedCurrentName:
        typeof mappedTarget.expectedCurrentName === "string" || mappedTarget.expectedCurrentName === null
          ? mappedTarget.expectedCurrentName
          : fallbackName
    };
  }

  if (mappedTarget?.kind === "name" && typeof mappedTarget.trackName === "string") {
    return {
      kind: "name",
      trackName: mappedTarget.trackName,
      expectedCurrentName:
        typeof mappedTarget.expectedCurrentName === "string" || mappedTarget.expectedCurrentName === null
          ? mappedTarget.expectedCurrentName
          : fallbackName
    };
  }

  const resolvedTrackName =
    postImportTrack && typeof postImportTrack.resolvedTrackName === "string"
      ? postImportTrack.resolvedTrackName
      : fallbackName;

  return getPinnedSelectedTarget(resolvedTrackName ?? null);
}

function emitImportExecutionProgress(
  context: LogicActionContext,
  update: ImportExecutionProgressUpdate
): void {
  context.emitStatus?.(update.message, update as unknown as Record<string, unknown>);
}

async function moveSelectedLogicTrackByOffset(
  context: LogicActionContext,
  offset: number
): Promise<void> {
  if (!Number.isFinite(offset) || offset === 0) {
    return;
  }

  const steps = Math.abs(Math.trunc(offset));
  const keyCode = offset < 0 ? 126 : 125;

  await context.applescript.run(
    [
      'tell application "Logic Pro" to activate',
      "delay 0.05",
      'tell application "System Events"',
      '  tell process "Logic Pro"',
      "    set frontmost to true",
      ...Array.from({ length: steps }, () => `    key code ${keyCode}`),
      "  end tell",
      "end tell"
    ],
    { timeoutMs: 8_000 }
  );
}

export async function executeImportPlan(
  context: LogicActionContext,
  input?: CommandExecutionInput
): Promise<CommandResultPayload> {
  if (!context.runCommandById) {
    throw new Error("import.execute_plan requires command execution support on the host.");
  }
  const runCommandById = context.runCommandById;

  const executeInput = parseExecuteImportPlanInput(input);
  const reviewedPlan: ImportAutomationPlan = executeInput.plan;
  let importSession = executeInput.importSessionId
    ? context.getImportUploadSession?.(executeInput.importSessionId) ?? null
    : null;

  if (!importSession && executeInput.folderPath) {
    const discoveredFiles = await discoverDirectFolderImportAudioFiles(executeInput.folderPath);
    importSession = {
      sessionId: executeInput.importSessionId ?? `direct-folder:${executeInput.folderPath}`,
      sourceName: basename(executeInput.folderPath),
      workingDirectory: executeInput.folderPath,
      items: reviewedPlan.items,
      audioFiles: discoveredFiles,
      acceptedCount: discoveredFiles.length,
      skippedCount: 0,
      errorCount: 0,
      createdAt: new Date().toISOString()
    };
  }

  if (!importSession) {
    emitImportExecutionProgress(context, {
      kind: "import_execution",
      phase: "failed",
      status: "failed",
      message:
        executeInput.importSessionId
          ? `Import session ${executeInput.importSessionId} could not be found on the host.`
          : `Import folder ${executeInput.folderPath ?? "unknown"} could not be read on the host.`,
      totalItems: reviewedPlan.items.length,
      processedItems: 0,
      reason: executeInput.importSessionId ? "missing_import_session" : "missing_import_folder"
    });
    throw new Error(
      executeInput.importSessionId
        ? `import.execute_plan could not find host import session ${executeInput.importSessionId}.`
        : `import.execute_plan could not read host folder ${executeInput.folderPath ?? "unknown"}.`
    );
  }
  if (importSession.audioFiles.length < reviewedPlan.items.length) {
    emitImportExecutionProgress(context, {
      kind: "import_execution",
      phase: "failed",
      status: "failed",
      message: "The reviewed import plan does not match the discovered host files.",
      totalItems: reviewedPlan.items.length,
      processedItems: 0,
      reason: "insufficient_host_audio_files"
    });
    throw new Error(
      `import.execute_plan has ${reviewedPlan.items.length} reviewed item(s) but only ${importSession.audioFiles.length} discovered host audio file(s).`
    );
  }

  context.logger(`Running Logic action ${CtrlxCommand.ExecuteImportPlan}`);
  const pipelinePlan = buildLogicImportPipelinePlan(reviewedPlan, importSession);
  const importOperationId = `import-execution-${Date.now()}`;
  debugImportAutomationHost("host_action_start", {
    commandId: CtrlxCommand.ExecuteImportPlan,
    itemCount: reviewedPlan.items.length,
    importSessionId: executeInput.importSessionId,
    availableAudioFiles: importSession.audioFiles.length,
    importStrategy: pipelinePlan.importStrategy,
    commonSourceSelectionPath: pipelinePlan.commonSourceSelectionPath
  });
  emitImportExecutionProgress(context, {
    kind: "import_execution",
    phase: "review_confirmed",
    status: "succeeded",
    message: `Review confirmed for ${reviewedPlan.items.length} import item${reviewedPlan.items.length === 1 ? "" : "s"}.`,
    totalItems: reviewedPlan.items.length,
    processedItems: 0
  });
  emitImportExecutionProgress(context, {
    kind: "import_execution",
    phase: "import_started",
    status: "running",
    message:
      pipelinePlan.importStrategy === "finder_preselection_candidate"
        ? "Host import execution started with a Forte-style source selection candidate and per-track Logic execution."
        : "Host import execution started with per-track Logic execution.",
    totalItems: reviewedPlan.items.length,
    processedItems: 0
  });
  emitImportExecutionProgress(context, {
    kind: "import_execution",
    phase: "ordering",
    status: "pending",
    message:
      reviewedPlan.suggestionActions.length > 0
        ? `Session ordering, grouping, and routing suggestions are ready for review only. ${reviewedPlan.suggestionActions.length} post-import suggestion action${
            reviewedPlan.suggestionActions.length === 1 ? "" : "s"
          } remain non-executable.`
        : "No suggestion-only ordering or grouping actions were generated for this import plan.",
    totalItems: reviewedPlan.items.length,
    processedItems: 0,
    reason: reviewedPlan.suggestionActions.length > 0 ? "suggestion_only_actions" : null
  });

  let activeItemIndex = -1;
  let pinnedTarget: ImportAutomationTrackTarget | null = null;
  let importedTrackReady = false;
  let processedItems = 0;
  let currentCreatedTrackOffset = 0;
  let currentProgressMessage =
    pipelinePlan.importStrategy === "finder_preselection_candidate"
      ? "Host import execution started with a Forte-style source selection candidate and per-track Logic execution."
      : "Host import execution started with per-track Logic execution.";
  let currentProgressPhase: ImportExecutionProgressUpdate["phase"] = "import_started";
  let currentProgressFilename: string | null = null;
  let currentProgressAction: ImportExecutionProgressUpdate["action"] = null;

  const importKeepAliveTimer = setInterval(() => {
    emitImportExecutionProgress(context, {
      kind: "import_execution",
      phase: currentProgressPhase,
      status: "running",
      message: currentProgressMessage,
      operationId: importOperationId,
      heartbeatAt: createTimestamp(),
      keepAlive: true,
      totalItems: reviewedPlan.items.length,
      processedItems,
      itemIndex: activeItemIndex >= 0 ? activeItemIndex : null,
      originalFilename: currentProgressFilename,
      action: currentProgressAction
    });
  }, 4_000);

  try {
    if (reviewedPlan.items.length > 0) {
      currentProgressPhase = "item_progress";
      currentProgressMessage = `Creating ${reviewedPlan.items.length} Logic audio track${
        reviewedPlan.items.length === 1 ? "" : "s"
      } before import starts.`;
      currentProgressAction = "imported";
      emitImportExecutionProgress(context, {
        kind: "import_execution",
        phase: "item_progress",
        status: "running",
        message: currentProgressMessage,
        totalItems: reviewedPlan.items.length,
        processedItems: 0,
        action: "imported"
      });

      try {
        await runCommandById(CtrlxCommand.CreateAudioTrack, {
          count: reviewedPlan.items.length
        });
        await moveSelectedLogicTrackByOffset(context, -(reviewedPlan.items.length - 1));
        currentCreatedTrackOffset = 0;

        currentProgressMessage = `Created ${reviewedPlan.items.length} Logic audio track${
          reviewedPlan.items.length === 1 ? "" : "s"
        } for the import batch.`;
        emitImportExecutionProgress(context, {
          kind: "import_execution",
          phase: "item_progress",
          status: "succeeded",
          message: currentProgressMessage,
          totalItems: reviewedPlan.items.length,
          processedItems: 0,
          action: "imported"
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Failed to create the Logic import track batch.";
        currentProgressPhase = "failed";
        currentProgressMessage = "Failed to create the Logic audio tracks required for this import batch.";
        emitImportExecutionProgress(context, {
          kind: "import_execution",
          phase: "failed",
          status: "failed",
          message: currentProgressMessage,
          totalItems: reviewedPlan.items.length,
          processedItems: 0,
          reason
        });
        throw new Error(reason);
      }
    }

    const report: ImportAutomationExecutionReport = await executePreparedImportAutomationPlan(
      {
        source: "import_automation_prepared",
        plan: reviewedPlan,
        executableItems: reviewedPlan.executableItems,
        suggestionActions: reviewedPlan.suggestionActions
      },
      async (item, action, index) => {
      if (index !== activeItemIndex) {
        activeItemIndex = index;
        const requestedOffset = index;
        const offsetDelta = requestedOffset - currentCreatedTrackOffset;
        if (offsetDelta !== 0) {
          await moveSelectedLogicTrackByOffset(context, offsetDelta);
          currentCreatedTrackOffset = requestedOffset;
        }
        pinnedTarget = getPinnedSelectedTarget(null);
        importedTrackReady = false;
        currentProgressPhase = "item_started";
        currentProgressMessage = `Processing ${item.originalFilename}.`;
        currentProgressFilename = item.originalFilename;
        currentProgressAction = null;
        emitImportExecutionProgress(context, {
          kind: "import_execution",
          phase: "item_started",
          status: "running",
          message: currentProgressMessage,
          totalItems: reviewedPlan.items.length,
          processedItems,
          itemIndex: index,
          originalFilename: item.originalFilename
        });
      }
      const pipelineItem = pipelinePlan.items[index] ?? null;
      const audioFile = pipelineItem?.audioFile ?? importSession.audioFiles[index] ?? null;

      const effectiveAction: ImportAutomationExecutableActionRequest =
        action.type === "rename_track" || action.type === "set_track_color"
          ? {
              ...action,
              target: pinnedTarget ?? action.target,
              previousName: getExpectedCurrentNameFromTarget(pinnedTarget ?? action.target)
            }
          : action;

      try {
        let result: CommandResultPayload;

        if (effectiveAction.type === "create_audio_track") {
          emitImportExecutionProgress(context, {
            kind: "import_execution",
            phase: "importing",
            status: "running",
            message: `Importing ${item.originalFilename} into the current Logic project.`,
            totalItems: reviewedPlan.items.length,
            processedItems,
            itemIndex: index,
            originalFilename: item.originalFilename,
            action: "imported"
          });
          if (!audioFile) {
            emitImportExecutionProgress(context, {
              kind: "import_execution",
              phase: "item_progress",
              status: "failed",
              message: `No discovered host file matched ${item.originalFilename}.`,
              totalItems: reviewedPlan.items.length,
              processedItems,
              itemIndex: index,
              originalFilename: item.originalFilename,
              action: "imported",
              reason: "missing_host_audio_file"
            });
            return {
              ok: false,
              reason: "No discovered host audio file matched this reviewed import item.",
              message: "Audio import failed.",
              actualName: null,
              actualColor: null
            };
          }

          result = await runCommandById(CtrlxCommand.ImportAudioFilesIntoCurrentProject, {
            filePaths: [audioFile.path]
          });
          const importResults = Array.isArray(result.data?.results)
            ? (result.data.results as Array<Record<string, unknown>>)
            : [];
          const firstImportResult = importResults[0] ?? null;
          if (!firstImportResult || firstImportResult.ok !== true) {
            const importFailureReason =
              typeof firstImportResult?.reason === "string"
                ? firstImportResult.reason
                : typeof firstImportResult?.message === "string"
                  ? firstImportResult.message
                  : "Audio import host action did not return a successful per-file result.";
            throw new Error(importFailureReason);
          }
          emitImportExecutionProgress(context, {
            kind: "import_execution",
            phase: "importing",
            status: "succeeded",
            message:
              pipelinePlan.importStrategy === "finder_preselection_candidate"
                ? `Imported ${item.originalFilename} into Logic using the Forte-style source selection path.`
                : `Imported ${item.originalFilename} into Logic.`,
            totalItems: reviewedPlan.items.length,
            processedItems,
            itemIndex: index,
            originalFilename: item.originalFilename,
            action: "imported"
          });
          pinnedTarget = getPinnedTargetFromImportedTrackResult(
            firstImportResult,
            item.cleanTrackName
          );
          const resolvedImportedTrackName = getExpectedCurrentNameFromTarget(pinnedTarget);
          if (resolvedImportedTrackName) {
            emitImportExecutionProgress(context, {
              kind: "import_execution",
              phase: "track_targeting",
              status: "running",
              message: `Targeted imported track "${resolvedImportedTrackName}" for ${item.originalFilename}.`,
              totalItems: reviewedPlan.items.length,
              processedItems,
              itemIndex: index,
              originalFilename: item.originalFilename,
              action: "imported"
            });
          } else {
            emitImportExecutionProgress(context, {
              kind: "import_execution",
              phase: "track_targeting",
              status: "failed",
              message: `Imported ${item.originalFilename}, but CTRLX could not resolve the post-import track target.`,
              totalItems: reviewedPlan.items.length,
              processedItems,
              itemIndex: index,
              originalFilename: item.originalFilename,
              action: "imported",
              reason: "track_target_unresolved"
            });
          }
          importedTrackReady = true;
        } else {
          if (!importedTrackReady) {
            emitImportExecutionProgress(context, {
              kind: "import_execution",
              phase: "item_progress",
              status: "skipped",
              message: `${item.originalFilename} ${effectiveAction.type === "rename_track" ? "rename" : "color"} skipped because import failed.`,
              totalItems: reviewedPlan.items.length,
              processedItems,
              itemIndex: index,
              originalFilename: item.originalFilename,
              action: effectiveAction.type === "rename_track" ? "renamed" : "colored",
              reason: "import_failed_for_item"
            });
            return {
              ok: false,
              reason: "Skipped because the audio import step for this item did not complete successfully.",
              message:
                effectiveAction.type === "rename_track"
                  ? "Track rename skipped."
                  : "Track color assignment skipped.",
              actualName: effectiveAction.previousName ?? null,
              actualColor: null
            };
          }

          const commandId =
            effectiveAction.type === "rename_track" ? CtrlxCommand.RenameTrack : CtrlxCommand.SetTrackColor;
          currentProgressPhase = effectiveAction.type === "rename_track" ? "renaming" : "coloring";
          currentProgressMessage =
            effectiveAction.type === "rename_track"
              ? `Renaming ${item.originalFilename} to ${effectiveAction.intendedName ?? item.cleanTrackName}.`
              : `Coloring ${item.originalFilename} as ${effectiveAction.intendedColor ?? item.assignedColor}.`;
          currentProgressAction = effectiveAction.type === "rename_track" ? "renamed" : "colored";
          emitImportExecutionProgress(context, {
            kind: "import_execution",
            phase: effectiveAction.type === "rename_track" ? "renaming" : "coloring",
            status: "running",
            message: currentProgressMessage,
            totalItems: reviewedPlan.items.length,
            processedItems,
            itemIndex: index,
            originalFilename: item.originalFilename,
            action: effectiveAction.type === "rename_track" ? "renamed" : "colored"
          });
          result = await runCommandById(commandId, buildImportExecutionCommandInput(effectiveAction));
          emitImportExecutionProgress(context, {
            kind: "import_execution",
            phase: effectiveAction.type === "rename_track" ? "renaming" : "coloring",
            status: "succeeded",
            message:
              effectiveAction.type === "rename_track"
                ? `Renamed ${item.originalFilename} to ${effectiveAction.intendedName ?? item.cleanTrackName}.`
                : `Applied color ${effectiveAction.intendedColor ?? item.assignedColor} to ${item.originalFilename}.`,
            totalItems: reviewedPlan.items.length,
            processedItems,
            itemIndex: index,
            originalFilename: item.originalFilename,
            action: effectiveAction.type === "rename_track" ? "renamed" : "colored"
          });
        }

        const actualName =
          typeof result.data?.newName === "string"
            ? result.data.newName
            : effectiveAction.type === "rename_track"
              ? effectiveAction.intendedName ?? item.cleanTrackName
              : effectiveAction.type === "set_track_color"
                ? effectiveAction.previousName ?? null
                : null;
        const actualColor =
          typeof result.data?.color === "string"
            ? (result.data.color as ImportAutomationColor)
            : effectiveAction.type === "set_track_color"
              ? effectiveAction.intendedColor ?? item.assignedColor
              : null;

        if (effectiveAction.type !== "create_audio_track") {
          pinnedTarget = getPinnedSelectedTarget(actualName ?? item.cleanTrackName);
        }

        return {
          ok: true,
          message:
            typeof result.message === "string" && result.message.length > 0
              ? result.message
              : `Processed ${item.originalFilename}.`,
          actualName,
          actualColor
        };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Command execution failed.";
        currentProgressPhase = "item_progress";
        currentProgressMessage = `${item.originalFilename} ${effectiveAction.type === "create_audio_track" ? "import" : effectiveAction.type === "rename_track" ? "rename" : "color"} failed.`;
        currentProgressFilename = item.originalFilename;
        currentProgressAction =
          effectiveAction.type === "create_audio_track"
            ? "imported"
            : effectiveAction.type === "rename_track"
              ? "renamed"
              : "colored";
        emitImportExecutionProgress(context, {
          kind: "import_execution",
          phase: "item_progress",
          status: "failed",
          message: currentProgressMessage,
          totalItems: reviewedPlan.items.length,
          processedItems,
          itemIndex: index,
          originalFilename: item.originalFilename,
          action:
            effectiveAction.type === "create_audio_track"
              ? "imported"
              : effectiveAction.type === "rename_track"
                ? "renamed"
                : "colored",
          reason
        });
        return {
          ok: false,
          reason,
          message:
            effectiveAction.type === "create_audio_track"
              ? "Audio import failed."
              : effectiveAction.type === "rename_track"
                ? "Track rename failed."
                : "Track color assignment failed.",
          actualName: effectiveAction.previousName ?? null,
          actualColor: null
        };
      }
      }
    );

    processedItems = report.totalItems;
    currentProgressPhase = report.failedActions === 0 ? "completed" : "failed";
    currentProgressMessage = report.summary;
    currentProgressFilename = null;
    currentProgressAction = null;
    emitImportExecutionProgress(context, {
      kind: "import_execution",
      phase: currentProgressPhase,
      status: report.failedActions === 0 ? "succeeded" : "failed",
      message: report.summary,
      totalItems: report.totalItems,
      processedItems
    });

    debugImportAutomationHost("host_action_succeeded", {
      commandId: CtrlxCommand.ExecuteImportPlan,
      totalItems: report.totalItems,
      successfulItems: report.successfulItems,
      failedItems: report.failedItems
    });

    return {
      command: CtrlxCommand.ExecuteImportPlan,
      ok: true,
      message: report.summary,
      data: {
        report,
        pipeline: pipelinePlan,
        operationId: importOperationId
      }
    };
  } finally {
    clearInterval(importKeepAliveTimer);
  }
}

export const playStop = createSystemEventsKeystrokeAction(
  "transport.play_stop",
  "Triggered Logic play/stop toggle.",
  " "
);

export const saveProject = createSystemEventsKeystrokeAction(
  "session.save",
  "Triggered Logic save project.",
  "s",
  ["command"]
);

export const undo = createSystemEventsKeystrokeAction(
  "edit.undo",
  "Triggered Logic undo.",
  "z",
  ["command"]
);

export async function zoomInHorizontal(context: LogicActionContext): Promise<CommandResultPayload> {
  return runLogicKeyCodeAction(context, {
    commandId: CtrlxCommand.ZoomInHorizontal,
    description: "Triggered Logic horizontal zoom in.",
    keyCode: 19,
    strategy: "logic_number_row_key_code_2"
  });
}

export async function zoomOutHorizontal(context: LogicActionContext): Promise<CommandResultPayload> {
  return runLogicKeyCodeAction(context, {
    commandId: CtrlxCommand.ZoomOutHorizontal,
    description: "Triggered Logic horizontal zoom out.",
    keyCode: 18,
    strategy: "logic_number_row_key_code_1"
  });
}

export async function zoomInVertical(context: LogicActionContext): Promise<CommandResultPayload> {
  return runLogicKeyCodeAction(context, {
    commandId: CtrlxCommand.ZoomInVertical,
    description: "Triggered Logic vertical zoom in.",
    keyCode: 21,
    strategy: "logic_number_row_key_code_4"
  });
}

export async function zoomOutVertical(context: LogicActionContext): Promise<CommandResultPayload> {
  return runLogicKeyCodeAction(context, {
    commandId: CtrlxCommand.ZoomOutVertical,
    description: "Triggered Logic vertical zoom out.",
    keyCode: 20,
    strategy: "logic_number_row_key_code_3"
  });
}

export async function openSelectedEditor(context: LogicActionContext): Promise<CommandResultPayload> {
  return runLogicKeyCodeAction(context, {
    commandId: CtrlxCommand.OpenSelectedEditor,
    description: "Triggered Logic open selected editor.",
    keyCode: 14,
    strategy: "logic_editor_key_command_e"
  });
}

export const muteSelectedTrack = createSystemEventsKeystrokeAction(
  "track.mute_selected",
  "Triggered mute selected track.",
  "m"
);

export const soloSelectedTrack = createSystemEventsKeystrokeAction(
  "track.solo_selected",
  "Triggered solo selected track.",
  "s"
);

export const armSelectedTrack = createSystemEventsKeystrokeAction(
  "track.arm_selected",
  "Triggered arm selected track placeholder.",
  "r"
);

export async function bounceProject({ applescript, logger }: LogicActionContext): Promise<CommandResultPayload> {
  logger("Running Logic action session.bounce");

  const result = await applescript.run([
    'tell application "Logic Pro" to activate',
    'tell application "System Events"',
    '  keystroke "b" using {command down}',
    "end tell"
  ]);

  return {
    command: "session.bounce",
    ok: true,
    message: "Triggered Logic bounce placeholder.",
    data: {
      stdout: result.stdout || undefined,
      stderr: result.stderr || undefined
    }
  };
}

export async function renameTrack(
  { applescript, logger }: LogicActionContext,
  input?: CommandExecutionInput
): Promise<CommandResultPayload> {
  const renameInput = parseRenameTrackInput(input);
  const resolvedTarget = await resolveLogicTrackTarget(renameInput.target, CtrlxCommand.RenameTrack, {
    applescript,
    logger
  });
  const targetDescriptor = resolvedTarget.descriptor;
  const escapedNewName = escapeAppleScriptString(renameInput.newName);

  logger(`Running Logic action ${CtrlxCommand.RenameTrack}`);
  if (HOST_COMMAND_DEBUG) {
    logger(
      `[debug] track.rename target=${renameInput.target.kind} expectedCurrentName=${
        renameInput.target.expectedCurrentName ?? "n/a"
      } resolved=${resolvedTarget.strategy} newName=${renameInput.newName}`
    );
  }
  debugImportAutomationHost("host_action_start", {
    commandId: CtrlxCommand.RenameTrack,
    targetKind: renameInput.target.kind,
    targetDescriptor,
    targetStrategy: resolvedTarget.strategy,
    actionType: "rename_track",
    intendedName: renameInput.newName
  });

  if (resolvedTarget.resolvedTrackIndex && resolvedTarget.resolvedTrackIndex >= 1) {
    await resolveLogicTrackTarget(
      {
        kind: "index",
        trackIndex: resolvedTarget.resolvedTrackIndex,
        expectedCurrentName: resolvedTarget.resolvedTrackName ?? renameInput.target.expectedCurrentName ?? null
      },
      CtrlxCommand.RenameTrack,
      {
        applescript,
        logger
      }
    );
  }

  try {
    const result = await applescript.run(
      [
        `set ctrlxNewTrackName to "${escapedNewName}"`,
        'tell application "Logic Pro" to activate',
        "delay 0.1",
        'tell application "System Events"',
        '  tell process "Logic Pro"',
        "    set frontmost to true",
        "    try",
        '      set ctrlxAnySelectedRows to (count of (every row of entire contents of front window whose selected is true))',
        "    on error",
        '      set ctrlxAnySelectedRows to -1',
        "    end try",
        "    try",
        '      key code 36 using {shift down}',
        "    on error",
        '      error "rename_shortcut_failed"',
        "    end try",
        "    delay 0.12",
        '    keystroke "a" using {command down}',
        "    delay 0.05",
        "    keystroke ctrlxNewTrackName",
        "    delay 0.05",
        "    key code 36",
        '    return "selected_track_rename_shortcut|selected_rows=" & (ctrlxAnySelectedRows as text)',
        "  end tell",
        "end tell"
      ],
      { timeoutMs: 12_000 }
    );

    debugImportAutomationHost("host_action_succeeded", {
      commandId: CtrlxCommand.RenameTrack,
      targetKind: renameInput.target.kind,
      targetDescriptor,
      actionType: "rename_track",
      intendedName: renameInput.newName,
      usedMenuTitle: result.stdout || null
    });

    return {
      command: CtrlxCommand.RenameTrack,
      ok: true,
      message: `Renamed the ${targetDescriptor} to "${renameInput.newName}".`,
      data: {
        target: renameInput.target.kind,
        targetDescriptor,
        targetStrategy: resolvedTarget.strategy,
        expectedCurrentName: renameInput.target.expectedCurrentName ?? undefined,
        previousName: renameInput.previousName ?? undefined,
        newName: renameInput.newName,
        strategy: "logic_selected_track_rename_shortcut_shift_return",
        usedMenuTitle: result.stdout || undefined,
        stdout: result.stdout || undefined,
        stderr: result.stderr || undefined
      }
    };
  } catch (error) {
    debugImportAutomationHost("host_action_failed", {
      commandId: CtrlxCommand.RenameTrack,
      targetKind: renameInput.target.kind,
      targetDescriptor,
      actionType: "rename_track",
      reason: getErrorMessage(error)
    });
    throw new Error(`Failed to rename the ${targetDescriptor}: ${getErrorMessage(error)}`);
  }
}

export async function setTrackColor(
  { applescript, logger }: LogicActionContext,
  input?: CommandExecutionInput
): Promise<CommandResultPayload> {
  const colorInput = parseSetTrackColorInput(input);
  const resolvedTarget =
    colorInput.target.kind === "selected"
      ? {
          target: colorInput.target,
          supportedKind: "selected" as const,
          descriptor: "selected Logic track",
          strategy: "selected_track" as const,
          resolvedTrackIndex: null,
          resolvedTrackName: colorInput.target.expectedCurrentName ?? null,
          selectionChanged: false
        }
      : await resolveLogicTrackTarget(colorInput.target, CtrlxCommand.SetTrackColor, {
          applescript,
          logger
        });
  const targetDescriptor = resolvedTarget.descriptor;
  const colorMapping = LOGIC_TRACK_COLOR_INDEX_FALLBACK_MAP[colorInput.color];
  const clickMapping = LOGIC_TRACK_COLOR_PALETTE_CLICK_MAP[colorInput.color];

  logger(`Running Logic action ${CtrlxCommand.SetTrackColor}`);
  if (HOST_COMMAND_DEBUG) {
    logger(
      `[debug] track.set_color target=${colorInput.target.kind} resolved=${resolvedTarget.strategy} color=${colorInput.color} fallbackIndex=${colorMapping.fallbackButtonIndex} click=${clickMapping.xRatio},${clickMapping.yRatio}`
    );
  }
  debugImportAutomationHost("host_action_start", {
    commandId: CtrlxCommand.SetTrackColor,
    targetKind: colorInput.target.kind,
    targetDescriptor,
    targetStrategy: resolvedTarget.strategy,
    actionType: "set_track_color",
    intendedColor: colorInput.color,
    colorPaletteLabel: colorMapping.label
  });

  if (resolvedTarget.resolvedTrackIndex && resolvedTarget.resolvedTrackIndex >= 1) {
    await resolveLogicTrackTarget(
      {
        kind: "index",
        trackIndex: resolvedTarget.resolvedTrackIndex,
        expectedCurrentName: resolvedTarget.resolvedTrackName ?? colorInput.target.expectedCurrentName ?? null
      },
      CtrlxCommand.SetTrackColor,
      {
        applescript,
        logger
      }
    );
  }

  try {
    const paletteResult = await applescript.run(
      [
        'on ctrlxFindColorWindow(ctrlxWindows)',
        "  repeat with ctrlxWindow in ctrlxWindows",
        '    set ctrlxWindowName to ""',
        '    set ctrlxWindowSubrole to ""',
        "    try",
        '      set ctrlxWindowName to name of ctrlxWindow',
        "    end try",
        "    try",
        '      set ctrlxWindowSubrole to subrole of ctrlxWindow',
        "    end try",
        '    if ctrlxWindowName contains "Color" or ctrlxWindowSubrole is "AXFloatingWindow" or ctrlxWindowSubrole is "AXSystemDialog" then',
        "      return ctrlxWindow",
        "    end if",
        "  end repeat",
        "  return missing value",
        "end ctrlxFindColorWindow",
        'tell application "Logic Pro" to activate',
        "delay 0.2",
        'tell application "System Events"',
        '  tell process "Logic Pro"',
        "    set frontmost to true",
        "    set ctrlxPaletteWindow to my ctrlxFindColorWindow(every window)",
        '    set ctrlxPaletteOpenedWithShortcut to "false"',
        "    if ctrlxPaletteWindow is missing value then",
        '      keystroke "c" using {option down}',
        "      delay 0.6",
        "      set ctrlxPaletteWindow to my ctrlxFindColorWindow(every window)",
        '      set ctrlxPaletteOpenedWithShortcut to "true"',
        "    end if",
        "    if ctrlxPaletteWindow is missing value then",
        '      error "Logic color palette did not appear after opening the track color command."',
        "    end if",
        "    try",
        "      set {ctrlxPaletteX, ctrlxPaletteY} to position of ctrlxPaletteWindow",
        "      set {ctrlxPaletteWidth, ctrlxPaletteHeight} to size of ctrlxPaletteWindow",
        "    on error",
        '      error "Could not read the Logic color palette window bounds."',
        "    end try",
        '    return (ctrlxPaletteX as text) & "|" & (ctrlxPaletteY as text) & "|" & (ctrlxPaletteWidth as text) & "|" & (ctrlxPaletteHeight as text) & "|" & ctrlxPaletteOpenedWithShortcut',
        "  end tell",
        "end tell"
      ],
      { timeoutMs: 12_000 }
    );

    const [paletteXText = "0", paletteYText = "0", paletteWidthText = "0", paletteHeightText = "0", paletteOpenedWithShortcut = "false"] =
      (paletteResult.stdout || "").split("|");
    const paletteX = Number.parseFloat(paletteXText);
    const paletteY = Number.parseFloat(paletteYText);
    const paletteWidth = Number.parseFloat(paletteWidthText);
    const paletteHeight = Number.parseFloat(paletteHeightText);

    if (
      !Number.isFinite(paletteX) ||
      !Number.isFinite(paletteY) ||
      !Number.isFinite(paletteWidth) ||
      !Number.isFinite(paletteHeight) ||
      paletteWidth <= 0 ||
      paletteHeight <= 0
    ) {
      throw new Error("Logic color palette returned invalid bounds.");
    }

    const clickX = Math.round(paletteX + paletteWidth * clickMapping.xRatio);
    const clickY = Math.round(paletteY + paletteHeight * clickMapping.yRatio);

    await clickScreenPoint(clickX, clickY);

    debugImportAutomationHost("host_action_succeeded", {
      commandId: CtrlxCommand.SetTrackColor,
      targetKind: colorInput.target.kind,
      targetDescriptor,
      actionType: "set_track_color",
      intendedColor: colorInput.color,
      paletteOpenedWithShortcut: paletteOpenedWithShortcut === "true",
      paletteBounds: {
        x: paletteX,
        y: paletteY,
        width: paletteWidth,
        height: paletteHeight
      },
      clickPoint: {
        x: clickX,
        y: clickY
      }
    });

    return {
      command: CtrlxCommand.SetTrackColor,
      ok: true,
      message: `Assigned the ${targetDescriptor} color to ${colorMapping.label}.`,
      data: {
        target: colorInput.target.kind,
        targetDescriptor,
        targetStrategy: resolvedTarget.strategy,
        expectedCurrentName: colorInput.target.expectedCurrentName ?? undefined,
        previousColor: colorInput.previousColor ?? undefined,
        color: colorInput.color,
        paletteLabel: colorMapping.label,
        strategy: "logic_track_color_palette_relative_click",
        paletteOpenedWithShortcut: paletteOpenedWithShortcut === "true",
        paletteBounds: {
          x: paletteX,
          y: paletteY,
          width: paletteWidth,
          height: paletteHeight
        },
        clickPoint: {
          x: clickX,
          y: clickY
        },
        clickRatio: {
          x: clickMapping.xRatio,
          y: clickMapping.yRatio
        },
        fallbackButtonIndex: colorMapping.fallbackButtonIndex,
        stdout: paletteResult.stdout || undefined,
        stderr: paletteResult.stderr || undefined
      }
    };
  } catch (error) {
    debugImportAutomationHost("host_action_failed", {
      commandId: CtrlxCommand.SetTrackColor,
      targetKind: colorInput.target.kind,
      targetDescriptor,
      actionType: "set_track_color",
      intendedColor: colorInput.color,
      reason: getErrorMessage(error)
    });
    throw new Error(`Failed to set the ${targetDescriptor} color: ${getErrorMessage(error)}`);
  }
}
