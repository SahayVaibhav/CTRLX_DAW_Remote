import { basename, dirname } from "node:path";
import { existsSync } from "node:fs";
import {
  CtrlxCommand,
  type CommandResultPayload,
  type ImportAudioFilesIntoCurrentProjectCommandInput
} from "#protocol";
import type { CommandExecutionContext, CommandExecutionInput } from "../commands/types.js";
import { captureCurrentlySelectedLogicTrack } from "./trackTargeting.js";

const LOGIC_IMPORT_AUDIO_MENU_CANDIDATES = [
  "Audio File...",
  "Audio Files...",
  "Audio File",
  "Audio Files",
  "Import Audio File...",
  "Import Audio Files...",
  "Import Audio File",
  "Import Audio Files"
] as const;
const LOGIC_IMPORT_PARENT_MENU_CANDIDATES = ["Import", "Import..."] as const;
const HOST_IMPORT_AUTOMATION_DEBUG =
  process.env.NODE_ENV !== "production" && process.env.CTRLX_DEBUG_IMPORT_AUTOMATION === "1";

type LogicImportFailureCategory =
  | "assistive_access_denied"
  | "app_not_frontmost"
  | "accessibility_target_missing"
  | "target_not_clickable"
  | "menu_path_missing"
  | "dialog_not_opened"
  | "dialog_not_closed"
  | "trigger_failed"
  | "import_trigger_timeout"
  | "unknown_ui_state";

type ImportAudioIntoCurrentProjectResult = {
  filePath: string;
  importedFilename: string;
  ok: boolean;
  message: string;
  reason?: string;
  failureCategory?: LogicImportFailureCategory;
  strategy?: string;
  applescriptStdout?: string;
  applescriptStderr?: string;
  timingMs?: number;
  triggerTimingMs?: number;
  diagnostics?: Record<string, unknown>;
  postImportTrack?: {
    resolved: boolean;
    target: {
      kind: "selected" | "index" | "name";
      trackIndex?: number;
      trackName?: string | null;
      expectedCurrentName?: string | null;
    } | null;
    resolvedTrackIndex: number | null;
    resolvedTrackName: string | null;
    strategy: string | null;
    descriptor: string | null;
    selectionChanged: boolean | null;
    reason?: string;
  };
};

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

function parseImportDiagnosticStdout(stdout: string | undefined): Record<string, string> {
  if (!stdout) {
    return {};
  }

  return stdout
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .reduce<Record<string, string>>((acc, part) => {
      const separatorIndex = part.indexOf("=");
      if (separatorIndex === -1) {
        if (!("result" in acc)) {
          acc.result = part;
        }
        return acc;
      }

      const key = part.slice(0, separatorIndex).trim();
      const value = part.slice(separatorIndex + 1).trim();
      if (key.length > 0) {
        acc[key] = value;
      }
      return acc;
    }, {});
}

function parseImportAudioFilesIntoCurrentProjectInput(
  input: CommandExecutionInput
): ImportAudioFilesIntoCurrentProjectCommandInput {
  if (!isRecord(input) || !Array.isArray(input.filePaths) || input.filePaths.length === 0) {
    throw new Error("import.import_audio_files_into_current_project requires a non-empty filePaths array.");
  }

  const filePaths = input.filePaths.map((value) => {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("import.import_audio_files_into_current_project filePaths must contain non-empty strings.");
    }

    return value.trim();
  });

  return {
    filePaths
  };
}

function classifyImportFailure(
  diagnostics: Record<string, string>,
  reason: string
): LogicImportFailureCategory {
  if (reason.includes("not allowed assistive access")) {
    return "assistive_access_denied";
  }

  if (reason.includes("timed out") || reason.includes("process timed out")) {
    return "import_trigger_timeout";
  }

  const frontmost = diagnostics.frontmost;
  const frontWindowAvailable = diagnostics.front_window_available;
  const parentCandidate = diagnostics.parent_candidate;
  const menuCandidate = diagnostics.menu_candidate;
  const buttonMatch = diagnostics.button_match;
  const dialogOpened = diagnostics.dialog_opened;

  if (frontmost === "false") {
    return "app_not_frontmost";
  }

  if (reason.includes("file_menu_available=false")) {
    return "accessibility_target_missing";
  }

  if (reason.includes("Could not find a Logic import audio trigger")) {
    return "trigger_failed";
  }

  if (reason.includes("did not close the Open File dialog")) {
    return "dialog_not_closed";
  }

  if (parentCandidate === "none") {
    return "menu_path_missing";
  }

  if (parentCandidate && parentCandidate !== "none" && menuCandidate === "none") {
    return "menu_path_missing";
  }

  if (buttonMatch && buttonMatch !== "none" && reason.includes("Could not find a Logic import audio trigger")) {
    return "target_not_clickable";
  }

  if (dialogOpened === "false" || dialogOpened === "same_front_window") {
    return "dialog_not_opened";
  }

  return "unknown_ui_state";
}

