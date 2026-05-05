import { type ChangeEvent, useMemo } from "react";
import {
  buildImportAutomationLayoutSuggestion,
  buildImportAutomationPlanFromReviewedItems,
  IMPORT_AUTOMATION_EXECUTABLE_ACTIONS,
  IMPORT_AUTOMATION_EXECUTABLE_ACTION_LABELS,
  IMPORT_AUTOMATION_SUGGESTION_ACTIONS,
  IMPORT_AUTOMATION_SUGGESTION_ACTION_LABELS,
  type ImportAutomationCategory,
  type ImportAutomationColor,
  type ImportAutomationExecutionReport,
  type ImportAutomationItem,
  type ImportExecutionProgressPhase,
  type ImportExecutionProgressUpdate
} from "@ctrlx/protocol";

type AssistantPanelProps = {
  prompt: string;
  onPromptChange: (value: string) => void;
  onSend: () => void;
  importPlanItems: ImportAutomationItem[];
  onRequestImportSelection: () => void;
  onUpdateImportPlanItem: (
    index: number,
    patch: Partial<Pick<ImportAutomationItem, "cleanTrackName" | "detectedCategory" | "assignedColor">>
  ) => void;
  importReviewSuggestionOverrides: ImportReviewSuggestionOverride[];
  onUpdateImportPlanSuggestion: (index: number, patch: Partial<ImportReviewSuggestionOverride>) => void;
  onConfirmImportPlan: () => void;
  onCancelImportPlan: () => void;
  importExecutionReport: ImportAutomationExecutionReport | null;
  importExecutionProgressUpdates: ImportExecutionProgressUpdate[];
  isImportPlanExecuting: boolean;
  isImportPlanLoading: boolean;
  importPlanSourceLabel: string | null;
};

type ImportReviewSuggestionOverride = {
  suggestedOrder?: number;
  suggestedGroupLabel?: string;
  suggestedStackLabel?: string;
  suggestedBusLabel?: string;
};

type ReviewSessionPrepItem = {
  index: number;
  originalFilename: string;
  cleanTrackName: string;
  category: ImportAutomationCategory;
  color: ImportAutomationColor;
  suggestedOrder: number;
  suggestedGroupLabel: string;
  suggestedStackLabel: string | null;
  suggestedBusLabel: string | null;
};

const colorChipClassName: Record<ImportAutomationColor, string> = {
  red: "bg-red-400/85",
  orange: "bg-orange-400/85",
  green: "bg-emerald-400/85",
  blue: "bg-sky-400/85",
  yellow: "bg-amber-300/90",
  cyan: "bg-cyan-300/90",
  purple: "bg-violet-400/85",
  pink: "bg-pink-400/85",
  gray: "bg-slate-400/85",
  neutral: "bg-zinc-400/85"
};

const importAutomationCategories: readonly ImportAutomationCategory[] = [
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
] as const;

const importAutomationColors: readonly ImportAutomationColor[] = [
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
] as const;

const confidenceToneClassName = {
  high: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  medium: "border-amber-400/20 bg-amber-400/10 text-amber-100",
  low: "border-white/10 bg-white/[0.04] text-ctrlx-muted"
} as const;

const executableActionBadgeClassName =
  "rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-ctrlx text-emerald-200";
const suggestionActionBadgeClassName =
  "rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-ctrlx text-amber-100";

const importProgressStageOrder: ImportExecutionProgressPhase[] = [
  "files_selected",
  "files_discovered",
  "plan_generated",
  "review_confirmed",
  "import_started",
  "importing",
  "track_targeting",
  "renaming",
  "coloring",
  "ordering",
  "completed",
  "failed",
  "cancelled"
];

const importProgressStageLabels: Record<ImportExecutionProgressPhase, string> = {
  files_selected: "Files Selected",
  files_discovered: "Files Discovered",
  plan_generated: "Plan Generated",
  review_confirmed: "Review Confirmed",
  import_started: "Import Starting",
  importing: "Importing",
  track_targeting: "Track Targeting",
  renaming: "Renaming",
  coloring: "Coloring",
  ordering: "Ordering",
  item_started: "Item Started",
  item_progress: "Item Progress",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled"
};

