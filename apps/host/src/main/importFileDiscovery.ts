import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { basename, extname, join, relative } from "node:path";
import JSZip from "jszip";
import type { ImportDiscoveredAudioFile } from "#protocol";

const SUPPORTED_AUDIO_EXTENSIONS = new Set([
  ".wav",
  ".wave",
  ".aif",
  ".aiff",
  ".caf",
  ".mp3",
  ".m4a",
  ".flac"
]);

export type ImportDiscoveryInputSource =
  | {
      kind: "path";
      path: string;
    }
  | {
      kind: "archive_buffer";
      sourceName: string;
      archiveBuffer: Buffer;
    };

export type ImportDiscoverySkippedEntry = {
  path: string;
  reason: "unsupported_extension" | "empty_zip_entry" | "not_found" | "not_a_file" | "macos_metadata";
};

export type ImportDiscoveryError = {
  path: string;
  reason: string;
};

export type ImportDiscoveryResult = {
  workingDirectory: string;
  discoveredFiles: ImportDiscoveredAudioFile[];
  skippedEntries: ImportDiscoverySkippedEntry[];
  errors: ImportDiscoveryError[];
};

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function isSupportedAudioFilePath(filePath: string): boolean {
  return SUPPORTED_AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function isMacOsMetadataPath(filePath: string): boolean {
  const name = basename(filePath);
  return name.startsWith("._") || filePath.includes("__MACOSX/");
}

function ensureUniquePath(destinationDirectory: string, preferredName: string, usedPaths: Set<string>): string {
  const extension = extname(preferredName);
  const stem = preferredName.slice(0, preferredName.length - extension.length) || "audio";
  let attempt = 0;

  while (true) {
    const candidateName = attempt === 0 ? preferredName : `${stem}-${attempt + 1}${extension}`;
    const candidatePath = join(destinationDirectory, candidateName);
    if (!usedPaths.has(candidatePath)) {
      usedPaths.add(candidatePath);
      return candidatePath;
    }
    attempt += 1;
  }
}

async function walkDirectory(rootDirectory: string): Promise<string[]> {
  const entries = await readdir(rootDirectory, { withFileTypes: true });
  const paths: string[] = [];

  for (const entry of entries) {
    const entryPath = join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      paths.push(...(await walkDirectory(entryPath)));
      continue;
    }

    if (entry.isFile()) {
      paths.push(entryPath);
    }
  }

  return paths;
}

export class ImportFileDiscoveryService {
  constructor(private readonly logger: (message: string) => void) {}

  async discoverFromSources(sources: ImportDiscoveryInputSource[]): Promise<ImportDiscoveryResult> {
    const workingDirectory = await mkdtemp(join(tmpdir(), "ctrlx-import-discovery-"));
    const extractedDirectory = join(workingDirectory, "extracted");
    await mkdir(extractedDirectory, { recursive: true });

    const discoveredFiles: ImportDiscoveredAudioFile[] = [];
    const skippedEntries: ImportDiscoverySkippedEntry[] = [];
    const errors: ImportDiscoveryError[] = [];
    const usedExtractedPaths = new Set<string>();

    for (const source of sources) {
      try {
        if (source.kind === "archive_buffer") {
          await this.extractArchiveBuffer(source, extractedDirectory, usedExtractedPaths, discoveredFiles, skippedEntries);
          continue;
        }

        await this.discoverFromPathSource(source.path, extractedDirectory, usedExtractedPaths, discoveredFiles, skippedEntries);
      } catch (error) {
        errors.push({
          path: source.kind === "path" ? source.path : source.sourceName,
          reason: error instanceof Error ? error.message : "Unknown discovery error."
        });
      }
    }

    this.logger(
      `Discovered ${discoveredFiles.length} supported audio file${discoveredFiles.length === 1 ? "" : "s"} for import.`
    );

    return {
      workingDirectory,
      discoveredFiles,
      skippedEntries,
      errors
    };
  }