async function cleanupLingeringLogicImportDialog(
  context: Pick<CommandExecutionContext, "applescript" | "logger">,
  importedFilename: string
): Promise<Record<string, string>> {
  try {
    const cleanupResult = await context.applescript.run(
      [
        'tell application "Logic Pro" to activate',
        "delay 0.2",
        'tell application "System Events"',
        '  tell process "Logic Pro"',
        '    set ctrlxCleanupAttempted to "false"',
        '    set ctrlxCleanupResult to "not_needed"',
        '    set ctrlxCleanupFrontWindow to "missing"',
        '    set ctrlxCleanupFinalFrontWindow to "missing"',
        "    try",
        "      set frontmost to true",
        "    end try",
        "    try",
        "      if (count of windows) is greater than 0 then",
        '        set ctrlxCleanupFrontWindow to name of front window as text',
        "      end if",
        "    end try",
        '    if ctrlxCleanupFrontWindow is "Open File" then',
        '      set ctrlxCleanupAttempted to "true"',
        '      set ctrlxCleanupResult to "pending"',
        "      key code 53",
        "      delay 0.35",
        '      set ctrlxCleanupDeadline to (current date) + 3',
        "      repeat while (current date) is less than ctrlxCleanupDeadline",
        "        delay 0.1",
        "        try",
        "          if (count of windows) is greater than 0 then",
        '            set ctrlxCleanupFinalFrontWindow to name of front window as text',
        '            if ctrlxCleanupFinalFrontWindow is not "Open File" then',
        '              set ctrlxCleanupResult to "closed"',
        "              exit repeat",
        "            end if",
        "          else",
        '            set ctrlxCleanupFinalFrontWindow to "missing"',
        '            set ctrlxCleanupResult to "closed"',
        "            exit repeat",
        "          end if",
        "        on error",
        '          set ctrlxCleanupFinalFrontWindow to "unknown"',
        "        end try",
        "      end repeat",
        '      if ctrlxCleanupResult is "pending" then',
        '        set ctrlxCleanupResult to "still_open"',
        "      end if",
        "    else",
        '      set ctrlxCleanupFinalFrontWindow to ctrlxCleanupFrontWindow',
        "    end if",
        '    return "ctrlx_import_dialog_cleanup|cleanup_attempted=" & ctrlxCleanupAttempted & "|cleanup_result=" & ctrlxCleanupResult & "|cleanup_front_window=" & ctrlxCleanupFrontWindow & "|cleanup_final_front_window=" & ctrlxCleanupFinalFrontWindow',
        "  end tell",
        "end tell"
      ],
      { timeoutMs: 6_000 }
    );

    const cleanupDiagnostics = parseImportDiagnosticStdout(cleanupResult.stdout);
    debugImportAutomationHost("audio_import_cleanup", {
      filename: importedFilename,
      cleanupAttempted: cleanupDiagnostics.cleanup_attempted ?? null,
      cleanupResult: cleanupDiagnostics.cleanup_result ?? null,
      cleanupFrontWindow: cleanupDiagnostics.cleanup_front_window ?? null,
      cleanupFinalFrontWindow: cleanupDiagnostics.cleanup_final_front_window ?? null
    });
    return cleanupDiagnostics;
  } catch (cleanupError) {
    const cleanupReason = getErrorMessage(cleanupError);
    debugImportAutomationHost("audio_import_cleanup_failed", {
      filename: importedFilename,
      cleanupReason
    });
    return {
      cleanup_attempted: "true",
      cleanup_result: "cleanup_script_failed",
      cleanup_reason: cleanupReason
    };
  }
}

