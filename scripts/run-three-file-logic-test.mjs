import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { AppleScriptRunner } from "../apps/host/dist/apps/host/src/main/automation/applescript.js";
import {
  createAudioTrack,
  renameTrack,
  setTrackColor
} from "../apps/host/dist/apps/host/src/main/logic/actions.js";
import { importAudioFilesIntoCurrentProject } from "../apps/host/dist/apps/host/src/main/logic/importAudioIntoCurrentProject.js";

const execFileAsync = promisify(execFile);

const ZIP_PATH = "/Users/kuhusingh/Downloads/Stems_East_92_Emajor.zip";
const FILE_PLAN = [
  {
    filename: "Indian Big Rhy 1_1.wav",
    newName: "Indian Big Rhy",
    color: "neutral"
  },
  {
    filename: "Kick_1.wav",
    newName: "Kick",
    color: "red"
  },
  {
    filename: "Top Loop 1_1.wav",
    newName: "Top Loop",
    color: "neutral"
  }
];

const logger = (msg) => console.log("[HOST]", msg);
const context = { logger, applescript: new AppleScriptRunner() };

async function extractZip(zipPath) {
  const extractRoot = await mkdtemp(join(tmpdir(), "ctrlx-threefile-import-"));
  await execFileAsync("/usr/bin/unzip", ["-q", zipPath, "-d", extractRoot]);
  const rootEntries = await readdir(extractRoot, { withFileTypes: true });
  const firstDirectory = rootEntries.find((entry) => entry.isDirectory());
  return firstDirectory ? join(extractRoot, firstDirectory.name) : extractRoot;
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

async function wait(ms) {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const extractedFolder = await extractZip(ZIP_PATH);
const items = FILE_PLAN.map((item) => ({
  ...item,
  filePath: join(extractedFolder, item.filename)
}));

console.log(
  "TEST_CONTEXT=" +
    JSON.stringify({
      zipPath: ZIP_PATH,
      extractedFolder,
      itemCount: items.length,
      filenames: items.map((item) => basename(item.filePath)),
      mode: "strict_sequential_single_track_per_file"
    })
);

for (let i = 0; i < items.length; i += 1) {
  const item = items[i];
  console.log("ITEM_START=" + JSON.stringify({ index: i, ...item }));

  const createResult = await createAudioTrack(context, { count: 1 });
  console.log(`CREATE_RESULT_${i}=` + JSON.stringify(createResult));

  const importResult = await importAudioFilesIntoCurrentProject(context, {
    filePaths: [item.filePath]
  });
  console.log(`IMPORT_RESULT_${i}=` + JSON.stringify(importResult));

  const renameResult = await renameTrack(context, {
    target: { kind: "selected", expectedCurrentName: null },
    newName: item.newName
  });
  console.log(`RENAME_RESULT_${i}=` + JSON.stringify(renameResult));

  await wait(1_000);
}

await moveSelectedLogicTrackByOffset(-(items.length - 1));

for (let i = 0; i < items.length; i += 1) {
  if (i > 0) {
    await moveSelectedLogicTrackByOffset(1);
  }

  const item = items[i];
  console.log("ITEM_COLOR_START=" + JSON.stringify({ index: i, name: item.newName, color: item.color }));

  try {
    const colorResult = await setTrackColor(context, {
      target: { kind: "selected", expectedCurrentName: item.newName },
      color: item.color,
      previousColor: null
    });
    console.log(`COLOR_RESULT_${i}=` + JSON.stringify(colorResult));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`COLOR_RESULT_${i}=` + JSON.stringify({ ok: false, error: message }));
  }
}
