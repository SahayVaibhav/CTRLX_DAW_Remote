import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { analyzeImportedAudioFile } from "../apps/host/dist/packages/protocol/src/index.js";
import { AppleScriptRunner } from "../apps/host/dist/apps/host/src/main/automation/applescript.js";
import {
  createAudioTrack,
  renameTrack,
  setTrackColor
} from "../apps/host/dist/apps/host/src/main/logic/actions.js";
import { importAudioFilesIntoCurrentProject } from "../apps/host/dist/apps/host/src/main/logic/importAudioIntoCurrentProject.js";

const execFileAsync = promisify(execFile);

const ZIP_PATH = "/Users/kuhusingh/Downloads/Stems_East_92_Emajor.zip";
const VALID_AUDIO_EXTENSIONS = new Set([".wav", ".wave", ".aif", ".aiff", ".caf", ".mp3", ".m4a", ".flac"]);

const logger = (msg) => console.log("[HOST]", msg);
const context = { logger, applescript: new AppleScriptRunner() };

async function extractZip(zipPath) {
  const extractRoot = await mkdtemp(join(tmpdir(), "ctrlx-fullbatch-import-"));
  await execFileAsync("/usr/bin/unzip", ["-q", zipPath, "-d", extractRoot]);
  const rootEntries = await readdir(extractRoot, { withFileTypes: true });
  const firstDirectory = rootEntries.find((entry) => entry.isDirectory());
  return firstDirectory ? join(extractRoot, firstDirectory.name) : extractRoot;
}

async function wait(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function moveSelectedLogicTrackByOffset(offset) {
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

async function inspectAndResetColorPalette() {
  const result = await context.applescript.run(
    [
      "on ctrlxFindColorWindow(ctrlxWindows)",
      "  repeat with ctrlxWindow in ctrlxWindows",
      '    set ctrlxWindowName to ""',
      '    set ctrlxWindowSubrole to ""',
      "    try",
      "      set ctrlxWindowName to name of ctrlxWindow",
      "    end try",
      "    try",
      "      set ctrlxWindowSubrole to subrole of ctrlxWindow",
      "    end try",
      '    if ctrlxWindowName contains "Color" or ctrlxWindowSubrole is "AXFloatingWindow" or ctrlxWindowSubrole is "AXSystemDialog" then',
      "      return ctrlxWindow",
      "    end if",
      "  end repeat",
      "  return missing value",
      "end ctrlxFindColorWindow",
      'tell application "Logic Pro" to activate',
      "delay 0.1",
      'tell application "System Events"',
      '  tell process "Logic Pro"',
      "    set frontmost to true",
      '    set ctrlxResetResult to "not_open"',
      "    set ctrlxPaletteWindow to my ctrlxFindColorWindow(every window)",
      '    set ctrlxPaletteWasOpen to "false"',
      "    if ctrlxPaletteWindow is not missing value then",
      '      set ctrlxPaletteWasOpen to "true"',
      "      key code 53",
      "      delay 0.25",
      "      set ctrlxPaletteWindow to my ctrlxFindColorWindow(every window)",
      "      if ctrlxPaletteWindow is missing value then",
      '        set ctrlxResetResult to "closed_with_escape"',
      "      else",
      '        set ctrlxResetResult to "still_open"',
      "      end if",
      "    end if",
      '    return ctrlxPaletteWasOpen & "|" & ctrlxResetResult',
      "  end tell",
      "end tell"
    ],
    { timeoutMs: 6_000 }
  );

  const [wasOpen = "false", resetResult = "unknown"] = String(result.stdout || "").trim().split("|");
  return {
    wasOpen: wasOpen === "true",
    resetResult
  };
}

function isValidAudioFilename(filename) {
  if (filename.startsWith("._")) {
    return false;
  }

  return VALID_AUDIO_EXTENSIONS.has(extname(filename).toLowerCase());
}

function isImportSuccess(result) {
  if (!result || result.ok !== true) {
    return false;
  }

  const firstItemResult = Array.isArray(result.data?.results) ? result.data.results[0] : null;
  return Boolean(firstItemResult && firstItemResult.ok === true);
}

function buildSkippedResult(stage, reason) {
  return {
    ok: false,
    skipped: true,
    stage,
    reason
  };
}

const extractedFolder = await extractZip(ZIP_PATH);
const discoveredEntries = await readdir(extractedFolder, { withFileTypes: true });
const items = discoveredEntries
  .filter((entry) => entry.isFile())
  .map((entry) => entry.name)
  .filter(isValidAudioFilename)
  .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }))
  .map((filename) => {
    const analyzed = analyzeImportedAudioFile(filename);
    return {
      filename,
      filePath: join(extractedFolder, filename),
      newName: analyzed.cleanTrackName,
      color: analyzed.assignedColor
    };
  });