  private async discoverFromPathSource(
    sourcePath: string,
    extractedDirectory: string,
    usedExtractedPaths: Set<string>,
    discoveredFiles: ImportDiscoveredAudioFile[],
    skippedEntries: ImportDiscoverySkippedEntry[]
  ): Promise<void> {
    let sourceStat;
    try {
      sourceStat = await stat(sourcePath);
    } catch {
      skippedEntries.push({
        path: sourcePath,
        reason: "not_found"
      });
      return;
    }

    if (sourceStat.isDirectory()) {
      const files = await walkDirectory(sourcePath);
      for (const filePath of files) {
        await this.ingestCandidateFile(
          filePath,
          "direct_file",
          sourcePath,
          extractedDirectory,
          usedExtractedPaths,
          discoveredFiles,
          skippedEntries
        );
      }
      return;
    }

    if (!sourceStat.isFile()) {
      skippedEntries.push({
        path: sourcePath,
        reason: "not_a_file"
      });
      return;
    }

    if (extname(sourcePath).toLowerCase() === ".zip") {
      const archiveBuffer = await readFile(sourcePath);
      await this.extractArchiveBuffer(
        {
          kind: "archive_buffer",
          sourceName: basename(sourcePath),
          archiveBuffer
        },
        extractedDirectory,
        usedExtractedPaths,
        discoveredFiles,
        skippedEntries,
        sourcePath
      );
      return;
    }

    await this.ingestCandidateFile(
      sourcePath,
      "direct_file",
      null,
      extractedDirectory,
      usedExtractedPaths,
      discoveredFiles,
      skippedEntries
    );
  }

  private async extractArchiveBuffer(
    source: Extract<ImportDiscoveryInputSource, { kind: "archive_buffer" }>,
    extractedDirectory: string,
    usedExtractedPaths: Set<string>,
    discoveredFiles: ImportDiscoveredAudioFile[],
    skippedEntries: ImportDiscoverySkippedEntry[],
    sourceSelectionPath: string | null = null
  ): Promise<void> {
    const zip = await JSZip.loadAsync(source.archiveBuffer);
    const archiveRoot = join(extractedDirectory, `${sanitizePathSegment(source.sourceName)}-${randomUUID()}`);
    await mkdir(archiveRoot, { recursive: true });

    for (const entry of Object.values(zip.files)) {
      if (entry.dir) {
        continue;
      }

      if (isMacOsMetadataPath(entry.name)) {
        skippedEntries.push({
          path: `${source.sourceName}:${entry.name}`,
          reason: "macos_metadata"
        });
        continue;
      }

      if (!isSupportedAudioFilePath(entry.name)) {
        skippedEntries.push({
          path: `${source.sourceName}:${entry.name}`,
          reason: "unsupported_extension"
        });
        continue;
      }

      const relativeEntryPath = entry.name.replace(/^\/+/, "");
      if (!relativeEntryPath) {
        skippedEntries.push({
          path: `${source.sourceName}:${entry.name}`,
          reason: "empty_zip_entry"
        });
        continue;
      }

      const preferredName = basename(relativeEntryPath);
      const extractedPath = ensureUniquePath(archiveRoot, sanitizePathSegment(preferredName), usedExtractedPaths);
      const content = await entry.async("nodebuffer");
      await writeFile(extractedPath, content);
      discoveredFiles.push({
        filename: basename(relativeEntryPath),
        path: extractedPath,
        extension: extname(relativeEntryPath).toLowerCase(),
        size: content.byteLength,
        sourceType: "zip_extracted",
        relativePath: relativeEntryPath,
        sourceSelectionPath,
        sourceArchiveName: source.sourceName
      });
    }
  }

  private async ingestCandidateFile(
    filePath: string,
    sourceType: "direct_file",
    relativeRoot: string | null,
    _extractedDirectory: string,
    _usedExtractedPaths: Set<string>,
    discoveredFiles: ImportDiscoveredAudioFile[],
    skippedEntries: ImportDiscoverySkippedEntry[]
  ): Promise<void> {
    if (isMacOsMetadataPath(filePath)) {
      skippedEntries.push({
        path: filePath,
        reason: "macos_metadata"
      });
      return;
    }

    if (!isSupportedAudioFilePath(filePath)) {
      skippedEntries.push({
        path: filePath,
        reason: "unsupported_extension"
      });
      return;
    }

    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) {
      skippedEntries.push({
        path: filePath,
        reason: "not_a_file"
      });
      return;
    }

    discoveredFiles.push({
      filename: basename(filePath),
      path: filePath,
      extension: extname(filePath).toLowerCase(),
      size: fileStat.size,
      sourceType,
      relativePath: relativeRoot ? relative(relativeRoot, filePath) : basename(filePath),
      sourceSelectionPath: relativeRoot ?? filePath,
      sourceArchiveName: null
    });
  }
}