async function importSingleAudioFileIntoCurrentProject(
  context: Pick<CommandExecutionContext, "applescript" | "logger">,
  filePath: string
): Promise<ImportAudioIntoCurrentProjectResult> {
  const importedFilename = basename(filePath);
  if (!existsSync(filePath)) {
    return {
      filePath,
      importedFilename,
      ok: false,
      message: `Import source file ${importedFilename} does not exist.`,
      reason: `Import source file does not exist at ${filePath}`
    };
  }

  context.logger(`Running Logic audio import for ${importedFilename}`);
  const strategy = "logic_shortcut_open_dialog_import";
  const importStartedAt = Date.now();
  debugImportAutomationHost("audio_import_start", {
    filename: importedFilename,
    filePath,
    strategy
  });
  debugImportAutomationHost("audio_import_strategy_chosen", {
    filename: importedFilename,
    strategy,
    importParentMenuCandidates: [...LOGIC_IMPORT_PARENT_MENU_CANDIDATES],
    importMenuCandidates: [...LOGIC_IMPORT_AUDIO_MENU_CANDIDATES]
  });
  debugImportAutomationHost("audio_import_trigger_attempt", {
    filename: importedFilename,
    strategy,
    filePath
  });

  const escapedPath = escapeAppleScriptString(filePath);
  const escapedFilename = escapeAppleScriptString(importedFilename);
  const escapedFolderPath = escapeAppleScriptString(dirname(filePath));

  try {
    const result = await context.applescript.run(
      [
        "on ctrlxLowerText(ctrlxValue)",
        '  return do shell script "/bin/echo " & quoted form of ctrlxValue & " | /usr/bin/tr \'[:upper:]\' \'[:lower:]\'"',
        "end ctrlxLowerText",
        `set ctrlxImportPath to "${escapedPath}"`,
        `set ctrlxImportFolderPath to "${escapedFolderPath}"`,
        `set ctrlxImportFilename to "${escapedFilename}"`,
        'using terms from application "System Events"',
        "on ctrlxTrySelectFileInOpenDialog(ctrlxOpenDialogWindow, ctrlxImportFilename)",
        '  set ctrlxSelectionMethod to "none"',
        "  try",
        "    repeat with ctrlxOutline in every outline of ctrlxOpenDialogWindow",
        "      try",
        "        repeat with ctrlxRow in every row of ctrlxOutline",
        "          try",
        "            if value of static text 1 of ctrlxRow as text is ctrlxImportFilename then",
        "              try",
        "                set selected of ctrlxRow to true",
        "              end try",
        "              try",
        '                click ctrlxRow',
        "              end try",
        "              try",
        '                perform action "AXPress" of ctrlxRow',
        "              end try",
        '              set ctrlxSelectionMethod to "outline_static_text"',
        "              return ctrlxSelectionMethod",
        "            end if",
        "          end try",
        "          try",
        "            if name of ctrlxRow as text is ctrlxImportFilename then",
        "              try",
        "                set selected of ctrlxRow to true",
        "              end try",
        "              try",
        '                click ctrlxRow',
        "              end try",
        "              try",
        '                perform action "AXPress" of ctrlxRow',
        "              end try",
        '              set ctrlxSelectionMethod to "outline_row_name"',
        "              return ctrlxSelectionMethod",
        "            end if",
        "          end try",
        "        end repeat",
        "      end try",
        "    end repeat",
        "  end try",
        "  try",
        "    repeat with ctrlxBrowser in every browser of ctrlxOpenDialogWindow",
        "      try",
        "        repeat with ctrlxRow in every row of ctrlxBrowser",
        "          try",
        "            if value of static text 1 of ctrlxRow as text is ctrlxImportFilename then",
        "              try",
        "                set selected of ctrlxRow to true",
        "              end try",
        "              try",
        '                click ctrlxRow',
        "              end try",
        '              set ctrlxSelectionMethod to "browser_static_text"',
        "              return ctrlxSelectionMethod",
        "            end if",
        "          end try",
        "        end repeat",
        "      end try",
        "    end repeat",
        "  end try",
        "  try",
        '    keystroke "a" using {command down}',
        "    delay 0.05",
        "    keystroke ctrlxImportFilename",
        '    set ctrlxSelectionMethod to "filename_typed"',
        "    return ctrlxSelectionMethod",
        "  end try",
        "  return ctrlxSelectionMethod",
        "end ctrlxTrySelectFileInOpenDialog",
        "end using terms from",
        `set ctrlxImportParentMenuCandidates to {${LOGIC_IMPORT_PARENT_MENU_CANDIDATES.map((label) => `"${escapeAppleScriptString(label)}"`).join(", ")}}`,
        `set ctrlxImportMenuCandidates to {${LOGIC_IMPORT_AUDIO_MENU_CANDIDATES.map((label) => `"${escapeAppleScriptString(label)}"`).join(", ")}}`,
        'set ctrlxReadyTimeoutSeconds to 2.5',
        'tell application "Logic Pro" to activate',
        "delay 0.35",
        'tell application "System Events"',
        '  tell process "Logic Pro"',
        '    set ctrlxReadyDeadline to (current date) + ctrlxReadyTimeoutSeconds',
        '    set ctrlxFrontWindowName to "missing"',
        "    set ctrlxFrontWindowAvailable to false",
        '    set ctrlxFileMenuAvailable to "false"',
        '    set ctrlxWindowProbeError to "none"',
        '    set ctrlxFileMenuProbeError to "none"',
        '    set ctrlxReadyState to "pending"',
        "    set ctrlxImportTriggered to false",
        '    set ctrlxTriggerSource to "none"',
        '    set ctrlxMatchedParentCandidate to "none"',
        '    set ctrlxMatchedMenuCandidate to "none"',
        '    set ctrlxMatchedButtonDescriptor to "none"',
        '    set ctrlxShortcutTriggered to "false"',
        '    set ctrlxLogicFrontmostStatus to "false"',
        '    set ctrlxImportDialogOpened to "unknown"',
        '    set ctrlxDialogWindowName to "missing"',
        '    set ctrlxPostGotoFolderFrontWindow to "missing"',
        '    set ctrlxPostGotoFolderOpenDialogPresent to "false"',
        '    set ctrlxFileSelectionMethod to "none"',
        '    set ctrlxReadyFrontWindowName to "missing"',
        '    set ctrlxUsingExistingOpenDialog to "false"',
        '    set ctrlxExistingDialogReset to "not_needed"',
        "    set ctrlxTriggerDurationMs to -1",
        '    set ctrlxOpenDialogWindow to missing value',
        "    set ctrlxActionStartAt to current date",
        "    repeat while (current date) is less than ctrlxReadyDeadline",
        "      try",
        "        set frontmost to true",
        "      end try",
        "      delay 0.1",
        "      try",
        "        set ctrlxLogicFrontmostStatus to (frontmost as text)",
        "      end try",
        "      set ctrlxFrontWindowAvailable to false",
        '      set ctrlxFrontWindowName to "missing"',
        "      try",
        "        if (count of windows) is greater than 0 then",
        "          set ctrlxFrontWindowAvailable to true",
        "          set ctrlxFrontWindowName to name of front window as text",
        "        end if",
        "      on error errMsg",
        "        set ctrlxWindowProbeError to errMsg",
        "      end try",
        '      set ctrlxFileMenuAvailable to "false"',
        "      try",
        '        set ctrlxFileMenuTitle to title of menu bar item "File" of menu bar 1',
        '        if ctrlxFileMenuTitle is not "" then set ctrlxFileMenuAvailable to "true"',
        "      on error errMsg",
        "        set ctrlxFileMenuProbeError to errMsg",
        "      end try",
        '      if ctrlxLogicFrontmostStatus is "true" then',
        '        set ctrlxReadyState to "ready"',
        '        set ctrlxReadyFrontWindowName to ctrlxFrontWindowName',
        "        exit repeat",
        "      end if",
        "    end repeat",
        '    if ctrlxReadyState is not "ready" then',
        '      error "Logic import preflight failed. frontmost=" & ctrlxLogicFrontmostStatus & "; front_window=" & ctrlxFrontWindowName & "; front_window_available=" & (ctrlxFrontWindowAvailable as text) & "; file_menu_available=" & ctrlxFileMenuAvailable & "; window_probe_error=" & ctrlxWindowProbeError & "; file_menu_probe_error=" & ctrlxFileMenuProbeError',
        "    end if",
        "    delay 1.0",
        '    if ctrlxReadyFrontWindowName is "Open File" then',
        '      set ctrlxUsingExistingOpenDialog to "true"',
        '      set ctrlxExistingDialogReset to "attempted"',
        "      key code 53",
        "      delay 0.45",
        '      set ctrlxResetDeadline to (current date) + 3',
        '      set ctrlxResetFrontWindow to "missing"',
        '      set ctrlxExistingDialogReset to "pending"',
        "      repeat while (current date) is less than ctrlxResetDeadline",
        "        delay 0.1",
        "        try",
        "          if (count of windows) is greater than 0 then",
        '            set ctrlxResetFrontWindow to name of front window as text',
        '            if ctrlxResetFrontWindow is not "Open File" then',
        '              set ctrlxExistingDialogReset to "closed"',
        "              exit repeat",
        "            end if",
        "          else",
        '            set ctrlxResetFrontWindow to "missing"',
        '            set ctrlxExistingDialogReset to "closed"',
        "            exit repeat",
        "          end if",
        "        on error",
        '          set ctrlxResetFrontWindow to "unknown"',
        "        end try",
        "      end repeat",
        '      if ctrlxExistingDialogReset is not "closed" then',
        '        error "A stale Open File panel was already open and could not be dismissed before starting the next import item. reset_front_window=" & ctrlxResetFrontWindow',
        "      end if",
        "      delay 0.2",
        "    end if",
        "    set ctrlxParentMenuItem to missing value",
        "    if ctrlxImportTriggered is false then",
        "      repeat with ctrlxParentCandidate in ctrlxImportParentMenuCandidates",
        "        try",
        '          set ctrlxParentMenuItem to menu item (contents of ctrlxParentCandidate) of menu 1 of menu bar item "File" of menu bar 1',
        '          set ctrlxMatchedParentCandidate to contents of ctrlxParentCandidate',
        "          exit repeat",
        "        end try",
        "      end repeat",
        "    end if",
        "    if ctrlxImportTriggered is false and ctrlxParentMenuItem is not missing value then",
        "      repeat with ctrlxCandidate in ctrlxImportMenuCandidates",
        "        try",
        "          set ctrlxImportMenuItem to menu item (contents of ctrlxCandidate) of menu 1 of ctrlxParentMenuItem",
        "          set ctrlxTriggerStartedAt to current date",
        "          click ctrlxImportMenuItem",
        "          set ctrlxImportTriggered to true",
        '          set ctrlxTriggerSource to "file_menu"',
        '          set ctrlxMatchedMenuCandidate to contents of ctrlxCandidate',
        "          set ctrlxTriggerDurationMs to ((current date) - ctrlxTriggerStartedAt) * 1000",
        "          exit repeat",
        "        end try",
        "      end repeat",
        "    end if",
        "    if ctrlxImportTriggered is false then",
        "      set ctrlxTriggerStartedAt to current date",
        '      keystroke "I" using {command down, shift down}',
        '      set ctrlxShortcutTriggered to "true"',
        '      set ctrlxTriggerSource to "keyboard_shortcut_shift_cmd_i"',
        "      set ctrlxTriggerDurationMs to ((current date) - ctrlxTriggerStartedAt) * 1000",
        '      set ctrlxDialogDeadline to (current date) + 3',
        "      repeat while (current date) is less than ctrlxDialogDeadline",
        "        delay 0.1",
        '        set ctrlxOpenDialogWindow to missing value',
        "        try",
        "          repeat with ctrlxWindow in windows",
        "            try",
        '              if name of ctrlxWindow as text is "Open File" then',
        "                set ctrlxOpenDialogWindow to ctrlxWindow",
        "                exit repeat",
        "              end if",
        "            end try",
        "          end repeat",
        "        end try",
        "        if ctrlxOpenDialogWindow is not missing value then",
        '          set ctrlxDialogWindowName to "Open File"',
        '          set ctrlxImportDialogOpened to "true"',
        '          set ctrlxImportTriggered to true',
        "          try",
        '            perform action "AXRaise" of ctrlxOpenDialogWindow',
        "          end try",
        "          exit repeat",
        "        end if",
        "      end repeat",
        "      if ctrlxImportTriggered is false then",
        "        try",
        "          if (count of windows) is greater than 0 then",
        '            set ctrlxDialogWindowName to name of front window as text',
        "            if ctrlxDialogWindowName is not ctrlxFrontWindowName then",
        '              set ctrlxImportDialogOpened to "different_front_window"',
        "            else",
        '              set ctrlxImportDialogOpened to "same_front_window"',
        "            end if",
        "          else",
        '            set ctrlxImportDialogOpened to "false"',
        "          end if",
        "        on error",
        '          set ctrlxImportDialogOpened to "unknown"',
        "        end try",
        "      end if",
        "    end if",
        "    if ctrlxImportTriggered is false then",
        "      try",
        "        repeat with ctrlxWindow in windows",
        "          repeat with ctrlxButton in every button of entire contents of ctrlxWindow",
        "            set ctrlxMatchedImportButton to false",
        "            try",
        '              set ctrlxButtonName to my ctrlxLowerText(name of ctrlxButton as text)',
        '              if ctrlxButtonName contains "import audio" then',
        "                set ctrlxMatchedImportButton to true",
        '                set ctrlxMatchedButtonDescriptor to "name:" & (name of ctrlxButton as text) & "@window:" & (name of ctrlxWindow as text)',
        "              end if",
        "            end try",
        "            if ctrlxMatchedImportButton is false then",
        "              try",
        '                set ctrlxButtonDescriptionRaw to description of ctrlxButton as text',
        '                set ctrlxButtonDescription to my ctrlxLowerText(ctrlxButtonDescriptionRaw)',
        '                if ctrlxButtonDescription contains "import audio" then',
        "                  set ctrlxMatchedImportButton to true",
        '                  set ctrlxMatchedButtonDescriptor to "description:" & ctrlxButtonDescriptionRaw & "@window:" & (name of ctrlxWindow as text)',
        "                end if",
        "              end try",
        "            end if",
        "            if ctrlxMatchedImportButton then",
        "              set ctrlxTriggerStartedAt to current date",
        "              click ctrlxButton",
        "              set ctrlxImportTriggered to true",
        '              set ctrlxTriggerSource to "window_button"',
        "              set ctrlxTriggerDurationMs to ((current date) - ctrlxTriggerStartedAt) * 1000",
        "              exit repeat",
        "            end if",
        "          end repeat",
        "          if ctrlxImportTriggered then",
        "            exit repeat",
        "          end if",
        "        end repeat",
        "      end try",
        "    end if",
        "    if ctrlxImportTriggered is false then",
        '      error "Could not find a Logic import audio trigger in the current project. front_window=" & ctrlxFrontWindowName & "; parent_candidate=" & ctrlxMatchedParentCandidate & "; menu_candidate=" & ctrlxMatchedMenuCandidate & "; button_match=" & ctrlxMatchedButtonDescriptor',
        "    end if",
        '    if ctrlxImportDialogOpened is not "true" then',
        '      set ctrlxDialogDeadline to (current date) + 3',
        "      repeat while (current date) is less than ctrlxDialogDeadline",
        "        delay 0.1",
        '        set ctrlxOpenDialogWindow to missing value',
        "        try",
        "          repeat with ctrlxWindow in windows",
        "            try",
        '              if name of ctrlxWindow as text is "Open File" then',
        "                set ctrlxOpenDialogWindow to ctrlxWindow",
        "                exit repeat",
        "              end if",
        "            end try",
        "          end repeat",
        "        end try",
        "        if ctrlxOpenDialogWindow is not missing value then",
        '          set ctrlxDialogWindowName to "Open File"',
        '          set ctrlxImportDialogOpened to "true"',
        "          try",
        '            perform action "AXRaise" of ctrlxOpenDialogWindow',
        "          end try",
        "          exit repeat",
        "        end if",
        "      end repeat",
        "    end if",
        '    if ctrlxImportDialogOpened is not "true" then',
        '      error "The Logic import dialog did not open after trigger. trigger_source=" & ctrlxTriggerSource & "; front_window=" & ctrlxFrontWindowName',
        "    end if",
        '    keystroke "G" using {command down, shift down}',
        "    delay 0.6",
        '    keystroke "a" using {command down}',
        "    delay 0.1",
        "    keystroke ctrlxImportFolderPath",
        "    delay 0.3",
        "    key code 36",
        "    delay 1.2",
        "    try",
        "      if (count of windows) is greater than 0 then",
        '        set ctrlxPostGotoFolderFrontWindow to name of front window as text',
        "      end if",
        "    end try",
        '    set ctrlxPostGotoFolderOpenDialogPresent to "false"',
        '    set ctrlxOpenDialogWindow to missing value',
        "    try",
        "      repeat with ctrlxWindow in windows",
        "        try",
        '          if name of ctrlxWindow as text is "Open File" then',
        "            set ctrlxOpenDialogWindow to ctrlxWindow",
        '            set ctrlxPostGotoFolderOpenDialogPresent to "true"',
        "            exit repeat",
        "          end if",
        "        end try",
        "      end repeat",
        "    end try",
        '    if ctrlxPostGotoFolderOpenDialogPresent is not "true" then',
        '      error "The Logic Go to Folder step did not keep the Open File panel available. post_goto_folder_front=" & ctrlxPostGotoFolderFrontWindow',
        "    end if",
        "    try",
        '      perform action "AXRaise" of ctrlxOpenDialogWindow',
        "    end try",
        '    keystroke "a" using {command down}',
        "    delay 0.05",
        "    keystroke ctrlxImportFilename",
        "    delay 0.5",
        '    set ctrlxFileSelectionMethod to "goto_folder_then_type"',
        "    key code 36",
        "    delay 2.0",
        "    try",
        '      click button "Open" of ctrlxOpenDialogWindow',
        "    on error",
        "      try",
        "        key code 36",
        "      on error",
        '        error "The Logic import file dialog opened and located the file, but CTRLX could not confirm the Open action."',
        "      end try",
        "    end try",
        "    delay 0.5",
        "    try",
        "      repeat with ctrlxModalWindow in windows",
        "        try",
        '          if name of ctrlxModalWindow as text is not "Open File" then',
        "            try",
        '              click button "OK" of ctrlxModalWindow',
        "              exit repeat",
        "            end try",
        "            try",
        '              click button "Copy" of ctrlxModalWindow',
        "              exit repeat",
        "            end try",
        "          end if",
        "        end try",
        "      end repeat",
        "    end try",
        '    set ctrlxPostImportDeadline to (current date) + 6',
        '    set ctrlxPostImportState to "pending"',
        '    set ctrlxPostImportFrontWindow to "missing"',
        '    set ctrlxPostImportOpenDialogPresent to "true"',
        "    set ctrlxPostImportConfirmRetries to 0",
        "    set ctrlxLastPostImportRetryAt to current date",
        "    repeat while (current date) is less than ctrlxPostImportDeadline",
        "      delay 0.1",
        "      try",
        "        if (count of windows) is greater than 0 then",
        '          set ctrlxPostImportFrontWindow to name of front window as text',
        "        else",
        '          set ctrlxPostImportFrontWindow to "missing"',
        "        end if",
        "      on error",
        '        set ctrlxPostImportFrontWindow to "unknown"',
        "      end try",
        '      set ctrlxPostImportOpenDialogPresent to "false"',
        '      set ctrlxOpenDialogWindow to missing value',
        "      try",
        "        repeat with ctrlxWindow in windows",
        "          try",
        '            if name of ctrlxWindow as text is "Open File" then',
        "              set ctrlxOpenDialogWindow to ctrlxWindow",
        '              set ctrlxPostImportOpenDialogPresent to "true"',
        "              exit repeat",
        "            end if",
        "          end try",
        "        end repeat",
        "      end try",
        "      if ctrlxOpenDialogWindow is missing value then",
        '            set ctrlxPostImportState to "project_ready"',
        "            exit repeat",
        "      else if ctrlxPostImportConfirmRetries < 2 then",
        "        if ((current date) - ctrlxLastPostImportRetryAt) is greater than 1 then",
        "          try",
        '            perform action "AXRaise" of ctrlxOpenDialogWindow',
        "          end try",
        "          delay 0.2",
        "          try",
        "            key code 36",
        "          end try",
        "          set ctrlxPostImportConfirmRetries to ctrlxPostImportConfirmRetries + 1",
        "          set ctrlxLastPostImportRetryAt to current date",
        "        end if",
        "      end if",
        "    end repeat",
        '    if ctrlxPostImportState is not "project_ready" then',
        '      error "Logic import did not close the Open File dialog after confirming Open. post_import_front_window=" & ctrlxPostImportFrontWindow & "; post_import_open_dialog_present=" & ctrlxPostImportOpenDialogPresent & "; post_goto_folder_front=" & ctrlxPostGotoFolderFrontWindow & "; post_goto_folder_open_dialog_present=" & ctrlxPostGotoFolderOpenDialogPresent & "; file_selection_method=" & ctrlxFileSelectionMethod & "; trigger_source=" & ctrlxTriggerSource & "; dialog_opened=" & ctrlxImportDialogOpened & "; existing_dialog_reset=" & ctrlxExistingDialogReset & "; post_import_confirm_retries=" & (ctrlxPostImportConfirmRetries as text)',
        "    end if",
        "    delay 0.35",
        '    return "ctrlx_audio_imported_into_current_project|trigger_source=" & ctrlxTriggerSource & "|shortcut_triggered=" & ctrlxShortcutTriggered & "|parent_candidate=" & ctrlxMatchedParentCandidate & "|menu_candidate=" & ctrlxMatchedMenuCandidate & "|button_match=" & ctrlxMatchedButtonDescriptor & "|front_window=" & ctrlxFrontWindowName & "|frontmost=" & ctrlxLogicFrontmostStatus & "|front_window_available=" & (ctrlxFrontWindowAvailable as text) & "|file_menu_available=" & ctrlxFileMenuAvailable & "|dialog_opened=" & ctrlxImportDialogOpened & "|dialog_window=" & ctrlxDialogWindowName & "|trigger_duration_ms=" & (round ctrlxTriggerDurationMs as text) & "|file_path=" & ctrlxImportPath & "|folder_path=" & ctrlxImportFolderPath & "|file_selection_method=" & ctrlxFileSelectionMethod & "|post_goto_folder_front=" & ctrlxPostGotoFolderFrontWindow & "|post_goto_folder_open_dialog_present=" & ctrlxPostGotoFolderOpenDialogPresent & "|post_import_front_window=" & ctrlxPostImportFrontWindow & "|post_import_open_dialog_present=" & ctrlxPostImportOpenDialogPresent & "|existing_dialog_reset=" & ctrlxExistingDialogReset & "|post_import_confirm_retries=" & (ctrlxPostImportConfirmRetries as text) & "|used_existing_dialog=" & ctrlxUsingExistingOpenDialog',
        "  end tell",
        "end tell",
        "delay 0.75"
      ],
      { timeoutMs: 25_000 }
    );
    const importFinishedAt = Date.now();
    const diagnostics = parseImportDiagnosticStdout(result.stdout);
    const timingMs = importFinishedAt - importStartedAt;
    const triggerTimingMs =
      typeof diagnostics.trigger_duration_ms === "string" && Number.isFinite(Number(diagnostics.trigger_duration_ms))
        ? Number(diagnostics.trigger_duration_ms)
        : undefined;

    debugImportAutomationHost("audio_import_succeeded", {
      filename: importedFilename,
      filePath,
      strategy,
      timingMs,
      triggerTimingMs: triggerTimingMs ?? null,
      logicFrontmost: diagnostics.frontmost ?? null,
      frontWindow: diagnostics.front_window ?? null,
      frontWindowAvailable: diagnostics.front_window_available ?? null,
      triggerSource: diagnostics.trigger_source ?? null,
      parentCandidate: diagnostics.parent_candidate ?? null,
      menuCandidate: diagnostics.menu_candidate ?? null,
      buttonMatch: diagnostics.button_match ?? null,
      dialogOpened: diagnostics.dialog_opened ?? null,
      dialogWindow: diagnostics.dialog_window ?? null,
      applescriptStdout: result.stdout || null,
      applescriptStderr: result.stderr || null
    });

    return {
      filePath,
      importedFilename,
      ok: true,
      message: `Imported ${importedFilename} into Logic.`,
      strategy,
      applescriptStdout: result.stdout || undefined,
      applescriptStderr: result.stderr || undefined,
      timingMs,
      triggerTimingMs,
      diagnostics
    };
  } catch (error) {
    const reason = getErrorMessage(error);
    const importFinishedAt = Date.now();
    const timingMs = importFinishedAt - importStartedAt;
    const diagnostics = parseImportDiagnosticStdout(reason);
    const cleanupDiagnostics = await cleanupLingeringLogicImportDialog(context, importedFilename);
    const failureCategory = classifyImportFailure(diagnostics, reason);
    debugImportAutomationHost("audio_import_failed", {
      filename: importedFilename,
      filePath,
      strategy,
      timingMs,
      failureCategory,
      logicFrontmost: diagnostics.frontmost ?? null,
      frontWindow: diagnostics.front_window ?? null,
      frontWindowAvailable: diagnostics.front_window_available ?? null,
      fileMenuAvailable: diagnostics.file_menu_available ?? null,
      parentCandidate: diagnostics.parent_candidate ?? null,
      menuCandidate: diagnostics.menu_candidate ?? null,
      buttonMatch: diagnostics.button_match ?? null,
      dialogOpened: diagnostics.dialog_opened ?? null,
      cleanupAttempted: cleanupDiagnostics.cleanup_attempted ?? null,
      cleanupResult: cleanupDiagnostics.cleanup_result ?? null,
      reason
    });

    return {
      filePath,
      importedFilename,
      ok: false,
      message: `Failed to import ${importedFilename} into Logic.`,
      reason,
      failureCategory,
      strategy,
      timingMs,
      diagnostics: {
        ...diagnostics,
        ...cleanupDiagnostics
      }
    };
  }
}