console.log(
  "TEST_CONTEXT=" +
    JSON.stringify({
      zipPath: ZIP_PATH,
      extractedFolder,
      itemCount: items.length,
      filenames: items.map((item) => item.filename),
      mode: "strict_sequential_full_batch"
    })
);

if (items.length === 0) {
  console.log(
    "BATCH_SUMMARY=" +
      JSON.stringify({
        total: 0,
        succeeded: 0,
        failed: 0,
        firstFailureIndex: null,
        firstFailureStage: null
      })
  );
  process.exit(0);
}

let succeeded = 0;
let failed = 0;
let firstFailureIndex = null;
let firstFailureStage = null;
const batchStartedAt = Date.now();
const phaseTimings = {
  fileCountingMs: 0,
  importPassMs: 0,
  renamePassMs: 0,
  colorPassMs: 0,
  totalMs: 0
};
const itemStates = items.map((item) => ({
  ...item,
  createOk: false,
  importOk: false,
  renameOk: false,
  colorOk: false,
  failedStage: null,
  failureMessage: null,
  startedAt: null,
  finishedAt: null,
  createMode: "per_file"
}));

phaseTimings.fileCountingMs = Date.now() - batchStartedAt;
let trackCreateCalls = 0;
console.log("IMPORT_PHASE_START=" + JSON.stringify({ total: items.length, createMode: "per_file" }));

const importPassStartedAt = Date.now();

for (let i = 0; i < itemStates.length; i += 1) {
  const item = itemStates[i];
  item.startedAt = Date.now();

  console.log(
    "ITEM_START=" +
      JSON.stringify({
        index: i,
        filename: item.filename,
        filePath: item.filePath,
        newName: item.newName,
        color: item.color
      })
  );

  try {
    const createResult = await createAudioTrack(context, { count: 1 });
    trackCreateCalls += 1;
    console.log(`CREATE_RESULT_${i}=` + JSON.stringify(createResult));
    if (!createResult || createResult.ok !== true) {
      throw new Error("create_audio_failed");
    }
    item.createOk = true;
    item.createMode = "per_file";

    const importResult = await importAudioFilesIntoCurrentProject(context, {
      filePaths: [item.filePath]
    });
    console.log(`IMPORT_RESULT_${i}=` + JSON.stringify(importResult));
    if (!isImportSuccess(importResult)) {
      throw new Error("import_failed");
    }
    item.importOk = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!item.createOk) {
      console.log(`IMPORT_RESULT_${i}=` + JSON.stringify(buildSkippedResult("import", "create_failed")));
    }

    console.log(
      `ITEM_FAILURE_${i}=` +
        JSON.stringify({
          index: i,
          filename: item.filename,
          stage: item.createOk ? "import" : "create",
          error: message
        })
    );

    if (firstFailureIndex === null) {
      firstFailureIndex = i;
      firstFailureStage = item.createOk ? "import" : "create";
    }
    item.failedStage = item.createOk ? "import" : "create";
    item.failureMessage = message;
  }

  await wait(1_000);
}

phaseTimings.importPassMs = Date.now() - importPassStartedAt;

console.log("RENAME_PHASE_START=" + JSON.stringify({ total: items.length }));

const renamePassStartedAt = Date.now();
if (itemStates.length > 1) {
  await moveSelectedLogicTrackByOffset(-(itemStates.length - 1));
}

