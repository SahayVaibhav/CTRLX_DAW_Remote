import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
  analyzeImportedAudioFile,
  buildImportAutomationPlanFromItems,
  type ImportAutomationItem,
  type ImportAutomationPlan,
  type ImportDiscoveredAudioFile
} from "#protocol";
import { ImportFileDiscoveryService } from "./importFileDiscovery.js";

export type ImportUploadSession = {
  sessionId: string;
  sourceName: string;
  workingDirectory: string;
  items: ImportAutomationItem[];
  audioFiles: ImportDiscoveredAudioFile[];
  acceptedCount: number;
  skippedCount: number;
  errorCount: number;
  createdAt: string;
};

export type ImportUploadResult = {
  sessionId: string;
  sourceName: string;
  acceptedCount: number;
  skippedCount: number;
  errorCount: number;
  items: ImportAutomationItem[];
  plan: ImportAutomationPlan;
};

export class ImportUploadManager {
  private readonly sessions = new Map<string, ImportUploadSession>();
  private readonly discovery: ImportFileDiscoveryService;

  constructor(private readonly logger: (message: string) => void) {
    this.discovery = new ImportFileDiscoveryService(logger);
  }

  async ingestArchiveUpload(sourceName: string, archiveBuffer: Buffer): Promise<ImportUploadResult> {
    const discovery = await this.discovery.discoverFromSources([
      {
        kind: "archive_buffer",
        sourceName,
        archiveBuffer
      }
    ]);
    const items = discovery.discoveredFiles.map((file) => analyzeImportedAudioFile(basename(file.filename)));
    const sessionId = randomUUID();
    const plan = buildImportAutomationPlanFromItems(items);
    const session: ImportUploadSession = {
      sessionId,
      sourceName,
      workingDirectory: discovery.workingDirectory,
      items,
      audioFiles: discovery.discoveredFiles,
      acceptedCount: discovery.discoveredFiles.length,
      skippedCount: discovery.skippedEntries.length,
      errorCount: discovery.errors.length,
      createdAt: new Date().toISOString()
    };

    this.sessions.set(sessionId, session);
    this.logger(
      `Imported archive ${sourceName} into host upload session ${sessionId} with ${session.acceptedCount} audio file${
        session.acceptedCount === 1 ? "" : "s"
      }.`
    );

    return {
      sessionId,
      sourceName,
      acceptedCount: session.acceptedCount,
      skippedCount: session.skippedCount,
      errorCount: session.errorCount,
      items: session.items,
      plan
    };
  }

  async ingestSelectedPaths(paths: string[]): Promise<ImportUploadResult> {
    const normalizedPaths = paths.map((path) => path.trim()).filter((path) => path.length > 0);
    const discovery = await this.discovery.discoverFromSources(
      normalizedPaths.map((path) => ({
        kind: "path" as const,
        path
      }))
    );
    const sourceName =
      normalizedPaths.length === 1
        ? basename(normalizedPaths[0])
        : `Host Selection (${normalizedPaths.length} items)`;
    const items = discovery.discoveredFiles.map((file) => analyzeImportedAudioFile(basename(file.filename)));
    const sessionId = randomUUID();
    const plan = buildImportAutomationPlanFromItems(items);
    const session: ImportUploadSession = {
      sessionId,
      sourceName,
      workingDirectory: discovery.workingDirectory,
      items,
      audioFiles: discovery.discoveredFiles,
      acceptedCount: discovery.discoveredFiles.length,
      skippedCount: discovery.skippedEntries.length,
      errorCount: discovery.errors.length,
      createdAt: new Date().toISOString()
    };

    this.sessions.set(sessionId, session);
    this.logger(
      `Imported host selection ${sourceName} into session ${sessionId} with ${session.acceptedCount} audio file${
        session.acceptedCount === 1 ? "" : "s"
      }.`
    );

    return {
      sessionId,
      sourceName,
      acceptedCount: session.acceptedCount,
      skippedCount: session.skippedCount,
      errorCount: session.errorCount,
      items: session.items,
      plan
    };
  }

  getSession(sessionId: string): ImportUploadSession | null {
    return this.sessions.get(sessionId) ?? null;
  }
}