export function AssistantPanel({
  prompt,
  onPromptChange,
  onSend,
  importPlanItems,
  onRequestImportSelection,
  onUpdateImportPlanItem,
  importReviewSuggestionOverrides,
  onUpdateImportPlanSuggestion,
  onConfirmImportPlan,
  onCancelImportPlan,
  importExecutionReport,
  importExecutionProgressUpdates,
  isImportPlanExecuting,
  isImportPlanLoading,
  importPlanSourceLabel
}: AssistantPanelProps) {
  const hasImportPlan = importPlanItems.length > 0;
  const layoutSuggestion = hasImportPlan
    ? buildImportAutomationLayoutSuggestion(buildImportAutomationPlanFromReviewedItems(importPlanItems))
    : null;
  const sessionPrepReview = useMemo(() => {
    if (!layoutSuggestion) {
      return null;
    }

    const orderedItems: ReviewSessionPrepItem[] = importPlanItems.map((item, index) => {
      const baseSuggestion = layoutSuggestion.orderedItems.find(
        (candidate) => candidate.originalFilename === item.originalFilename
      );
      const override = importReviewSuggestionOverrides[index] ?? {};

      return {
        index,
        originalFilename: item.originalFilename,
        cleanTrackName: item.cleanTrackName,
        category: item.detectedCategory,
        color: item.assignedColor,
        suggestedOrder: override.suggestedOrder ?? baseSuggestion?.suggestedOrder ?? index + 1,
        suggestedGroupLabel:
          override.suggestedGroupLabel?.trim() || baseSuggestion?.suggestedGroupLabel || item.detectedCategory,
        suggestedStackLabel:
          override.suggestedStackLabel?.trim() || baseSuggestion?.suggestedStackLabel || null,
        suggestedBusLabel: override.suggestedBusLabel?.trim() || baseSuggestion?.suggestedBusLabel || null
      };
    });

    orderedItems.sort((left, right) => {
      if (left.suggestedOrder === right.suggestedOrder) {
        return left.cleanTrackName.localeCompare(right.cleanTrackName);
      }

      return left.suggestedOrder - right.suggestedOrder;
    });

    const groups = orderedItems.reduce<
      Array<{
        key: string;
        groupLabel: string;
        order: number;
        category: ImportAutomationCategory;
        stackLabel: string | null;
        busLabel: string | null;
        items: ReviewSessionPrepItem[];
      }>
    >((current, item) => {
      const key = [
        item.suggestedGroupLabel,
        item.suggestedStackLabel ?? "none",
        item.suggestedBusLabel ?? "none"
      ].join("::");
      const existingGroup = current.find((candidate) => candidate.key === key);

      if (existingGroup) {
        existingGroup.items.push(item);
        existingGroup.order = Math.min(existingGroup.order, item.suggestedOrder);
        return current;
      }

      current.push({
        key,
        groupLabel: item.suggestedGroupLabel,
        order: item.suggestedOrder,
        category: item.category,
        stackLabel: item.suggestedStackLabel,
        busLabel: item.suggestedBusLabel,
        items: [item]
      });

      return current;
    }, []);

    groups.sort((left, right) => left.order - right.order);

    return {
      orderedItems,
      groups
    };
  }, [importPlanItems, importReviewSuggestionOverrides, layoutSuggestion]);

  const latestImportProgress = importExecutionProgressUpdates[0] ?? null;
  const progressStageSummary = useMemo(() => {
    return importProgressStageOrder
      .map((phase) => {
        const matchingUpdate = [...importExecutionProgressUpdates].reverse().find((update) => update.phase === phase);
        if (!matchingUpdate) {
          return {
            phase,
            label: importProgressStageLabels[phase],
            status: "pending" as const,
            message: null as string | null
          };
        }

        return {
          phase,
          label: importProgressStageLabels[phase],
          status: matchingUpdate.status,
          message: matchingUpdate.message
        };
      })
      .filter((stage) => stage.status !== "pending" || stage.phase === "files_selected");
  }, [importExecutionProgressUpdates]);
  const importActionLabels: Record<string, string> = {
    create_audio_track: "Imported",
    rename_track: "Renamed",
    set_track_color: "Colored"
  };

  return (
    <aside className="flex h-full flex-col rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,23,34,0.96),rgba(9,14,22,0.96))] p-6 shadow-panel backdrop-blur-xl">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Assistant</p>
        <h2 className="mt-4 text-[2rem] font-semibold tracking-[-0.04em] text-ctrlx-text">Command Desk</h2>
        <p className="mt-3 text-sm leading-6 text-ctrlx-muted">
          Structured assistant surface for future AI flows. Phase 1 keeps this panel as a guided placeholder.
        </p>
      </div>

      <div className="mt-8 flex-1 space-y-4">
        <div className="rounded-[26px] border border-white/10 bg-ctrlx-panelAlt p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Assistant</span>
            <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
              Placeholder
            </span>
          </div>
          <p className="mt-3 text-sm leading-6 text-ctrlx-text">
            I can queue a Logic action, explain what it does, and later evolve into a full assistant layer.
          </p>
        </div>

        <div className="rounded-[26px] border border-ctrlx-accent/20 bg-[linear-gradient(180deg,rgba(153,247,255,0.14),rgba(153,247,255,0.07))] p-4 shadow-glow">
          <span className="block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Suggested Action</span>
          <p className="mt-3 text-sm leading-6 text-ctrlx-edge">
            “Save project, then toggle playback.” This remains a placeholder until the AI backend is added.
          </p>
          <button className="mt-4 rounded-[18px] border border-ctrlx-accent/30 bg-ctrlx-panelAlt px-4 py-2.5 text-sm font-semibold text-ctrlx-edge shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] transition hover:border-ctrlx-accent/55 hover:bg-white/[0.05]">
            Execute Placeholder
          </button>
        </div>

        <div className="rounded-[26px] border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <span className="block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                Import Review
              </span>
              <p className="mt-2 text-sm leading-6 text-ctrlx-text">
                Trigger host-side file selection, review the parsed plan here, then apply the live import actions.
              </p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div className="rounded-[18px] border border-emerald-400/15 bg-emerald-400/[0.06] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-emerald-200">
                    Live / Executable
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {IMPORT_AUTOMATION_EXECUTABLE_ACTIONS.map((action) => (
                      <span key={action} className={executableActionBadgeClassName}>
                        {IMPORT_AUTOMATION_EXECUTABLE_ACTION_LABELS[action]}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-ctrlx-muted">
                    These actions are routed into the real host command pipeline when you confirm the plan.
                  </p>
                </div>

                <div className="rounded-[18px] border border-amber-400/15 bg-amber-400/[0.06] p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-amber-100">
                    Suggestion-Only
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {IMPORT_AUTOMATION_SUGGESTION_ACTIONS.map((action) => (
                      <span key={action} className={suggestionActionBadgeClassName}>
                        {IMPORT_AUTOMATION_SUGGESTION_ACTION_LABELS[action]}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs leading-5 text-ctrlx-muted">
                    These remain recommendations only. They are shown for planning but are not sent to Logic yet.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onRequestImportSelection}
                disabled={isImportPlanLoading}
                className="rounded-[18px] border border-ctrlx-accent/30 bg-[linear-gradient(180deg,rgba(153,247,255,0.14),rgba(153,247,255,0.07))] px-4 py-2.5 text-sm font-semibold text-ctrlx-edge transition hover:border-ctrlx-accent/55 hover:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isImportPlanLoading ? "Loading..." : "Import On Host"}
              </button>
            </div>
          </div>

          {hasImportPlan ? (
            <div className="mt-4 space-y-3">
              {importPlanSourceLabel ? (
                <div className="rounded-[18px] border border-white/10 bg-black/10 px-4 py-3 text-xs text-ctrlx-muted">
                  Source: {importPlanSourceLabel}
                </div>
              ) : null}
              {sessionPrepReview ? (
                <div className="rounded-[20px] border border-amber-400/15 bg-amber-400/[0.05] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ctrlx-text">Session Prep Suggestions</p>
                      <p className="mt-1 text-xs leading-5 text-ctrlx-muted">
                        Deterministic grouping and routing suggestions based on filename/category classification. These remain suggestion-only until live host support exists.
                      </p>
                    </div>
                    <span className={suggestionActionBadgeClassName}>Suggestion-Only</span>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-2">
                    {sessionPrepReview.groups.map((group) => (
                      <div
                        key={`group-${group.key}`}
                        className="rounded-[16px] border border-white/10 bg-black/10 p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-ctrlx-text">{group.groupLabel}</p>
                          <span className="text-[10px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                            Order {group.order}
                          </span>
                        </div>
                        <div className="mt-2 space-y-1 text-xs text-ctrlx-muted">
                          <p>Category: {group.category}</p>
                          <p>Suggested stack: {group.stackLabel ?? "none"}</p>
                          <p>Suggested bus: {group.busLabel ?? "none"}</p>
                          <p>
                            Tracks:{" "}
                            {group.items.map((item) => item.cleanTrackName).join(", ")}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-[16px] border border-white/10 bg-black/10 p-3">
                    <p className="text-xs font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                      Suggested Session Order
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {sessionPrepReview.orderedItems.map((item) => (
                        <span
                          key={`ordered-${item.originalFilename}-${item.suggestedOrder}`}
                          className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-ctrlx-text"
                        >
                          {item.suggestedOrder}. {item.cleanTrackName}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="max-h-[420px] space-y-3 overflow-y-auto pr-1">
                {importPlanItems.map((item, index) => (
                  <div key={`${item.originalFilename}-${index}`} className="rounded-[22px] border border-white/10 bg-ctrlx-panelAlt p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-ctrlx-text">{item.originalFilename}</p>
                        <p className="mt-1 text-xs text-ctrlx-muted">{item.normalizedFilename}</p>
                      </div>
                      <span
                        className={[
                          "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-ctrlx",
                          confidenceToneClassName[item.confidence]
                        ].join(" ")}
                      >
                        {item.confidence}
                      </span>
                    </div>

                    <div className="mt-4 space-y-3">
                      <label className="block">
                        <span className="mb-2 block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                          Track Name
                        </span>
                        <input
                          value={item.cleanTrackName}
                          onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            onUpdateImportPlanItem(index, { cleanTrackName: event.target.value })
                          }
                          className="w-full rounded-[18px] border border-white/10 bg-[#0f1823] px-4 py-3 text-sm text-ctrlx-text outline-none transition focus:border-ctrlx-accent/50"
                        />
                      </label>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                            Category
                          </span>
                          <select
                            value={item.detectedCategory}
                            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                              onUpdateImportPlanItem(index, {
                                detectedCategory: event.target.value as ImportAutomationCategory
                              })
                            }
                            className="w-full rounded-[18px] border border-white/10 bg-[#0f1823] px-4 py-3 text-sm text-ctrlx-text outline-none transition focus:border-ctrlx-accent/50"
                          >
                            {importAutomationCategories.map((category) => (
                              <option key={category} value={category}>
                                {category}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block">
                          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                            Color
                          </span>
                          <select
                            value={item.assignedColor}
                            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                              onUpdateImportPlanItem(index, {
                                assignedColor: event.target.value as ImportAutomationColor
                              })
                            }
                            className="w-full rounded-[18px] border border-white/10 bg-[#0f1823] px-4 py-3 text-sm text-ctrlx-text outline-none transition focus:border-ctrlx-accent/50"
                          >
                            {importAutomationColors.map((color) => (
                              <option key={color} value={color}>
                                {color}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="flex items-center gap-3 text-xs text-ctrlx-muted">
                        <span className={["h-3 w-3 rounded-full border border-white/10", colorChipClassName[item.assignedColor]].join(" ")} />
                        <span>Category: {item.detectedCategory}</span>
                        <span>Color: {item.assignedColor}</span>
                      </div>

                      {sessionPrepReview ? (
                        (() => {
                          const layoutItem = sessionPrepReview.orderedItems.find(
                            (candidate) => candidate.originalFilename === item.originalFilename
                          );

                          if (!layoutItem) {
                            return null;
                          }

                          return (
                            <div className="rounded-[16px] border border-amber-400/15 bg-amber-400/[0.05] p-3">
                              <div className="flex items-center justify-between gap-3">
                                <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-amber-100">
                                  Session Prep Review
                                </p>
                                <span className={suggestionActionBadgeClassName}>Suggestion-Only</span>
                              </div>

                              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                <label className="block">
                                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                                    Order / Stack Position
                                  </span>
                                  <input
                                    type="number"
                                    min={1}
                                    value={layoutItem.suggestedOrder}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                      onUpdateImportPlanSuggestion(index, {
                                        suggestedOrder: Math.max(1, Number(event.target.value) || 1)
                                      })
                                    }
                                    className="w-full rounded-[18px] border border-white/10 bg-[#0f1823] px-4 py-3 text-sm text-ctrlx-text outline-none transition focus:border-amber-300/40"
                                  />
                                </label>

                                <label className="block">
                                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                                    Group Label
                                  </span>
                                  <input
                                    value={layoutItem.suggestedGroupLabel}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                      onUpdateImportPlanSuggestion(index, {
                                        suggestedGroupLabel: event.target.value
                                      })
                                    }
                                    className="w-full rounded-[18px] border border-white/10 bg-[#0f1823] px-4 py-3 text-sm text-ctrlx-text outline-none transition focus:border-amber-300/40"
                                  />
                                </label>

                                <label className="block">
                                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                                    Stack Suggestion
                                  </span>
                                  <input
                                    value={layoutItem.suggestedStackLabel ?? ""}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                      onUpdateImportPlanSuggestion(index, {
                                        suggestedStackLabel: event.target.value
                                      })
                                    }
                                    placeholder="Optional stack label"
                                    className="w-full rounded-[18px] border border-white/10 bg-[#0f1823] px-4 py-3 text-sm text-ctrlx-text outline-none transition placeholder:text-ctrlx-muted/60 focus:border-amber-300/40"
                                  />
                                </label>

                                <label className="block">
                                  <span className="mb-2 block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                                    Routing / Bus
                                  </span>
                                  <input
                                    value={layoutItem.suggestedBusLabel ?? ""}
                                    onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                      onUpdateImportPlanSuggestion(index, {
                                        suggestedBusLabel: event.target.value
                                      })
                                    }
                                    placeholder="Optional bus label"
                                    className="w-full rounded-[18px] border border-white/10 bg-[#0f1823] px-4 py-3 text-sm text-ctrlx-text outline-none transition placeholder:text-ctrlx-muted/60 focus:border-amber-300/40"
                                  />
                                </label>
                              </div>

                              <div className="mt-3 grid gap-2 text-xs text-ctrlx-muted sm:grid-cols-2">
                                <p>Suggested order: {layoutItem.suggestedOrder}</p>
                                <p>Suggested group: {layoutItem.suggestedGroupLabel}</p>
                                <p>Suggested stack: {layoutItem.suggestedStackLabel ?? "none"}</p>
                                <p>Suggested bus: {layoutItem.suggestedBusLabel ?? "none"}</p>
                              </div>

                              <p className="mt-3 text-xs leading-5 text-ctrlx-muted">
                                These values shape review and future session-prep planning only. They are not executed in Logic yet.
                              </p>
                            </div>
                          );
                        })()
                      ) : null}

                      <div className="rounded-[16px] border border-white/10 bg-black/10 p-3">
                        <div className="flex flex-wrap gap-2">
                          {IMPORT_AUTOMATION_EXECUTABLE_ACTIONS.map((action) => (
                            <span key={`${item.originalFilename}-${action}`} className={executableActionBadgeClassName}>
                              Live: {IMPORT_AUTOMATION_EXECUTABLE_ACTION_LABELS[action]}
                            </span>
                          ))}
                          {IMPORT_AUTOMATION_SUGGESTION_ACTIONS.map((action) => (
                            <span
                              key={`${item.originalFilename}-${action}`}
                              className={suggestionActionBadgeClassName}
                            >
                              Suggestion: {IMPORT_AUTOMATION_SUGGESTION_ACTION_LABELS[action]}
                            </span>
                          ))}
                        </div>
                        <p className="mt-2 text-xs leading-5 text-ctrlx-muted">
                          Confirming this plan will run only the live actions above. Suggestion-only actions remain visible for review and later phases.
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={onCancelImportPlan}
                  className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-ctrlx-text transition hover:border-white/20 hover:bg-white/[0.05]"
                >
                  Cancel Review
                </button>
                <button
                  type="button"
                  onClick={onConfirmImportPlan}
                  disabled={isImportPlanExecuting}
                  className="rounded-[18px] border border-ctrlx-accent/30 bg-[linear-gradient(180deg,rgba(153,247,255,0.14),rgba(153,247,255,0.07))] px-4 py-3 text-sm font-semibold text-ctrlx-edge transition hover:border-ctrlx-accent/55 hover:bg-white/[0.05]"
                >
                  {isImportPlanExecuting ? "Applying Plan..." : "Confirm Plan"}
                </button>
              </div>

              {latestImportProgress ? (
                <div className="rounded-[22px] border border-white/10 bg-[#0f1823] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ctrlx-text">Import Progress</p>
                      <p className="mt-1 text-xs text-ctrlx-muted">{latestImportProgress.message}</p>
                    </div>
                    <span
                      className={[
                        "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-ctrlx",
                        latestImportProgress.status === "succeeded"
                          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                          : latestImportProgress.status === "failed"
                            ? "border-amber-400/20 bg-amber-400/10 text-amber-100"
                            : "border-white/10 bg-white/[0.04] text-ctrlx-muted"
                      ].join(" ")}
                    >
                      {latestImportProgress.status}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-2 text-xs text-ctrlx-muted sm:grid-cols-2">
                    <p>Phase: {latestImportProgress.phase}</p>
                    <p>Total items: {latestImportProgress.totalItems ?? "n/a"}</p>
                    <p>Processed: {latestImportProgress.processedItems ?? 0}</p>
                    <p>Current file: {latestImportProgress.originalFilename ?? "n/a"}</p>
                  </div>

                  <div className="mt-4 rounded-[16px] border border-white/10 bg-black/10 p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                      Staged Flow
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                      {progressStageSummary.map((stage) => (
                        <div
                          key={`stage-${stage.phase}`}
                          className="rounded-[14px] border border-white/10 bg-white/[0.03] px-3 py-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-ctrlx-text">{stage.label}</p>
                            <span
                              className={[
                                "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-ctrlx",
                                stage.status === "succeeded"
                                  ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                                  : stage.status === "failed"
                                    ? "border-amber-400/20 bg-amber-400/10 text-amber-100"
                                    : stage.status === "running"
                                      ? "border-sky-400/20 bg-sky-400/10 text-sky-200"
                                      : stage.status === "skipped"
                                        ? "border-white/10 bg-white/[0.04] text-ctrlx-muted"
                                        : "border-white/10 bg-white/[0.04] text-ctrlx-muted"
                              ].join(" ")}
                            >
                              {stage.status}
                            </span>
                          </div>
                          {stage.message ? <p className="mt-2 text-[11px] leading-5 text-ctrlx-muted">{stage.message}</p> : null}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 max-h-[180px] space-y-2 overflow-y-auto pr-1 text-xs text-ctrlx-muted">
                    {importExecutionProgressUpdates.map((update, index) => (
                      <div
                        key={`${update.phase}-${update.itemIndex ?? "none"}-${update.action ?? "none"}-${index}`}
                        className="rounded-[14px] border border-white/10 bg-black/10 px-3 py-2"
                      >
                        <p className="font-medium text-ctrlx-text">{update.message}</p>
                        <p className="mt-1">
                          {update.action ? `Action: ${update.action}` : `Phase: ${update.phase}`}
                          {update.originalFilename ? ` · ${update.originalFilename}` : ""}
                        </p>
                        {update.reason ? <p className="mt-1 text-amber-100">{update.reason}</p> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {importExecutionReport ? (
                <div className="rounded-[22px] border border-white/10 bg-[#0f1823] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ctrlx-text">Execution Summary</p>
                      <p className="mt-1 text-xs text-ctrlx-muted">{importExecutionReport.summary}</p>
                    </div>
                    <span
                      className={[
                        "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-ctrlx",
                        importExecutionReport.failedActions === 0
                          ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                          : "border-amber-400/20 bg-amber-400/10 text-amber-100"
                      ].join(" ")}
                    >
                      {importExecutionReport.failedActions === 0 ? "success" : "partial"}
                    </span>
                  </div>

                  <div className="mt-4 grid gap-2 text-xs text-ctrlx-muted sm:grid-cols-2">
                    <p>Items processed: {importExecutionReport.totalItems}</p>
                    <p>Imports succeeded: {importExecutionReport.importsSucceeded}</p>
                    <p>Renames succeeded: {importExecutionReport.renamesSucceeded}</p>
                    <p>Color changes succeeded: {importExecutionReport.colorChangesSucceeded}</p>
                    <p>Failures: {importExecutionReport.failures.length}</p>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-[16px] border border-emerald-400/15 bg-emerald-400/[0.06] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-emerald-200">Live Import</p>
                      <p className="mt-2 text-lg font-semibold text-ctrlx-text">{importExecutionReport.importsSucceeded}</p>
                      <p className="mt-1 text-xs text-ctrlx-muted">Tracks imported into the current Logic project.</p>
                    </div>
                    <div className="rounded-[16px] border border-emerald-400/15 bg-emerald-400/[0.06] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-emerald-200">Live Rename</p>
                      <p className="mt-2 text-lg font-semibold text-ctrlx-text">{importExecutionReport.renamesSucceeded}</p>
                      <p className="mt-1 text-xs text-ctrlx-muted">Reviewed track names applied after import.</p>
                    </div>
                    <div className="rounded-[16px] border border-emerald-400/15 bg-emerald-400/[0.06] p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-emerald-200">Live Color</p>
                      <p className="mt-2 text-lg font-semibold text-ctrlx-text">{importExecutionReport.colorChangesSucceeded}</p>
                      <p className="mt-1 text-xs text-ctrlx-muted">Reviewed track colors applied after rename.</p>
                    </div>
                  </div>

                  <div className="mt-4 max-h-[260px] space-y-3 overflow-y-auto pr-1">
                    {importExecutionReport.items.map((item, index) => (
                      <div key={`${item.originalFilename}-result-${index}`} className="rounded-[18px] border border-white/10 bg-white/[0.03] p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-ctrlx-text">{item.originalFilename}</p>
                            <p className="mt-1 text-xs text-ctrlx-muted">{item.summary}</p>
                          </div>
                          <span
                            className={[
                              "shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-ctrlx",
                              item.ok
                                ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"
                                : "border-amber-400/20 bg-amber-400/10 text-amber-100"
                            ].join(" ")}
                          >
                            {item.ok ? "ok" : "issue"}
                          </span>
                        </div>

                        <div className="mt-3 space-y-2 text-xs text-ctrlx-muted">
                          {item.actions.map((action) => (
                            <div key={`${item.originalFilename}-${action.type}`} className="rounded-[14px] border border-white/10 bg-black/10 px-3 py-2">
                              <p className="font-medium text-ctrlx-text">
                                {(importActionLabels[action.type] ?? action.type)} {action.ok ? "succeeded" : "failed"}
                              </p>
                              <p className="mt-1">
                                Intended:
                                {action.type === "create_audio_track"
                                  ? ` imported into Logic`
                                  : action.type === "rename_track"
                                  ? ` ${action.intendedName ?? "n/a"}`
                                  : ` ${action.intendedColor ?? "n/a"}`}
                              </p>
                              <p>
                                Actual:
                                {action.type === "create_audio_track"
                                  ? ` ${action.ok ? "imported" : "not imported"}`
                                  : action.type === "rename_track"
                                  ? ` ${action.actualName ?? "unchanged"}`
                                  : ` ${action.actualColor ?? "unchanged"}`}
                              </p>
                              {action.reason ? <p className="mt-1 text-amber-100">{action.reason}</p> : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm leading-6 text-ctrlx-muted">
              No import plan loaded yet. Use the mock plan button to review sample detected tracks, names, colors, and confidence.
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 rounded-[26px] border border-white/10 bg-white/[0.03] p-4">
        <label className="block">
          <span className="mb-2 block text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
            Assistant Input
          </span>
          <textarea
            value={prompt}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onPromptChange(event.target.value)}
            rows={4}
            className="w-full resize-none rounded-[20px] border border-white/10 bg-ctrlx-panelAlt px-4 py-3 text-sm text-ctrlx-text outline-none transition placeholder:text-ctrlx-muted/60 focus:border-ctrlx-accent/50 focus:bg-[#101926]"
            placeholder="Describe a command sequence..."
          />
        </label>

        <button
          onClick={onSend}
          className="mt-3 w-full rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.03))] px-4 py-3.5 text-sm font-semibold text-ctrlx-text shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-white/20 hover:bg-white/[0.06]"
        >
          Send
        </button>
      </div>
    </aside>
  );
}
