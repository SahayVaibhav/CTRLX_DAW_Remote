import type {
  ImportAutomationItem,
  ImportAutomationPlan,
  ImportAutomationTrackTarget,
  ImportDiscoveredAudioFile,
  ImportAutomationLayoutSuggestion
} from "#protocol";
import { buildImportAutomationLayoutSuggestion } from "#protocol";
import type { ImportUploadSession } from "../importUploadManager.js";

export type LogicImportPipelineStrategy =
  | "finder_preselection_candidate"
  | "logic_open_panel_per_file";

export type LogicImportPipelineCapability = {
  supported: boolean;
  executionMode: "live" | "suggestion_only";
  note: string;
};

export type LogicImportPipelineItem = {
  itemIndex: number;
  item: ImportAutomationItem;
  audioFile: ImportDiscoveredAudioFile | null;
  target: ImportAutomationTrackTarget | null;
};

export type LogicImportPipelinePlan = {
  source: "logic_import_pipeline";
  importSessionId: string;
  sourceName: string;
  workingDirectory: string;
  acceptedCount: number;
  skippedCount: number;
  errorCount: number;
  reviewedItemCount: number;
  importStrategy: LogicImportPipelineStrategy;
  trackProvisioningMode: "batch_create_then_per_track_import";
  renameMode: "selected_track_after_import";
  colorMode: "selected_track_after_import";
  commonSourceSelectionPath: string | null;
  items: LogicImportPipelineItem[];
  sessionOrganization: {
    orderingExecution: "suggestion_only";
    stackingExecution: "suggestion_only";
    routingExecution: "suggestion_only";
    layoutSuggestion: ImportAutomationLayoutSuggestion;
  };
  capabilities: {
    importAudio: LogicImportPipelineCapability;
    createTracks: LogicImportPipelineCapability;
    renameTracks: LogicImportPipelineCapability;
    colorTracks: LogicImportPipelineCapability;
    ordering: LogicImportPipelineCapability;
    stacking: LogicImportPipelineCapability;
    routing: LogicImportPipelineCapability;
  };
};

function getCommonSourceSelectionPath(audioFiles: ImportDiscoveredAudioFile[]): string | null {
  const nonEmptyPaths = audioFiles
    .map((file) => file.sourceSelectionPath?.trim() ?? "")
    .filter((path) => path.length > 0);

  if (nonEmptyPaths.length === 0) {
    return null;
  }

  const [firstPath, ...remainingPaths] = nonEmptyPaths;
  return remainingPaths.every((path) => path === firstPath) ? firstPath : null;
}

export function resolveLogicImportPipelineStrategy(
  audioFiles: ImportDiscoveredAudioFile[]
): LogicImportPipelineStrategy {
  const commonSourceSelectionPath = getCommonSourceSelectionPath(audioFiles);

  if (audioFiles.length > 1 && commonSourceSelectionPath) {
    return "finder_preselection_candidate";
  }

  return "logic_open_panel_per_file";
}

export function buildLogicImportPipelinePlan(
  reviewedPlan: ImportAutomationPlan,
  importSession: ImportUploadSession
): LogicImportPipelinePlan {
  const commonSourceSelectionPath = getCommonSourceSelectionPath(importSession.audioFiles);
  const importStrategy = resolveLogicImportPipelineStrategy(importSession.audioFiles);
  const layoutSuggestion = buildImportAutomationLayoutSuggestion(reviewedPlan);

  return {
    source: "logic_import_pipeline",
    importSessionId: importSession.sessionId,
    sourceName: importSession.sourceName,
    workingDirectory: importSession.workingDirectory,
    acceptedCount: importSession.acceptedCount,
    skippedCount: importSession.skippedCount,
    errorCount: importSession.errorCount,
    reviewedItemCount: reviewedPlan.items.length,
    importStrategy,
    trackProvisioningMode: "batch_create_then_per_track_import",
    renameMode: "selected_track_after_import",
    colorMode: "selected_track_after_import",
    commonSourceSelectionPath,
    items: reviewedPlan.items.map((item, index) => {
      const executableItem = reviewedPlan.executableItems[index] ?? null;
      return {
        itemIndex: index,
        item,
        audioFile: importSession.audioFiles[index] ?? null,
        target: executableItem?.target ?? null
      };
    }),
    sessionOrganization: {
      orderingExecution: "suggestion_only",
      stackingExecution: "suggestion_only",
      routingExecution: "suggestion_only",
      layoutSuggestion
    },
    capabilities: {
      importAudio: {
        supported: true,
        executionMode: "live",
        note:
          importStrategy === "finder_preselection_candidate"
            ? "Source files came from a single host selection, so a Forte-style Finder-preselection import strategy can be attempted or evolved here."
            : "CTRLX will use the current per-file Logic import strategy for this session."
      },
      createTracks: {
        supported: true,
        executionMode: "live",
        note: "CTRLX creates the required Logic audio tracks before the per-track import loop starts."
      },
      renameTracks: {
        supported: true,
        executionMode: "live",
        note: "CTRLX renames the selected imported track after each successful import."
      },
      colorTracks: {
        supported: true,
        executionMode: "live",
        note: "CTRLX colors the selected imported track after rename."
      },
      ordering: {
        supported: false,
        executionMode: "suggestion_only",
        note: "Ordering remains planner-visible and suggestion-only until a reliable Logic track-reorder host action is added."
      },
      stacking: {
        supported: false,
        executionMode: "suggestion_only",
        note: "Track stack creation remains suggestion-only until a reusable Logic stack host action is implemented."
      },
      routing: {
        supported: false,
        executionMode: "suggestion_only",
        note: "Routing and bus labeling remain suggestion-only until a reusable Logic routing host action is implemented."
      }
    }
  };
}