async function importAudioFilesFromIsolatedFolderIntoCurrentProject(
  context: Pick<CommandExecutionContext, "applescript" | "logger">,
  filePaths: string[]
): Promise<ImportAudioIntoCurrentProjectResult[]> {
  const folderPath = dirname(filePaths[0]);
  const strategy = "logic_open_dialog_select_all_in_isolated_folder";
  const importStartedAt = Date.now();
  const escapedFolderPath = escapeAppleScriptString(folderPath);

  context.logger(`Running Logic batch audio import for ${filePaths.length} files from ${folderPath}`);
  debugImportAutomationHost("audio_import_batch_folder_start", {
    strategy,
    folderPath,
    fileCount: filePaths.length,
    filePaths
  });

  try {
    const result = await context.applescript.run(
      [
        "on ctrlxLowerText(ctrlxValue)",
        '  return do shell script "/bin/echo " & quoted form of ctrlxValue & " | /usr/bin/tr \'[:upper:]\' \'[:lower:]\'"',
        "end ctrlxLowerText",
        `set ctrlxImportFolderPath to "${escapedFolderPath}"`,
        `set ctrlxImportParentMenuCandidates to {${LOGIC_IMPORT_PARENT_MENU_CANDIDATES.map((label) => `"${escapeAppleScriptString(label)}"`).join(", ")}}`,
        `set ctrlxImportMenuCandidates to {${LOGIC_IMPORT_AUDIO_MENU_CANDIDATES.map((label) => `"${escapeAppleScriptString(label)}"`).join(", ")}}`,
        'set ctrlxReadyTimeoutSeconds to 2.5',
        'tell application "Logic Pro" to activate',
        "delay 0.35",
        'tell application "System Events"',
        '  tell process "Logic Pro"',
        '    set ctrlxReadyDeadline to (current date) + ctrlxReadyTimeoutSeconds',
        '    set ctrlxFrontWindowName to "missing"',
        '    set ctrlxFileMenuAvailable to "false"',
        '    set ctrlxReadyState to "pending"',
        "    set ctrlxImportTriggered to false",
        '    set ctrlxTriggerSource to "none"',
        '    set ctrlxMatchedParentCandidate to "none"',
        '    set ctrlxMatchedMenuCandidate to "none"',
        '    set ctrlxShortcutTriggered to "false"',
        '    set ctrlxLogicFrontmostStatus to "false"',
        '    set ctrlxImportDialogOpened to "unknown"',
        '    set ctrlxDialogWindowName to "missing"',
        '    set ctrlxPostGotoFolderFrontWindow to "missing"',
        '    set ctrlxPostGotoFolderOpenDialogPresent to "false"',
        '    set ctrlxFileSelectionMethod to "none"',
        '    set ctrlxReadyFrontWindowName to "missing"',
        '    set ctrlxUsingExistingOpenDialog to "false"',
        '    set ctrlxExistingDialogReset to "not_needed"',
        "    set ctrlxTriggerDurationMs to -1",
        '    set ctrlxOpenDialogWindow to missing value',
        "    repeat while (current date) is less than ctrlxReadyDeadline",
        "      try",
        "        set frontmost to true",
        "      end try",
        "      delay 0.1",
        "      try",
        "        set ctrlxLogicFrontmostStatus to (frontmost as text)",
        "      end try",
        "      try",
        "        if (count of windows) is greater than 0 then",
        "          set ctrlxFrontWindowName to name of front window as text",
        "        end if",
        "      end try",
        "      try",
        '        set ctrlxFileMenuTitle to title of menu bar item "File" of menu bar 1',
        '        if ctrlxFileMenuTitle is not "" then set ctrlxFileMenuAvailable to "true"',
        "      end try",
        '      if ctrlxLogicFrontmostStatus is "true" then',
        '        set ctrlxReadyState to "ready"',
        '        set ctrlxReadyFrontWindowName to ctrlxFrontWindowName',
        "        exit repeat",
        "      end if",
        "    end repeat",
        '    if ctrlxReadyState is not "ready" then',
        '      error "Logic import preflight failed. frontmost=" & ctrlxLogicFrontmostStatus & "; front_window=" & ctrlxFrontWindowName & "; file_menu_available=" & ctrlxFileMenuAvailable',
        "    end if",
        "    delay 1.0",
        '    if ctrlxReadyFrontWindowName is "Open File" then',
        '      set ctrlxUsingExistingOpenDialog to "true"',
        '      set ctrlxExistingDialogReset to "attempted"',
        "      key code 53",
        "      delay 0.45",
        '      set ctrlxResetDeadline to (current date) + 3',
        '      set ctrlxResetFrontWindow to "missing"',
        '      set ctrlxExistingDialogReset to "pending"',
        "      repeat while (current date) is less than ctrlxResetDeadline",
        "        delay 0.1",
        "        try",
        "          if (count of windows) is greater than 0 then",
        '            set ctrlxResetFrontWindow to name of front window as text',
        '            if ctrlxResetFrontWindow is not "Open File" then',
        '              set ctrlxExistingDialogReset to "closed"',
        "              exit repeat",
        "            end if",
        "          else",
        '            set ctrlxResetFrontWindow to "missing"',
        '            set ctrlxExistingDialogReset to "closed"',
        "            exit repeat",
        "          end if",
        "        on error",
        '          set ctrlxResetFrontWindow to "unknown"',
        "        end try",
        "      end repeat",
        '      if ctrlxExistingDialogReset is not "closed" then',
        '        error "A stale Open File panel was already open and could not be dismissed before starting the next import item. reset_front_window=" & ctrlxResetFrontWindow',
        "      end if",
        "      delay 0.2",
        "    end if",
        "    set ctrlxParentMenuItem to missing value",
        "    repeat with ctrlxParentCandidate in ctrlxImportParentMenuCandidates",
        "      try",
        '        set ctrlxParentMenuItem to menu item (contents of ctrlxParentCandidate) of menu 1 of menu bar item "File" of menu bar 1',
        '        set ctrlxMatchedParentCandidate to contents of ctrlxParentCandidate',
        "        exit repeat",
        "      end try",
        "    end repeat",
        "    if ctrlxParentMenuItem is not missing value then",
        "      repeat with ctrlxCandidate in ctrlxImportMenuCandidates",
        "        try",
        "          set ctrlxImportMenuItem to menu item (contents of ctrlxCandidate) of menu 1 of ctrlxParentMenuItem",
        "          set ctrlxTriggerStartedAt to current date",
        "          click ctrlxImportMenuItem",
        "          set ctrlxImportTriggered to true",
        '          set ctrlxTriggerSource to "file_menu"',
        '          set ctrlxMatchedMenuCandidate to contents of ctrlxCandidate',
        "          set ctrlxTriggerDurationMs to ((current date) - ctrlxTriggerStartedAt) * 1000",
        "          exit repeat",
        "        end try",
        "      end repeat",
        "    end if",
        "    if ctrlxImportTriggered is false then",
        "      set ctrlxTriggerStartedAt to current date",
        '      keystroke "I" using {command down, shift down}',
        '      set ctrlxShortcutTriggered to "true"',
        '      set ctrlxTriggerSource to "keyboard_shortcut_shift_cmd_i"',
        "      set ctrlxTriggerDurationMs to ((current date) - ctrlxTriggerStartedAt) * 1000",
        "    end if",
        '    set ctrlxDialogDeadline to (current date) + 3',
        "    repeat while (current date) is less than ctrlxDialogDeadline",
        "      delay 0.1",
        '      set ctrlxOpenDialogWindow to missing value',
        "      try",
        "        repeat with ctrlxWindow in windows",
        "          try",
        '            if name of ctrlxWindow as text is "Open File" then',
        "              set ctrlxOpenDialogWindow to ctrlxWindow",
        "              exit repeat",
        "            end if",
        "          end try",
        "        end repeat",
        "      end try",
        "      if ctrlxOpenDialogWindow is not missing value then",
        '        set ctrlxDialogWindowName to "Open File"',
        '        set ctrlxImportDialogOpened to "true"',
        '        set ctrlxImportTriggered to true',
        "        exit repeat",
        "      end if",
        "    end repeat",
        '    if ctrlxImportDialogOpened is not "true" then',
        '      error "The Logic import dialog did not open. trigger_source=" & ctrlxTriggerSource',
        "    end if",
        '    keystroke "G" using {command down, shift down}',
        "    delay 0.6",
        '    keystroke "a" using {command down}',
        "    delay 0.1",
        "    keystroke ctrlxImportFolderPath",
        "    delay 0.3",
        "    key code 36",
        "    delay 1.2",
        '    set ctrlxPostGotoFolderOpenDialogPresent to "false"',
        '    set ctrlxOpenDialogWindow to missing value',
        "    try",
        "      repeat with ctrlxWindow in windows",
        "        try",
        '          if name of ctrlxWindow as text is "Open File" then',
        "            set ctrlxOpenDialogWindow to ctrlxWindow",
        '            set ctrlxPostGotoFolderOpenDialogPresent to "true"',
        "            exit repeat",
        "          end if",
        "        end try",
        "      end repeat",
        "    end try",
        '    if ctrlxPostGotoFolderOpenDialogPresent is not "true" then',
        '      error "The Logic Go to Folder step did not keep the Open File panel available."',
        "    end if",
        '    keystroke "a" using {command down}',
        "    delay 0.3",
        '    set ctrlxFileSelectionMethod to "cmd_a_select_all"',
        "    key code 36",
        "    delay 0.8",
        "    try",
        "      repeat with ctrlxModalWindow in windows",
        "        try",
        '          if name of ctrlxModalWindow as text is not "Open File" then',
        "            try",
        '              click button "OK" of ctrlxModalWindow',
        "              exit repeat",
        "            end try",
        "            try",
        '              click button "Copy" of ctrlxModalWindow',
        "              exit repeat",
        "            end try",
        "            try",
        "              set frontmost to true",
        "              key code 36",
        "              exit repeat",
        "            end try",
        "          end if",
        "        end try",
        "      end repeat",
        "    end try",
        '    set ctrlxPostImportDeadline to (current date) + 8',
        '    set ctrlxPostImportState to "pending"',
        '    set ctrlxPostImportFrontWindow to "missing"',
        '    set ctrlxPostImportOpenDialogPresent to "true"',
        "    repeat while (current date) is less than ctrlxPostImportDeadline",
        "      delay 0.1",
        "      try",
        "        if (count of windows) is greater than 0 then",
        '          set ctrlxPostImportFrontWindow to name of front window as text',
        "        else",
        '          set ctrlxPostImportFrontWindow to "missing"',
        "        end if",
        "      on error",
        '        set ctrlxPostImportFrontWindow to "unknown"',
        "      end try",
        '      set ctrlxPostImportOpenDialogPresent to "false"',
        "      try",
        "        repeat with ctrlxWindow in windows",
        "          try",
        '            if name of ctrlxWindow as text is "Open File" then',
        '              set ctrlxPostImportOpenDialogPresent to "true"',
        "              exit repeat",
        "            end if",
        "          end try",
        "        end repeat",
        "      end try",
        '      if ctrlxPostImportOpenDialogPresent is "false" then',
        '        set ctrlxPostImportState to "project_ready"',
        "        exit repeat",
        "      end if",
        "    end repeat",
        '    if ctrlxPostImportState is not "project_ready" then',
        '      error "Logic import did not close the Open File dialog after selecting all files. post_import_front_window=" & ctrlxPostImportFrontWindow',
        "    end if",
        '    return "ctrlx_audio_imported_into_current_project|trigger_source=" & ctrlxTriggerSource & "|shortcut_triggered=" & ctrlxShortcutTriggered & "|parent_candidate=" & ctrlxMatchedParentCandidate & "|menu_candidate=" & ctrlxMatchedMenuCandidate & "|front_window=" & ctrlxFrontWindowName & "|frontmost=" & ctrlxLogicFrontmostStatus & "|file_menu_available=" & ctrlxFileMenuAvailable & "|dialog_opened=" & ctrlxImportDialogOpened & "|dialog_window=" & ctrlxDialogWindowName & "|trigger_duration_ms=" & (round ctrlxTriggerDurationMs as text) & "|folder_path=" & ctrlxImportFolderPath & "|file_selection_method=" & ctrlxFileSelectionMethod & "|post_import_front_window=" & ctrlxPostImportFrontWindow & "|post_import_open_dialog_present=" & ctrlxPostImportOpenDialogPresent & "|existing_dialog_reset=" & ctrlxExistingDialogReset & "|used_existing_dialog=" & ctrlxUsingExistingOpenDialog',
        "  end tell",
        "end tell",
        "delay 0.75"
      ],
      { timeoutMs: 30_000 }
    );

    const diagnostics = parseImportDiagnosticStdout(result.stdout);
    const timingMs = Date.now() - importStartedAt;
    return filePaths.map((filePath) => ({
      filePath,
      importedFilename: basename(filePath),
      ok: true,
      message: `Imported ${basename(filePath)} into Logic.`,
      strategy,
      applescriptStdout: result.stdout || undefined,
      applescriptStderr: result.stderr || undefined,
      timingMs,
      triggerTimingMs:
        typeof diagnostics.trigger_duration_ms === "string" && Number.isFinite(Number(diagnostics.trigger_duration_ms))
          ? Number(diagnostics.trigger_duration_ms)
          : undefined,
      diagnostics
    }));
  } catch (error) {
    const reason = getErrorMessage(error);
    const cleanupDiagnostics = await cleanupLingeringLogicImportDialog(context, basename(filePaths[0]));
    const diagnostics = parseImportDiagnosticStdout(reason);
    const failureCategory = classifyImportFailure(diagnostics, reason);
    return filePaths.map((filePath) => ({
      filePath,
      importedFilename: basename(filePath),
      ok: false,
      message: `Failed to import ${basename(filePath)} into Logic.`,
      reason,
      failureCategory,
      strategy,
      timingMs: Date.now() - importStartedAt,
      diagnostics: {
        ...diagnostics,
        ...cleanupDiagnostics
      }
    }));
  }
}

