import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SAMPLE_SEPARATOR = "<<<CTRLX_KV_SEP>>>";
const LIST_SEPARATOR = "<<<CTRLX_LIST_SEP>>>";
const DEFAULT_INTERVAL_MS = 250;
const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_OUTPUT_PATH = resolve(
  process.cwd(),
  "data/dev-logs",
  `logic-observer-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`
);

function parseArgs(argv) {
  const options = {
    intervalMs: DEFAULT_INTERVAL_MS,
    durationMs: null,
    outputPath: DEFAULT_OUTPUT_PATH,
    heartbeatMs: DEFAULT_HEARTBEAT_MS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--interval-ms" && next) {
      options.intervalMs = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--duration-ms" && next) {
      options.durationMs = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--heartbeat-ms" && next) {
      options.heartbeatMs = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--out" && next) {
      options.outputPath = resolve(process.cwd(), next);
      index += 1;
      continue;
    }
  }

  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0) {
    throw new Error(`Invalid --interval-ms value: ${options.intervalMs}`);
  }

  if (options.durationMs !== null && (!Number.isFinite(options.durationMs) || options.durationMs <= 0)) {
    throw new Error(`Invalid --duration-ms value: ${options.durationMs}`);
  }

  if (!Number.isFinite(options.heartbeatMs) || options.heartbeatMs <= 0) {
    throw new Error(`Invalid --heartbeat-ms value: ${options.heartbeatMs}`);
  }

  return options;
}

function sleep(ms) {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function escapeAppleScriptString(value) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

async function runAppleScript(lines) {
  const args = lines.flatMap((line) => ["-e", line]);
  const result = await execFileAsync("/usr/bin/osascript", args);
  return result.stdout.trim();
}

function parseKeyValueOutput(raw) {
  const result = {};
  if (!raw) {
    return result;
  }

  for (const pair of raw.split(SAMPLE_SEPARATOR)) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = pair.slice(0, separatorIndex);
    const value = pair.slice(separatorIndex + 1);
    result[key] = value;
  }

  return result;
}

function parseBoolean(value) {
  return value === "true";
}

function parseList(value) {
  if (!value || value === "none") {
    return [];
  }

  return value
    .split(LIST_SEPARATOR)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && entry !== "missing value");
}

function includesWindowLike(values, matchers) {
  const lowered = values.map((value) => value.toLowerCase());
  return matchers.some((matcher) => lowered.some((value) => value.includes(matcher)));
}

