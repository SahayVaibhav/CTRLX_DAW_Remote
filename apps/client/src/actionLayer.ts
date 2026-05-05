import {
  analyzeImportedAudioFile,
  buildImportAutomationPlanFromReviewedItems,
  type CommandPayload,
  type CommandResultPayload,
  type CtrlxCommand,
  type ImportAutomationCategory,
  type ImportAutomationColor,
  type ImportAutomationConfidence,
  type ImportAutomationItem,
  type ImportAutomationPlan
} from "@ctrlx/protocol";
import {
  runReviewedImportExecution,
  type ReviewedImportExecutionOutcome,
  type ReviewedImportExecutionRequest
} from "./importExecution";
import type { CtrlxWsClient, HostImportSelectionResult, ImportUploadResult } from "./ws";

export type CtrlxActionTransport = Pick<
  CtrlxWsClient,
  "sendCommand" | "sendCommandMessageForResult" | "uploadImportArchive" | "requestHostImportSelection"
>;

export type ReviewedImportWorkflowRequest = ReviewedImportExecutionRequest;
export type ReviewedImportWorkflowOutcome = ReviewedImportExecutionOutcome;

export type CtrlxActionLayer = {
  sendLiveCommand: (command: CtrlxCommand) => void;
  executeStructuredCommand: (payload: CommandPayload) => Promise<CommandResultPayload>;
  uploadImportArchive: (sourceName: string, archive: Blob) => Promise<ImportUploadResult>;
  requestHostImportSelection: (allowFolders?: boolean) => Promise<HostImportSelectionResult>;
  runReviewedImportWorkflow: (
    request: ReviewedImportWorkflowRequest
  ) => Promise<ReviewedImportWorkflowOutcome>;
};

const IMPORT_AUTOMATION_CATEGORIES = new Set<ImportAutomationCategory>([
  "drums",
  "vocals",
  "bass",
  "guitar",
  "keys",
  "fx",
  "percussion",
  "synth",
  "ambience",
  "unknown"
]);

const IMPORT_AUTOMATION_COLORS = new Set<ImportAutomationColor>([
  "red",
  "orange",
  "green",
  "blue",
  "yellow",
  "cyan",
  "purple",
  "pink",
  "gray",
  "neutral"
]);

const IMPORT_AUTOMATION_CONFIDENCES = new Set<ImportAutomationConfidence>(["high", "medium", "low"]);

type CreateCtrlxActionLayerOptions = {
  transport: CtrlxActionTransport;
};

export function createCtrlxActionLayer({
  transport
}: CreateCtrlxActionLayerOptions): CtrlxActionLayer {
  return {
    sendLiveCommand(command: CtrlxCommand): void {
      transport.sendCommand(command);
    },

    executeStructuredCommand(payload: CommandPayload): Promise<CommandResultPayload> {
      return transport.sendCommandMessageForResult(payload);
    },

    uploadImportArchive(sourceName: string, archive: Blob): Promise<ImportUploadResult> {
      return transport.uploadImportArchive(sourceName, archive);
    },

    requestHostImportSelection(allowFolders = true): Promise<HostImportSelectionResult> {
      return transport.requestHostImportSelection(allowFolders);
    },

    runReviewedImportWorkflow(
      request: ReviewedImportWorkflowRequest
    ): Promise<ReviewedImportWorkflowOutcome> {
      return runReviewedImportExecution(request, {
        sendCommandMessageForResult: (payload) => transport.sendCommandMessageForResult(payload)
      });
    }
  };
}

export function createReviewedImportWorkflowRequest(
  reviewedItems: ImportAutomationItem[],
  importSessionId: string | null,
  isPaired: boolean
): ReviewedImportWorkflowRequest {
  return {
    reviewedItems,
    importSessionId,
    isPaired
  };
}

export function normalizeUploadedImportItems(items: unknown[]): ImportAutomationItem[] {
  return items
    .filter((value): value is Record<string, unknown> => typeof value === "object" && value !== null)
    .map((value) => {
      const originalFilename =
        typeof value.originalFilename === "string" ? value.originalFilename : "Imported Audio";
      const fallback = analyzeImportedAudioFile(originalFilename);
      const detectedCategory =
        typeof value.detectedCategory === "string" &&
        IMPORT_AUTOMATION_CATEGORIES.has(value.detectedCategory as ImportAutomationCategory)
          ? (value.detectedCategory as ImportAutomationCategory)
          : fallback.detectedCategory;
      const assignedColor =
        typeof value.assignedColor === "string" &&
        IMPORT_AUTOMATION_COLORS.has(value.assignedColor as ImportAutomationColor)
          ? (value.assignedColor as ImportAutomationColor)
          : fallback.assignedColor;
      const confidence =
        typeof value.confidence === "string" &&
        IMPORT_AUTOMATION_CONFIDENCES.has(value.confidence as ImportAutomationConfidence)
          ? (value.confidence as ImportAutomationConfidence)
          : fallback.confidence;

      return {
        originalFilename,
        normalizedFilename:
          typeof value.normalizedFilename === "string"
            ? value.normalizedFilename
            : fallback.normalizedFilename,
        detectedCategory,
        cleanTrackName:
          typeof value.cleanTrackName === "string"
            ? value.cleanTrackName
            : fallback.cleanTrackName,
        assignedColor,
        confidence
      };
    });
}

export function normalizeUploadedImportPlan(plan: unknown): ImportAutomationPlan {
  const candidate = typeof plan === "object" && plan !== null ? (plan as Record<string, unknown>) : null;
  const normalizedItems = normalizeUploadedImportItems(Array.isArray(candidate?.items) ? candidate.items : []);
  return buildImportAutomationPlanFromReviewedItems(normalizedItems);
}