for (let i = 0; i < itemStates.length; i += 1) {
  const item = itemStates[i];
  if (i > 0) {
    await moveSelectedLogicTrackByOffset(1);
  }

  if (!item.importOk) {
    console.log(`RENAME_RESULT_${i}=` + JSON.stringify(buildSkippedResult("rename", "import_failed")));
    continue;
  }

  try {
    const renameResult = await renameTrack(context, {
      target: { kind: "selected", expectedCurrentName: null },
      newName: item.newName
    });
    console.log(`RENAME_RESULT_${i}=` + JSON.stringify(renameResult));
    if (!renameResult || renameResult.ok !== true) {
      throw new Error("rename_failed");
    }
    item.renameOk = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      `ITEM_FAILURE_${i}=` +
        JSON.stringify({
          index: i,
          filename: item.filename,
          stage: "rename",
          error: message
        })
    );
    if (firstFailureIndex === null) {
      firstFailureIndex = i;
      firstFailureStage = "rename";
    }
    item.failedStage = item.failedStage ?? "rename";
    item.failureMessage = item.failureMessage ?? message;
  }
}

phaseTimings.renamePassMs = Date.now() - renamePassStartedAt;

console.log("COLOR_PHASE_START=" + JSON.stringify({ total: items.length }));
const colorPassStartedAt = Date.now();
const paletteBeforeColorPhase = await inspectAndResetColorPalette();
console.log("palette_open_before_color_phase=" + JSON.stringify({ wasOpen: paletteBeforeColorPhase.wasOpen }));
console.log("palette_reset_result=" + JSON.stringify(paletteBeforeColorPhase));

if (itemStates.length > 1) {
  await moveSelectedLogicTrackByOffset(-(itemStates.length - 1));
}

for (let i = 0; i < itemStates.length; i += 1) {
  if (i > 0) {
    await moveSelectedLogicTrackByOffset(1);
  }

  const item = itemStates[i];
  if (!item.renameOk) {
    console.log(
      `COLOR_RESULT_${i}=` +
        JSON.stringify(buildSkippedResult("color", item.importOk ? "rename_failed" : "import_failed"))
    );
    item.finishedAt = Date.now();
    console.log(
      `ITEM_TIMING_${i}=` +
        JSON.stringify({
          index: i,
          filename: item.filename,
          durationMs: item.finishedAt - item.startedAt,
          ok: false
        })
    );
    continue;
  }

  try {
    const colorResult = await setTrackColor(context, {
      target: { kind: "selected", expectedCurrentName: item.newName },
      color: item.color,
      previousColor: null
    });
    console.log(`COLOR_RESULT_${i}=` + JSON.stringify(colorResult));
    if (!colorResult || colorResult.ok !== true) {
      throw new Error("color_failed");
    }
    item.colorOk = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(
      `ITEM_FAILURE_${i}=` +
        JSON.stringify({
          index: i,
          filename: item.filename,
          stage: "color",
          error: message
        })
    );
    if (firstFailureIndex === null) {
      firstFailureIndex = i;
      firstFailureStage = "color";
    }
    item.failedStage = item.failedStage ?? "color";
    item.failureMessage = item.failureMessage ?? message;
  }

  item.finishedAt = Date.now();
  const itemSucceeded = item.createOk && item.importOk && item.renameOk && item.colorOk;
  console.log(
    `ITEM_TIMING_${i}=` +
      JSON.stringify({
        index: i,
        filename: item.filename,
        durationMs: item.finishedAt - item.startedAt,
        ok: itemSucceeded
      })
  );
}

const paletteAfterColorPhase = await inspectAndResetColorPalette();
console.log("palette_closed_after_color_phase=" + JSON.stringify(paletteAfterColorPhase));
phaseTimings.colorPassMs = Date.now() - colorPassStartedAt;

for (const item of itemStates) {
  if (item.createOk && item.importOk && item.renameOk && item.colorOk) {
    succeeded += 1;
  } else {
    failed += 1;
  }
}

phaseTimings.totalMs = Date.now() - batchStartedAt;

console.log(
  "TIMING_BREAKDOWN=" +
    JSON.stringify({
      ...phaseTimings,
      createStrategy: "per_file",
      trackCreateCalls,
      avoidedPerFileCreateCalls: 0
    })
);

console.log(
  "BATCH_SUMMARY=" +
    JSON.stringify({
      total: itemStates.length,
      succeeded,
      failed,
      firstFailureIndex,
      firstFailureStage
    })
);