async function sampleLogicUiState() {
  const raw = await runAppleScript([
    `set ctrlxPairSeparator to "${escapeAppleScriptString(SAMPLE_SEPARATOR)}"`,
    `set ctrlxListSeparator to "${escapeAppleScriptString(LIST_SEPARATOR)}"`,
    'tell application "System Events"',
    '  set ctrlxFrontAppName to "missing"',
    '  try',
    '    set ctrlxFrontAppName to name of first application process whose frontmost is true',
    '  end try',
    '  set ctrlxLogicRunning to exists application process "Logic Pro"',
    '  set ctrlxLogicFrontmost to false',
    '  set ctrlxLogicWindowCount to 0',
    '  set ctrlxLogicFrontWindowName to "missing"',
    '  set ctrlxLogicWindowNames to {}',
    '  set ctrlxLogicSheetNames to {}',
    '  set ctrlxLogicFileMenuAvailable to false',
    '  set ctrlxForteRunning to exists application process "Forte!"',
    '  set ctrlxForteFrontmost to false',
    '  set ctrlxForteWindowNames to {}',
    '  set ctrlxSampleError to "none"',
    '  if ctrlxLogicRunning then',
    '    try',
    '      tell process "Logic Pro"',
    '        set ctrlxLogicFrontmost to frontmost',
    '        try',
    '          set ctrlxLogicWindowCount to count of windows',
    '        end try',
    '        repeat with ctrlxWindow in windows',
    '          try',
    '            set end of ctrlxLogicWindowNames to (name of ctrlxWindow as text)',
    '          on error',
    '            set end of ctrlxLogicWindowNames to "<unnamed-window>"',
    '          end try',
    '          try',
    '            repeat with ctrlxSheet in sheets of ctrlxWindow',
    '              try',
    '                set end of ctrlxLogicSheetNames to (name of ctrlxSheet as text)',
    '              on error',
    '                set end of ctrlxLogicSheetNames to "<unnamed-sheet>"',
    '              end try',
    '            end repeat',
    '          end try',
    '        end repeat',
    '        if ctrlxLogicWindowCount > 0 then',
    '          try',
    '            set ctrlxLogicFrontWindowName to name of front window as text',
    '          end try',
    '        end if',
    '        try',
    '          set ctrlxFileMenuTitle to title of menu bar item "File" of menu bar 1',
    '          if ctrlxFileMenuTitle is not "" then set ctrlxLogicFileMenuAvailable to true',
    '        end try',
    '      end tell',
    '    on error errMsg',
    '      set ctrlxSampleError to errMsg',
    '    end try',
    '  end if',
    '  if ctrlxForteRunning then',
    '    try',
    '      tell process "Forte!"',
    '        set ctrlxForteFrontmost to frontmost',
    '        repeat with ctrlxWindow in windows',
    '          try',
    '            set end of ctrlxForteWindowNames to (name of ctrlxWindow as text)',
    '          on error',
    '            set end of ctrlxForteWindowNames to "<unnamed-window>"',
    '          end try',
    '        end repeat',
    '      end tell',
    '    end try',
    '  end if',
    '  set AppleScript\'s text item delimiters to ctrlxListSeparator',
    '  set ctrlxWindowNamesText to "none"',
    '  if (count of ctrlxLogicWindowNames) is greater than 0 then',
    '    set ctrlxWindowNamesText to ctrlxLogicWindowNames as text',
    '  end if',
    '  set ctrlxSheetNamesText to "none"',
    '  if (count of ctrlxLogicSheetNames) is greater than 0 then',
    '    set ctrlxSheetNamesText to ctrlxLogicSheetNames as text',
    '  end if',
    '  set ctrlxForteWindowNamesText to "none"',
    '  if (count of ctrlxForteWindowNames) is greater than 0 then',
    '    set ctrlxForteWindowNamesText to ctrlxForteWindowNames as text',
    '  end if',
    '  set AppleScript\'s text item delimiters to ctrlxPairSeparator',
    '  return "front_app=" & ctrlxFrontAppName & ctrlxPairSeparator & "logic_running=" & (ctrlxLogicRunning as text) & ctrlxPairSeparator & "logic_frontmost=" & (ctrlxLogicFrontmost as text) & ctrlxPairSeparator & "logic_window_count=" & (ctrlxLogicWindowCount as text) & ctrlxPairSeparator & "logic_front_window=" & ctrlxLogicFrontWindowName & ctrlxPairSeparator & "logic_window_names=" & ctrlxWindowNamesText & ctrlxPairSeparator & "logic_sheet_names=" & ctrlxSheetNamesText & ctrlxPairSeparator & "logic_file_menu_available=" & (ctrlxLogicFileMenuAvailable as text) & ctrlxPairSeparator & "forte_running=" & (ctrlxForteRunning as text) & ctrlxPairSeparator & "forte_frontmost=" & (ctrlxForteFrontmost as text) & ctrlxPairSeparator & "forte_window_names=" & ctrlxForteWindowNamesText & ctrlxPairSeparator & "sample_error=" & ctrlxSampleError',
    'end tell'
  ]);

  const parsed = parseKeyValueOutput(raw);
  const windowNames = parseList(parsed.logic_window_names);
  const sheetNames = parseList(parsed.logic_sheet_names);
  const allVisibleNames = [...windowNames, ...sheetNames];

  let finderFrontWindow = "missing";
  let finderTargetPath = "missing";
  let finderSelectionNames = [];

  try {
    const finderRaw = await runAppleScript([
      `set ctrlxPairSeparator to "${escapeAppleScriptString(SAMPLE_SEPARATOR)}"`,
      `set ctrlxListSeparator to "${escapeAppleScriptString(LIST_SEPARATOR)}"`,
      'tell application "Finder"',
      '  set ctrlxFinderFrontWindowName to "missing"',
      '  set ctrlxFinderTargetPath to "missing"',
      '  set ctrlxFinderSelectionNames to {}',
      '  try',
      '    if (count of Finder windows) is greater than 0 then',
      '      set ctrlxFinderFrontWindowName to name of front Finder window as text',
      '      try',
      '        set ctrlxFinderTargetPath to POSIX path of (target of front Finder window as alias)',
      '      end try',
      '    end if',
      '  end try',
      '  try',
      '    repeat with ctrlxItem in (get selection)',
      '      try',
      '        set end of ctrlxFinderSelectionNames to (name of ctrlxItem as text)',
      '      end try',
      '    end repeat',
      '  end try',
      '  set AppleScript\'s text item delimiters to ctrlxListSeparator',
      '  set ctrlxFinderSelectionText to "none"',
      '  if (count of ctrlxFinderSelectionNames) is greater than 0 then',
      '    set ctrlxFinderSelectionText to ctrlxFinderSelectionNames as text',
      '  end if',
      '  set AppleScript\'s text item delimiters to ctrlxPairSeparator',
      '  return "finder_front_window=" & ctrlxFinderFrontWindowName & ctrlxPairSeparator & "finder_target_path=" & ctrlxFinderTargetPath & ctrlxPairSeparator & "finder_selection_names=" & ctrlxFinderSelectionText',
      'end tell'
    ]);
    const finderParsed = parseKeyValueOutput(finderRaw);
    finderFrontWindow = finderParsed.finder_front_window ?? "missing";
    finderTargetPath = finderParsed.finder_target_path ?? "missing";
    finderSelectionNames = parseList(finderParsed.finder_selection_names);
  } catch {
    finderFrontWindow = "unavailable";
    finderTargetPath = "unavailable";
    finderSelectionNames = [];
  }

  return {
    frontApp: parsed.front_app ?? "missing",
    logicRunning: parseBoolean(parsed.logic_running),
    logicFrontmost: parseBoolean(parsed.logic_frontmost),
    logicWindowCount:
      parsed.logic_window_count && Number.isFinite(Number(parsed.logic_window_count))
        ? Number(parsed.logic_window_count)
        : 0,
    logicFrontWindow: parsed.logic_front_window ?? "missing",
    logicWindowNames: windowNames,
    logicSheetNames: sheetNames,
    logicFileMenuAvailable: parseBoolean(parsed.logic_file_menu_available),
    forteRunning: parseBoolean(parsed.forte_running),
    forteFrontmost: parseBoolean(parsed.forte_frontmost),
    forteWindowNames: parseList(parsed.forte_window_names),
    finderFrontWindow,
    finderTargetPath,
    finderSelectionNames,
    sampleError: parsed.sample_error ?? "none",
    dialogs: {
      openFile: includesWindowLike(allVisibleNames, ["open file"]),
      chooseProject: includesWindowLike(allVisibleNames, ["choose a project"]),
      createTrack: includesWindowLike(allVisibleNames, ["create new track", "new tracks"]),
      rename: includesWindowLike(allVisibleNames, ["rename"]),
      color: includesWindowLike(allVisibleNames, ["color"])
    }
  };
}