export async function importAudioFilesIntoCurrentProject(
  context: CommandExecutionContext,
  input?: CommandExecutionInput
): Promise<CommandResultPayload> {
  const parsedInput = parseImportAudioFilesIntoCurrentProjectInput(input);
  context.logger(`Running Logic action ${CtrlxCommand.ImportAudioFilesIntoCurrentProject}`);
  debugImportAutomationHost("audio_import_batch_start", {
    strategy: "logic_current_project_import_audio",
    fileCount: parsedInput.filePaths.length,
    filePaths: parsedInput.filePaths
  });

  const results: ImportAudioIntoCurrentProjectResult[] = [];
  const uniqueFolders = [...new Set(parsedInput.filePaths.map((filePath) => dirname(filePath)))];

  if (parsedInput.filePaths.length > 1 && uniqueFolders.length === 1) {
    results.push(...(await importAudioFilesFromIsolatedFolderIntoCurrentProject(context, parsedInput.filePaths)));
  } else {
    for (const filePath of parsedInput.filePaths) {
      const result = await importSingleAudioFileIntoCurrentProject(context, filePath);

      if (result.ok) {
        try {
          const resolvedTrack = await captureCurrentlySelectedLogicTrack(
            CtrlxCommand.ImportAudioFilesIntoCurrentProject,
            {
              applescript: context.applescript,
              logger: context.logger
            }
          );

          result.postImportTrack = {
            resolved: true,
            target:
              resolvedTrack.resolvedTrackIndex !== null
                ? {
                    kind: "index",
                    trackIndex: resolvedTrack.resolvedTrackIndex,
                    expectedCurrentName: resolvedTrack.resolvedTrackName ?? null
                  }
                : {
                    kind: "selected",
                    expectedCurrentName: resolvedTrack.resolvedTrackName ?? null
                  },
            resolvedTrackIndex: resolvedTrack.resolvedTrackIndex,
            resolvedTrackName: resolvedTrack.resolvedTrackName,
            strategy: resolvedTrack.strategy,
            descriptor: resolvedTrack.descriptor,
            selectionChanged: resolvedTrack.selectionChanged
          };
        } catch (error) {
          const reason = getErrorMessage(error);
          result.postImportTrack = {
            resolved: false,
            target: null,
            resolvedTrackIndex: null,
            resolvedTrackName: null,
            strategy: null,
            descriptor: null,
            selectionChanged: null,
            reason
          };
        }
      }

      results.push(result);
    }
  }

  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.length - succeeded;
  debugImportAutomationHost("audio_import_batch_end", {
    strategy: "logic_current_project_import_audio",
    total: results.length,
    succeeded,
    failed,
    results: results.map((result) => ({
      filePath: result.filePath,
      importedFilename: result.importedFilename,
      ok: result.ok,
      timingMs: result.timingMs ?? null,
      triggerTimingMs: result.triggerTimingMs ?? null,
      reason: result.reason ?? null,
      failureCategory: result.failureCategory ?? null,
      triggerSource:
        result.diagnostics && typeof result.diagnostics.trigger_source === "string"
          ? result.diagnostics.trigger_source
          : null,
      dialogOpened:
        result.diagnostics && typeof result.diagnostics.dialog_opened === "string"
          ? result.diagnostics.dialog_opened
          : null,
      mappedTrackIndex: result.postImportTrack?.resolvedTrackIndex ?? null,
      mappedTrackName: result.postImportTrack?.resolvedTrackName ?? null,
      mappedTrackResolved: result.postImportTrack?.resolved ?? null
    }))
  });

  return {
    command: CtrlxCommand.ImportAudioFilesIntoCurrentProject,
    ok: true,
    message:
      failed === 0
        ? `Imported ${succeeded} audio file${succeeded === 1 ? "" : "s"} into the current Logic project.`
        : `Processed ${results.length} audio file${results.length === 1 ? "" : "s"} for Logic import: ${succeeded} succeeded, ${failed} failed.`,
    data: {
      strategy: "logic_current_project_import_audio",
      succeeded,
      failed,
      total: results.length,
      results
    }
  };
}
