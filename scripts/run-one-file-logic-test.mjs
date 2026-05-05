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
const FILE_PLAN = {
  filename: "Indian Big Rhy 1_1.wav",
  newName: "Indian Big Rhy",
  color: "neutral"
};

const logger = (msg) => console.log("[HOST]", msg);
const context = { logger, applescript: new AppleScriptRunner() };

async function extractZip(zipPath) {
  const extractRoot = await mkdtemp(join(tmpdir(), "ctrlx-onefile-import-"));
  await execFileAsync("/usr/bin/unzip", ["-q", zipPath, "-d", extractRoot]);
  const rootEntries = await readdir(extractRoot, { withFileTypes: true });
  const firstDirectory = rootEntries.find((entry) => entry.isDirectory());
  return firstDirectory ? join(extractRoot, firstDirectory.name) : extractRoot;
}

const extractedFolder = await extractZip(ZIP_PATH);
const item = {
  ...FILE_PLAN,
  filePath: join(extractedFolder, FILE_PLAN.filename)
};

console.log(
  "TEST_CONTEXT=" +
    JSON.stringify({
      zipPath: ZIP_PATH,
      extractedFolder,
      filename: basename(item.filePath)
    })
);

const createResult = await createAudioTrack(context, { count: 1 });
console.log("CREATE_BATCH=" + JSON.stringify(createResult));

const importResult = await importAudioFilesIntoCurrentProject(context, {
  filePaths: [item.filePath]
});
console.log("IMPORT_RESULT=" + JSON.stringify(importResult));

const renameResult = await renameTrack(context, {
  target: { kind: "selected", expectedCurrentName: null },
  newName: item.newName
});
console.log("RENAME_RESULT=" + JSON.stringify(renameResult));

const colorResult = await setTrackColor(context, {
  target: { kind: "selected", expectedCurrentName: item.newName },
  color: item.color,
  previousColor: null
});
console.log("COLOR_RESULT=" + JSON.stringify(colorResult));