function buildComparableState(state) {
  return JSON.stringify({
    frontApp: state.frontApp,
    logicRunning: state.logicRunning,
    logicFrontmost: state.logicFrontmost,
    logicWindowCount: state.logicWindowCount,
    logicFrontWindow: state.logicFrontWindow,
    logicWindowNames: state.logicWindowNames,
    logicSheetNames: state.logicSheetNames,
    logicFileMenuAvailable: state.logicFileMenuAvailable,
    forteRunning: state.forteRunning,
    forteFrontmost: state.forteFrontmost,
    forteWindowNames: state.forteWindowNames,
    finderFrontWindow: state.finderFrontWindow,
    finderTargetPath: state.finderTargetPath,
    finderSelectionNames: state.finderSelectionNames,
    sampleError: state.sampleError,
    dialogs: state.dialogs
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await mkdir(dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, "");

  let active = true;
  let lastComparableState = null;
  let lastHeartbeatAt = 0;

  const writeEvent = async (event) => {
    await appendFile(options.outputPath, `${JSON.stringify(event)}\n`);
  };

  const stop = async (reason) => {
    if (!active) {
      return;
    }
    active = false;
    await writeEvent({
      type: "observer_stopped",
      at: new Date().toISOString(),
      reason
    });
    process.stdout.write(`Observer stopped. Log written to ${options.outputPath}\n`);
  };

  process.on("SIGINT", () => {
    void stop("sigint");
  });

  process.on("SIGTERM", () => {
    void stop("sigterm");
  });

  await writeEvent({
    type: "observer_started",
    at: new Date().toISOString(),
    intervalMs: options.intervalMs,
    durationMs: options.durationMs,
    heartbeatMs: options.heartbeatMs,
    outputPath: options.outputPath
  });

  process.stdout.write(`Observing Logic, Forte, and Finder UI. Writing log to ${options.outputPath}\n`);

  const startedAt = Date.now();

  while (active) {
    const sampledAt = new Date().toISOString();

    try {
      const state = await sampleLogicUiState();
      const comparableState = buildComparableState(state);
      const now = Date.now();
      const shouldHeartbeat = now - lastHeartbeatAt >= options.heartbeatMs;

      if (comparableState !== lastComparableState) {
        await writeEvent({
          type: "state_change",
          at: sampledAt,
          state
        });
        lastComparableState = comparableState;
        lastHeartbeatAt = now;
      } else if (shouldHeartbeat) {
        await writeEvent({
          type: "heartbeat",
          at: sampledAt,
          state
        });
        lastHeartbeatAt = now;
      }
    } catch (error) {
      await writeEvent({
        type: "sample_error",
        at: sampledAt,
        message: error instanceof Error ? error.message : String(error)
      });
    }

    if (options.durationMs !== null && Date.now() - startedAt >= options.durationMs) {
      await stop("duration_elapsed");
      break;
    }

    await sleep(options.intervalMs);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
