export type ImportAutomationCategory =
  | "drums"
  | "vocals"
  | "bass"
  | "guitar"
  | "keys"
  | "fx"
  | "percussion"
  | "synth"
  | "ambience"
  | "unknown";

export type ImportAutomationConfidence = "high" | "medium" | "low";

export type ImportAutomationColor =
  | "red"
  | "orange"
  | "green"
  | "blue"
  | "yellow"
  | "cyan"
  | "purple"
  | "pink"
  | "gray"
  | "neutral";

export const IMPORT_AUTOMATION_CATEGORIES: readonly ImportAutomationCategory[] = [
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

export const IMPORT_AUTOMATION_COLORS: readonly ImportAutomationColor[] = [
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

export type ImportAutomationItem = {
  originalFilename: string;
  normalizedFilename: string;
  detectedCategory: ImportAutomationCategory;
  cleanTrackName: string;
  assignedColor: ImportAutomationColor;
  confidence: ImportAutomationConfidence;
};

export type ImportDiscoverySourceType = "zip_extracted" | "direct_file";

export type ImportDiscoveredAudioFile = {
  filename: string;
  path: string;
  extension: string;
  size: number;
  sourceType: ImportDiscoverySourceType;
  relativePath: string | null;
  sourceSelectionPath: string | null;
  sourceArchiveName: string | null;
};

export type ImportAutomationPlannedExecutableItem = {
  itemIndex: number;
  item: ImportAutomationItem;
  target: ImportAutomationTrackTarget;
  actions: ImportAutomationExecutableActionRequest[];
};

export type ImportAutomationPlan = {
  source: "import_automation";
  items: ImportAutomationItem[];
  executableItems: ImportAutomationPlannedExecutableItem[];
  suggestionActions: ImportAutomationSuggestionActionRequest[];
};

export type ImportAutomationClassificationResult = {
  category: ImportAutomationCategory;
  confidence: ImportAutomationConfidence;
};

export type ImportAutomationGroupSuggestion = {
  category: ImportAutomationCategory;
  groupLabel: string;
  order: number;
  busLabel: string | null;
  stackLabel: string | null;
  items: ImportAutomationItem[];
};

export type ImportAutomationLayoutSuggestion = {
  source: "import_automation_layout";
  organizationMode: "category_based_deterministic";
  categoryPriorityOrder: ImportAutomationCategory[];
  orderingExecution: "suggestion_only";
  stackingExecution: "suggestion_only";
  orderedItems: Array<
    ImportAutomationItem & {
      suggestedOrder: number;
      suggestedGroupLabel: string;
      suggestedBusLabel: string | null;
      suggestedStackLabel: string | null;
    }
  >;
  groups: ImportAutomationGroupSuggestion[];
  notes: string[];
};

export type ImportAutomationTrackTarget =
  | {
      kind: "selected";
      expectedCurrentName?: string | null;
    }
  | {
      kind: "index";
      trackIndex: number;
      expectedCurrentName?: string | null;
    }
  | {
      kind: "name";
      trackName: string;
      expectedCurrentName?: string | null;
    }
  | {
      kind: "batch_slot";
      batchIndex: number;
      expectedCurrentName?: string | null;
    };

export type ImportAutomationExecutableAction = "create_audio_track" | "rename_track" | "set_track_color";
export type ImportAutomationSuggestionAction = "ordering_suggestion" | "grouping_suggestion" | "routing_suggestion";

export const IMPORT_AUTOMATION_EXECUTABLE_ACTIONS: readonly ImportAutomationExecutableAction[] = [
  "create_audio_track",
  "rename_track",
  "set_track_color"
] as const;

export const IMPORT_AUTOMATION_SUGGESTION_ACTIONS: readonly ImportAutomationSuggestionAction[] = [
  "ordering_suggestion",
  "grouping_suggestion",
  "routing_suggestion"
] as const;

export const IMPORT_AUTOMATION_EXECUTABLE_ACTION_LABELS: Record<ImportAutomationExecutableAction, string> = {
  create_audio_track: "Create Audio Track",
  rename_track: "Rename Track",
  set_track_color: "Set Track Color"
};

export const IMPORT_AUTOMATION_SUGGESTION_ACTION_LABELS: Record<ImportAutomationSuggestionAction, string> = {
  ordering_suggestion: "Ordering Suggestion",
  grouping_suggestion: "Grouping Suggestion",
  routing_suggestion: "Routing Suggestion"
};

export type ImportAutomationCreateAudioTrackActionRequest = {
  kind: "executable";
  type: "create_audio_track";
  count?: number;
  previousName?: null;
  intendedName?: null;
  intendedColor?: null;
};

export type ImportAutomationRenameTrackActionRequest = {
  kind: "executable";
  type: "rename_track";
  target: ImportAutomationTrackTarget;
  previousName?: string | null;
  intendedName?: string | null;
  intendedColor?: ImportAutomationColor | null;
};

export type ImportAutomationSetTrackColorActionRequest = {
  kind: "executable";
  type: "set_track_color";
  target: ImportAutomationTrackTarget;
  previousName?: string | null;
  intendedName?: string | null;
  intendedColor?: ImportAutomationColor | null;
};

export type ImportAutomationExecutableActionRequest =
  | ImportAutomationCreateAudioTrackActionRequest
  | ImportAutomationRenameTrackActionRequest
  | ImportAutomationSetTrackColorActionRequest;

export type ImportAutomationSuggestionActionRequest = {
  kind: "suggestion_only";
  type: ImportAutomationSuggestionAction;
  itemIndex?: number | null;
  originalFilename?: string | null;
  label: string;
  detail: string;
};

export type ImportAutomationPlannedActionRequest =
  | ImportAutomationExecutableActionRequest
  | ImportAutomationSuggestionActionRequest;

export type ImportAutomationPreparedPlan = {
  source: "import_automation_prepared";
  plan: ImportAutomationPlan;
  executableItems: ImportAutomationPlannedExecutableItem[];
  suggestionActions: ImportAutomationSuggestionActionRequest[];
};

export type ImportAutomationExecutionActionStatus = "succeeded" | "failed";

export type ImportAutomationExecutionActionResult = {
  type: ImportAutomationExecutableAction;
  ok: boolean;
  status: ImportAutomationExecutionActionStatus;
  previousName: string | null;
  intendedName: string | null;
  intendedColor: ImportAutomationColor | null;
  actualName: string | null;
  actualColor: ImportAutomationColor | null;
  message: string | null;
  reason: string | null;
};

export type ImportAutomationExecutionItemResult = {
  originalFilename: string;
  cleanTrackName: string;
  assignedColor: ImportAutomationColor;
  actions: ImportAutomationExecutionActionResult[];
  createAudioTrack: ImportAutomationExecutionActionResult | null;
  importedAudio: ImportAutomationExecutionActionResult | null;
  renameTrack: ImportAutomationExecutionActionResult | null;
  setTrackColor: ImportAutomationExecutionActionResult | null;
  ok: boolean;
  completedActions: number;
  failedActions: number;
  summary: string;
};

export type ImportAutomationExecutionReport = {
  source: "import_automation_execution";
  totalItems: number;
  executableItemsPlanned: number;
  successfulItems: number;
  failedItems: number;
  totalActions: number;
  successfulActions: number;
  failedActions: number;
  suggestionOnlyActionsPlanned: number;
  suggestionOnlyActionsSkipped: number;
  audioTracksCreated: number;
  audioTrackCreationFailures: number;
  importsSucceeded: number;
  importsFailed: number;
  renamesSucceeded: number;
  renamesFailed: number;
  colorChangesSucceeded: number;
  colorChangesFailed: number;
  items: ImportAutomationExecutionItemResult[];
  failures: Array<{
    itemIndex: number;
    originalFilename: string;
    action: ImportAutomationExecutableAction;
    reason: string;
  }>;
  summary: string;
};

export type ImportAutomationExecutionRunnerResult = {
  ok: boolean;
  reason?: string | null;
  message?: string | null;
  actualName?: string | null;
  actualColor?: ImportAutomationColor | null;
};

export type ImportExecutionProgressStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "cancelled";

export type ImportExecutionProgressAction = "imported" | "renamed" | "colored" | "ordered" | "stacked";

export type ImportExecutionProgressPhase =
  | "files_selected"
  | "files_discovered"
  | "plan_generated"
  | "review_confirmed"
  | "import_started"
  | "importing"
  | "track_targeting"
  | "renaming"
  | "coloring"
  | "ordering"
  | "item_started"
  | "item_progress"
  | "completed"
  | "failed"
  | "cancelled";

export type ImportExecutionProgressUpdate = {
  kind: "import_execution";
  phase: ImportExecutionProgressPhase;
  status: ImportExecutionProgressStatus;
  message: string;
  operationId?: string | null;
  heartbeatAt?: string | null;
  keepAlive?: boolean;
  totalItems?: number;
  processedItems?: number;
  itemIndex?: number | null;
  originalFilename?: string | null;
  action?: ImportExecutionProgressAction | null;
  reason?: string | null;
};

export type ImportAutomationInputNormalizer = {
  normalizeFilename: (fileName: string) => string;
};

export type ImportAutomationClassifier = {
  classify: (normalizedFilename: string) => ImportAutomationClassificationResult;
};

export type ImportAutomationTrackNamer = {
  createTrackName: (fileName: string, normalizedFilename?: string) => string;
};

export type ImportAutomationColorAssigner = {
  assignColor: (category: ImportAutomationCategory) => ImportAutomationColor;
};

export type ImportAutomationLayoutPlanner = {
  buildLayoutSuggestion: (plan: ImportAutomationPlan) => ImportAutomationLayoutSuggestion;
};

export type ImportAutomationAnalysisService = {
  normalizer: ImportAutomationInputNormalizer;
  classifier: ImportAutomationClassifier;
  trackNamer: ImportAutomationTrackNamer;
  colorAssigner: ImportAutomationColorAssigner;
  layoutPlanner: ImportAutomationLayoutPlanner;
  analyzeFile: (fileName: string) => ImportAutomationItem;
  buildPlan: (fileNames: string[]) => ImportAutomationPlan;
  buildPlanFromItems: (items: ImportAutomationItem[]) => ImportAutomationPlan;
};

type CategoryRule = {
  category: ImportAutomationCategory;
  keywords: string[];
  confidence: ImportAutomationConfidence;
  priority: number;
};

export const IMPORT_AUTOMATION_COLOR_MAP: Record<ImportAutomationCategory, ImportAutomationColor> = {
  drums: "red",
  percussion: "orange",
  bass: "green",
  vocals: "blue",
  guitar: "yellow",
  keys: "cyan",
  synth: "purple",
  fx: "pink",
  ambience: "gray",
  unknown: "neutral"
};

const IMPORT_AUTOMATION_LAYOUT_ORDER: Record<ImportAutomationCategory, number> = {
  drums: 10,
  percussion: 20,
  bass: 30,
  guitar: 40,
  keys: 50,
  synth: 60,
  vocals: 70,
  fx: 80,
  ambience: 90,
  unknown: 100
};

export const IMPORT_AUTOMATION_CATEGORY_PRIORITY_ORDER: readonly ImportAutomationCategory[] = [
  "drums",
  "percussion",
  "bass",
  "guitar",
  "keys",
  "synth",
  "vocals",
  "fx",
  "ambience",
  "unknown"
] as const;

const IMPORT_AUTOMATION_GROUP_LABELS: Record<ImportAutomationCategory, string> = {
  drums: "Drums",
  percussion: "Percussion",
  bass: "Bass",
  guitar: "Guitars",
  keys: "Keys",
  synth: "Synths",
  vocals: "Vocals",
  fx: "FX",
  ambience: "Ambience",
  unknown: "Unsorted"
};

const IMPORT_AUTOMATION_BUS_LABELS: Record<ImportAutomationCategory, string | null> = {
  drums: "Drum Bus",
  percussion: "Percussion Bus",
  bass: "Bass Bus",
  guitar: "Guitar Bus",
  keys: "Keys Bus",
  synth: "Synth Bus",
  vocals: "Vocal Bus",
  fx: "FX Bus",
  ambience: "Ambience Bus",
  unknown: null
};

const IMPORT_AUTOMATION_STACK_LABELS: Record<ImportAutomationCategory, string | null> = {
  drums: "Drum Stack",
  percussion: "Percussion Stack",
  bass: null,
  guitar: "Guitar Stack",
  keys: "Keys Stack",
  synth: "Synth Stack",
  vocals: "Vocal Stack",
  fx: "FX Stack",
  ambience: "Ambience Stack",
  unknown: null
};

const IMPORT_AUTOMATION_CATEGORY_RULES: readonly CategoryRule[] = [
  {
    category: "vocals",
    confidence: "high",
    priority: 90,
    keywords: [
      "lead vox",
      "lead vocal",
      "backing vox",
      "backing vocal",
      "bgv",
      "vocal",
      "vox",
      "harmony",
      "adlib",
      "ad lib"
    ]
  },
  {
    category: "bass",
    confidence: "high",
    priority: 85,
    keywords: ["bass di", "bass amp", "808 bass", "sub bass", "sub", "bass"]
  },
  {
    category: "guitar",
    confidence: "high",
    priority: 75,
    keywords: ["rhythm guitar", "lead guitar", "electric guitar", "acoustic guitar", "guit", "gtr", "guitar"]
  },
  {
    category: "keys",
    confidence: "high",
    priority: 70,
    keywords: ["rhodes", "electric piano", "piano", "keys", "organ", "wurli", "clav"]
  },
  {
    category: "synth",
    confidence: "high",
    priority: 80,
    keywords: ["synth", "pad", "arp", "pluck", "lead synth", "poly synth"]
  },
  {
    category: "fx",
    confidence: "high",
    priority: 60,
    keywords: ["downlifter", "uplifter", "riser", "impact", "whoosh", "transition", "sfx", "fx"]
  },
  {
    category: "ambience",
    confidence: "high",
    priority: 55,
    keywords: ["ambience", "amb", "atm", "atmos", "room tone", "crowd", "room"]
  },
  {
    category: "percussion",
    confidence: "high",
    priority: 65,
    keywords: ["tamb", "tambourine", "conga", "bongo", "perc", "percussion", "shaker"]
  },
  {
    category: "drums",
    confidence: "high",
    priority: 100,
    keywords: ["snare", "clap", "rim", "kick", "bd", "cymbal", "ride", "crash", "hihat", "hi hat", "hh", "tom", "drum"]
  }
] as const;

const TRACK_NAME_NOISE_TOKENS = new Set([
  "wav",
  "wave",
  "aif",
  "aiff",
  "mp3",
  "stereo",
  "mono",
  "final",
  "new",
  "edit",
  "mix",
  "print"
]);

const STRONGLY_AMBIGUOUS_FILENAMES = new Set(["audio", "track", "stem", "print"]);
const USEFUL_TRACK_NAME_SUFFIXES = new Set(["di", "l", "r", "top", "bottom", "room"]);

export const IMPORT_AUTOMATION_SAMPLE_FILENAMES = [
  "01_KICK_IN.wav",
  "snare_top_take03.wav",
  "Lead_Vox_Final_02.wav",
  "BASS_DI_v4.aif",
  "rhythm_gtr_L_01.wav",
  "Rhodes_Main.wav",
  "synth_pad_wide_02.wav",
  "big_riser_fx_07.wav",
  "room_ambience_stereo.wav",
  "mystery_audio_12.wav",
  "audio_01.wav",
  "track final.wav",
  "stem 3.wav",
  "print.wav",
  "lead_vox_fx.wav",
  "bass_synth.wav",
  "snare_room.wav"
] as const;

export const IMPORT_AUTOMATION_SAMPLE_PREVIOUS_NAMES: Record<string, string> = {
  "01_KICK_IN.wav": "Audio 1",
  "snare_top_take03.wav": "Audio 2",
  "Lead_Vox_Final_02.wav": "Audio 3",
  "BASS_DI_v4.aif": "Audio 4"
};

export type ImportAutomationRuleConfig = {
  categoryRules: readonly CategoryRule[];
  colorMap: Record<ImportAutomationCategory, ImportAutomationColor>;
  layoutOrder: Record<ImportAutomationCategory, number>;
  groupLabels: Record<ImportAutomationCategory, string>;
  busLabels: Record<ImportAutomationCategory, string | null>;
  stackLabels: Record<ImportAutomationCategory, string | null>;
  stronglyAmbiguousFilenames: ReadonlySet<string>;
  trackNameNoiseTokens: ReadonlySet<string>;
  usefulTrackNameSuffixes: ReadonlySet<string>;
};

export const DEFAULT_IMPORT_AUTOMATION_RULE_CONFIG: ImportAutomationRuleConfig = {
  categoryRules: IMPORT_AUTOMATION_CATEGORY_RULES,
  colorMap: IMPORT_AUTOMATION_COLOR_MAP,
  layoutOrder: IMPORT_AUTOMATION_LAYOUT_ORDER,
  groupLabels: IMPORT_AUTOMATION_GROUP_LABELS,
  busLabels: IMPORT_AUTOMATION_BUS_LABELS,
  stackLabels: IMPORT_AUTOMATION_STACK_LABELS,
  stronglyAmbiguousFilenames: STRONGLY_AMBIGUOUS_FILENAMES,
  trackNameNoiseTokens: TRACK_NAME_NOISE_TOKENS,
  usefulTrackNameSuffixes: USEFUL_TRACK_NAME_SUFFIXES
};

function removeFileExtension(fileName: string): string {
  return fileName.replace(/\.[a-z0-9]+$/i, "");
}

function titleCaseWord(word: string): string {
  if (!word) {
    return word;
  }

  if (word === "di") {
    return "DI";
  }

  if (word === "fx") {
    return "FX";
  }

  if (word === "bgv") {
    return "BGV";
  }

  if (word === "vox") {
    return "Vox";
  }

  if (word.length === 1 && /[lr]/.test(word)) {
    return word.toUpperCase();
  }

  return word.charAt(0).toUpperCase() + word.slice(1);
}

function titleCaseWords(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map(titleCaseWord)
    .join(" ");
}

function normalizeImportedAudioFileNameInternal(fileName: string): string {
  return removeFileExtension(fileName)
    .toLowerCase()
    .replace(/[._-]+/g, " ")
    .replace(/[()[\]{}]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreCategoryMatch(
  normalizedFilename: string,
  config: ImportAutomationRuleConfig
): ImportAutomationClassificationResult {
  const rawTokens = normalizedFilename.split(" ").filter(Boolean);
  const tokens = rawTokens.filter((token) => !/^\d+$/.test(token));
  const strippedForAmbiguity = tokens
    .filter((token) => !config.trackNameNoiseTokens.has(token))
    .join(" ")
    .trim();

  if (!strippedForAmbiguity || config.stronglyAmbiguousFilenames.has(strippedForAmbiguity)) {
    return {
      category: "unknown",
      confidence: "low"
    };
  }

  let bestMatch: {
    category: ImportAutomationCategory;
    confidence: ImportAutomationConfidence;
    keywordLength: number;
    priority: number;
    tokenCount: number;
  } | null = null;

  for (const rule of config.categoryRules) {
    for (const keyword of rule.keywords) {
      if (!normalizedFilename.includes(keyword)) {
        continue;
      }

      const keywordTokenCount = keyword.split(" ").filter(Boolean).length;
      const candidate = {
        category: rule.category,
        confidence: rule.confidence,
        keywordLength: keyword.length,
        priority: rule.priority,
        tokenCount: keywordTokenCount
      };

      if (
        !bestMatch ||
        candidate.tokenCount > bestMatch.tokenCount ||
        (candidate.tokenCount === bestMatch.tokenCount && candidate.keywordLength > bestMatch.keywordLength) ||
        (candidate.tokenCount === bestMatch.tokenCount &&
          candidate.keywordLength === bestMatch.keywordLength &&
          candidate.priority > bestMatch.priority)
      ) {
        bestMatch = candidate;
      }
    }
  }

  if (bestMatch) {
    const otherCategoryMatches = config.categoryRules.filter(
      (rule) =>
        rule.category !== bestMatch?.category && rule.keywords.some((keyword) => normalizedFilename.includes(keyword))
    );

    return {
      category: bestMatch.category,
      confidence: otherCategoryMatches.length > 0 ? "medium" : bestMatch.confidence
    };
  }

  if (normalizedFilename.length > 0) {
    return {
      category: "unknown",
      confidence: "low"
    };
  }

  return {
    category: "unknown",
    confidence: "low"
  };
}

function stripTrackNameNoise(
  normalizedFilename: string,
  config: ImportAutomationRuleConfig
): string {
  return normalizedFilename
    .split(" ")
    .filter((token) => {
      if (!token) {
        return false;
      }

      if (config.trackNameNoiseTokens.has(token)) {
        return false;
      }

      if (config.usefulTrackNameSuffixes.has(token)) {
        return true;
      }

      if (/^\d+$/.test(token)) {
        return false;
      }

      if (/^(take|tk|ver|version|v)\d*$/i.test(token)) {
        return false;
      }

      return true;
    })
    .join(" ")
    .trim();
}

function createReadableTrackNameInternal(
  fileName: string,
  config: ImportAutomationRuleConfig,
  normalizedFilename = normalizeImportedAudioFileNameInternal(fileName)
): string {
  const stripped = stripTrackNameNoise(normalizedFilename, config);

  if (!stripped) {
    return "Imported Audio";
  }

  return titleCaseWords(stripped);
}

function buildImportAutomationLayoutSuggestionInternal(
  plan: ImportAutomationPlan,
  config: ImportAutomationRuleConfig
): ImportAutomationLayoutSuggestion {
  const groupedItems = new Map<ImportAutomationCategory, ImportAutomationItem[]>();

  for (const item of plan.items) {
    const current = groupedItems.get(item.detectedCategory) ?? [];
    current.push(item);
    groupedItems.set(item.detectedCategory, current);
  }

  const groups = Array.from(groupedItems.entries())
    .sort((left, right) => {
      return config.layoutOrder[left[0]] - config.layoutOrder[right[0]];
    })
    .map(([category, items]) => ({
      category,
      groupLabel: config.groupLabels[category],
      order: config.layoutOrder[category],
      busLabel: config.busLabels[category],
      stackLabel: config.stackLabels[category],
      items: [...items].sort((left, right) => left.cleanTrackName.localeCompare(right.cleanTrackName))
    }));

  let suggestedOrder = 1;
  const orderedItems = groups.flatMap((group) =>
    group.items.map((item) => ({
      ...item,
      suggestedOrder: suggestedOrder++,
      suggestedGroupLabel: group.groupLabel,
      suggestedBusLabel: group.busLabel,
      suggestedStackLabel: group.stackLabel
    }))
  );

  const presentCategories = groups.map((group) => group.category);
  const priorityNotes = presentCategories.map((category, index) => {
    const previousCategory = presentCategories[index - 1] ?? null;
    const nextCategory = presentCategories[index + 1] ?? null;
    const currentLabel = config.groupLabels[category];

    if (category === "drums") {
      return `${currentLabel} are placed first as the primary rhythmic anchor.`;
    }

    if (category === "percussion" && previousCategory === "drums") {
      return `${currentLabel} follow drums to keep the rhythm section together.`;
    }

    if (category === "bass") {
      return `${currentLabel} are placed near drums and percussion for a tighter low-end section.`;
    }

    if (category === "guitar" || category === "keys" || category === "synth") {
      return `${currentLabel} sit through the middle of the session with adjacent instrument groups.`;
    }

    if (category === "vocals") {
      return `${currentLabel} are grouped after instruments for a cleaner top-level session layout.`;
    }

    if (category === "fx" || category === "ambience") {
      return `${currentLabel} are placed later in the session so supporting elements stay out of the main instrument block.`;
    }

    if (nextCategory) {
      return `${currentLabel} are ordered before ${config.groupLabels[nextCategory]} based on deterministic category priority.`;
    }

    return `${currentLabel} remain in the final section of the deterministic category order.`;
  });

  return {
    source: "import_automation_layout",
    organizationMode: "category_based_deterministic",
    categoryPriorityOrder: [...IMPORT_AUTOMATION_CATEGORY_PRIORITY_ORDER],
    orderingExecution: "suggestion_only",
    stackingExecution: "suggestion_only",
    orderedItems,
    groups,
    notes: [
      "Track organization is based on deterministic filename/category classification, not frequency analysis.",
      "Drums are suggested first, followed by percussion and bass.",
      "Guitars, keys, and synths are grouped through the middle of the session.",
      "Vocals are grouped after instruments for a cleaner working layout.",
      "FX and ambience are suggested later in the session.",
      "Ordering, grouping, bus labels, and stack labels are suggestion-only in this phase.",
      ...priorityNotes
    ]
  };
}

export function createRuleBasedImportAutomationService(
  config: ImportAutomationRuleConfig = DEFAULT_IMPORT_AUTOMATION_RULE_CONFIG
): ImportAutomationAnalysisService {
  const normalizer: ImportAutomationInputNormalizer = {
    normalizeFilename: (fileName) => normalizeImportedAudioFileNameInternal(fileName)
  };

  const classifier: ImportAutomationClassifier = {
    classify: (normalizedFilename) => scoreCategoryMatch(normalizedFilename, config)
  };

  const trackNamer: ImportAutomationTrackNamer = {
    createTrackName: (fileName, normalizedFilename) =>
      createReadableTrackNameInternal(fileName, config, normalizedFilename)
  };

  const colorAssigner: ImportAutomationColorAssigner = {
    assignColor: (category) => config.colorMap[category]
  };

  const layoutPlanner: ImportAutomationLayoutPlanner = {
    buildLayoutSuggestion: (plan) => buildImportAutomationLayoutSuggestionInternal(plan, config)
  };

  const analyzeFile = (fileName: string): ImportAutomationItem => {
    const normalizedFilename = normalizer.normalizeFilename(fileName);
    const classification = classifier.classify(normalizedFilename);

    return {
      originalFilename: fileName,
      normalizedFilename,
      detectedCategory: classification.category,
      cleanTrackName: trackNamer.createTrackName(fileName, normalizedFilename),
      assignedColor: colorAssigner.assignColor(classification.category),
      confidence: classification.confidence
    };
  };

  const buildPlanFromItems = (items: ImportAutomationItem[]): ImportAutomationPlan =>
    buildImportAutomationPlanFromItems(items);

  const buildPlan = (fileNames: string[]): ImportAutomationPlan => buildPlanFromItems(fileNames.map(analyzeFile));

  return {
    normalizer,
    classifier,
    trackNamer,
    colorAssigner,
    layoutPlanner,
    analyzeFile,
    buildPlan,
    buildPlanFromItems
  };
}

export const defaultImportAutomationService = createRuleBasedImportAutomationService();

export function createSelectedImportAutomationTrackTarget(
  expectedCurrentName?: string | null
): ImportAutomationTrackTarget {
  return {
    kind: "selected",
    expectedCurrentName
  };
}

export function normalizeImportedAudioFileName(fileName: string): string {
  return defaultImportAutomationService.normalizer.normalizeFilename(fileName);
}

export function classifyImportedAudioFile(normalizedFilename: string): ImportAutomationClassificationResult {
  return defaultImportAutomationService.classifier.classify(normalizedFilename);
}

export function createReadableTrackName(fileName: string): string {
  return defaultImportAutomationService.trackNamer.createTrackName(fileName);
}

export function getImportAutomationColor(category: ImportAutomationCategory): ImportAutomationColor {
  return defaultImportAutomationService.colorAssigner.assignColor(category);
}

export function analyzeImportedAudioFile(fileName: string): ImportAutomationItem {
  return defaultImportAutomationService.analyzeFile(fileName);
}

export function buildImportAutomationPlan(fileNames: string[]): ImportAutomationPlan {
  return defaultImportAutomationService.buildPlan(fileNames);
}

export function buildImportAutomationPlanFromReviewedItems(items: ImportAutomationItem[]): ImportAutomationPlan {
  return defaultImportAutomationService.buildPlanFromItems(items);
}

export function getImportAutomationSamplePlan(): ImportAutomationPlan {
  return defaultImportAutomationService.buildPlan([...IMPORT_AUTOMATION_SAMPLE_FILENAMES]);
}

export function buildImportAutomationLayoutSuggestion(plan: ImportAutomationPlan): ImportAutomationLayoutSuggestion {
  return defaultImportAutomationService.layoutPlanner.buildLayoutSuggestion(plan);
}

export function getImportAutomationSampleLayoutSuggestion(): ImportAutomationLayoutSuggestion {
  return defaultImportAutomationService.layoutPlanner.buildLayoutSuggestion(getImportAutomationSamplePlan());
}

export function createImportAutomationActionRequests(
  item: ImportAutomationItem,
  previousName?: string | null,
  target: ImportAutomationTrackTarget = createSelectedImportAutomationTrackTarget(previousName ?? null)
): ImportAutomationExecutableActionRequest[] {
  return [
    {
      kind: "executable",
      type: "create_audio_track",
      count: 1
    },
    {
      kind: "executable",
      type: "rename_track",
      target,
      previousName: previousName ?? null,
      intendedName: item.cleanTrackName,
      intendedColor: null
    },
    {
      kind: "executable",
      type: "set_track_color",
      target,
      previousName: previousName ?? null,
      intendedName: item.cleanTrackName,
      intendedColor: item.assignedColor
    }
  ];
}

export function createImportAutomationSuggestionActions(
  plan: ImportAutomationPlan
): ImportAutomationSuggestionActionRequest[] {
  const layout = buildImportAutomationLayoutSuggestion(plan);

  return layout.notes.map((detail, index) => ({
    kind: "suggestion_only" as const,
    type:
      index === 0
        ? "ordering_suggestion"
        : index === 4
          ? "routing_suggestion"
          : "grouping_suggestion",
    itemIndex: null,
    originalFilename: null,
    label:
      index === 0
        ? "Suggested track ordering"
        : index === 4
          ? "Suggested routing labels"
          : "Suggested grouping layout",
    detail
  }));
}

export function createImportAutomationExecutableItems(
  items: ImportAutomationItem[],
  options?: {
    previousNames?: Record<string, string | null | undefined>;
    buildTargetForItem?: (
      item: ImportAutomationItem,
      index: number,
      previousName: string | null
    ) => ImportAutomationTrackTarget;
  }
): ImportAutomationPlannedExecutableItem[] {
  return items.map((item, index) => {
    const previousName =
      options?.previousNames?.[item.originalFilename] ?? IMPORT_AUTOMATION_SAMPLE_PREVIOUS_NAMES[item.originalFilename] ?? null;
    const target =
      options?.buildTargetForItem?.(item, index, previousName) ??
      createSelectedImportAutomationTrackTarget(previousName);

    return {
      itemIndex: index,
      item,
      target,
      actions: createImportAutomationActionRequests(item, previousName, target)
    };
  });
}

export function buildImportAutomationPlanFromItems(
  items: ImportAutomationItem[],
  options?: {
    previousNames?: Record<string, string | null | undefined>;
    buildTargetForItem?: (
      item: ImportAutomationItem,
      index: number,
      previousName: string | null
    ) => ImportAutomationTrackTarget;
  }
): ImportAutomationPlan {
  const executableItems = createImportAutomationExecutableItems(items, options);
  const planSeed = {
    source: "import_automation" as const,
    items,
    executableItems,
    suggestionActions: [] as ImportAutomationSuggestionActionRequest[]
  };

  return {
    ...planSeed,
    suggestionActions: createImportAutomationSuggestionActions(planSeed)
  };
}

export function prepareImportAutomationPlan(
  plan: ImportAutomationPlan,
  options?: {
    previousNames?: Record<string, string | null | undefined>;
    buildTargetForItem?: (
      item: ImportAutomationItem,
      index: number,
      previousName: string | null
    ) => ImportAutomationTrackTarget;
  }
): ImportAutomationPreparedPlan {
  const executableItems = createImportAutomationExecutableItems(plan.items, options);

  return {
    source: "import_automation_prepared",
    plan,
    executableItems,
    suggestionActions: plan.suggestionActions
  };
}

export async function executePreparedImportAutomationPlan(
  preparedPlan: ImportAutomationPreparedPlan,
  runner: (
    item: ImportAutomationItem,
    action: ImportAutomationExecutableActionRequest,
    index: number
  ) => Promise<ImportAutomationExecutionRunnerResult>
): Promise<ImportAutomationExecutionReport> {
  const itemResults: ImportAutomationExecutionItemResult[] = [];
  const failures: ImportAutomationExecutionReport["failures"] = [];

  for (const executableItem of preparedPlan.executableItems) {
    const { itemIndex: index, item, actions } = executableItem;
    const actionResults: ImportAutomationExecutionActionResult[] = [];

    for (const action of actions) {
      try {
        const result = await runner(item, action, index);
        const actionResult: ImportAutomationExecutionActionResult = {
          type: action.type,
          ok: result.ok,
          status: result.ok ? "succeeded" : "failed",
          previousName: action.previousName ?? null,
          intendedName: action.intendedName ?? null,
          intendedColor: action.intendedColor ?? null,
          actualName:
            result.actualName === undefined
              ? action.type === "rename_track"
                ? action.intendedName ?? null
                : action.type === "set_track_color"
                  ? action.previousName ?? null
                  : null
              : result.actualName,
          actualColor:
            result.actualColor === undefined
              ? action.type === "set_track_color" && result.ok
                ? action.intendedColor ?? null
                : null
              : result.actualColor,
          message: result.message ?? (result.ok ? "Action completed successfully." : null),
          reason: result.ok ? null : result.reason ?? "Action failed."
        };

        if (!actionResult.ok) {
          failures.push({
            itemIndex: index,
            originalFilename: item.originalFilename,
            action: action.type,
            reason: actionResult.reason ?? "Action failed."
          });
        }

        actionResults.push(actionResult);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Unhandled execution failure.";
        actionResults.push({
          type: action.type,
          ok: false,
          status: "failed",
          previousName: action.previousName ?? null,
          intendedName: action.intendedName ?? null,
          intendedColor: action.intendedColor ?? null,
          actualName: action.type === "set_track_color" ? action.previousName ?? null : null,
          actualColor: null,
          message: null,
          reason
        });
        failures.push({
          itemIndex: index,
          originalFilename: item.originalFilename,
          action: action.type,
          reason
        });
      }
    }

    const failedActionCount = actionResults.filter((action) => !action.ok).length;
    const createAudioTrack = actionResults.find((action) => action.type === "create_audio_track") ?? null;
    const importedAudio = createAudioTrack;
    const renameTrack = actionResults.find((action) => action.type === "rename_track") ?? null;
    const setTrackColor = actionResults.find((action) => action.type === "set_track_color") ?? null;
    itemResults.push({
      originalFilename: item.originalFilename,
      cleanTrackName: item.cleanTrackName,
      assignedColor: item.assignedColor,
      actions: actionResults,
      createAudioTrack,
      importedAudio,
      renameTrack,
      setTrackColor,
      ok: failedActionCount === 0,
      completedActions: actionResults.length - failedActionCount,
      failedActions: failedActionCount,
      summary:
        failedActionCount === 0
          ? "Imported and post-import actions completed successfully."
          : `Completed ${actionResults.length - failedActionCount}/${actionResults.length} import actions; ${failedActionCount} failed.`
    });
  }

  const totalActions = itemResults.reduce((sum, item) => sum + item.actions.length, 0);
  const successfulActions = itemResults.reduce(
    (sum, item) => sum + item.actions.filter((action) => action.ok).length,
    0
  );
  const failedActions = totalActions - successfulActions;
  const successfulItems = itemResults.filter((item) => item.ok).length;
  const failedItems = itemResults.length - successfulItems;
  const audioTracksCreated = itemResults.filter((item) => item.createAudioTrack?.ok).length;
  const audioTrackCreationFailures = itemResults.filter((item) => item.createAudioTrack && !item.createAudioTrack.ok).length;
  const importsSucceeded = audioTracksCreated;
  const importsFailed = audioTrackCreationFailures;
  const renamesSucceeded = itemResults.filter((item) => item.renameTrack?.ok).length;
  const renamesFailed = itemResults.filter((item) => item.renameTrack && !item.renameTrack.ok).length;
  const colorChangesSucceeded = itemResults.filter((item) => item.setTrackColor?.ok).length;
  const colorChangesFailed = itemResults.filter((item) => item.setTrackColor && !item.setTrackColor.ok).length;

  return {
    source: "import_automation_execution",
    totalItems: itemResults.length,
    executableItemsPlanned: preparedPlan.executableItems.length,
    successfulItems,
    failedItems,
    totalActions,
    successfulActions,
    failedActions,
    suggestionOnlyActionsPlanned: preparedPlan.suggestionActions.length,
    suggestionOnlyActionsSkipped: preparedPlan.suggestionActions.length,
    audioTracksCreated,
    audioTrackCreationFailures,
    importsSucceeded,
    importsFailed,
    renamesSucceeded,
    renamesFailed,
    colorChangesSucceeded,
    colorChangesFailed,
    items: itemResults,
    failures,
    summary:
      `Processed ${itemResults.length} item${itemResults.length === 1 ? "" : "s"}: ` +
      `${importsSucceeded} import${importsSucceeded === 1 ? "" : "s"} succeeded, ` +
      `${renamesSucceeded} rename${renamesSucceeded === 1 ? "" : "s"} succeeded, ` +
      `${colorChangesSucceeded} color change${colorChangesSucceeded === 1 ? "" : "s"} succeeded, ` +
      `${failures.length} failure${failures.length === 1 ? "" : "s"}, ` +
      `${preparedPlan.suggestionActions.length} suggestion-only action${
        preparedPlan.suggestionActions.length === 1 ? "" : "s"
      } left non-executable.`
  };
}

export async function executeImportAutomationPlan(
  plan: ImportAutomationPlan,
  runner: (
    item: ImportAutomationItem,
    action: ImportAutomationExecutableActionRequest,
    index: number
  ) => Promise<ImportAutomationExecutionRunnerResult>
): Promise<ImportAutomationExecutionReport> {
  return executePreparedImportAutomationPlan(prepareImportAutomationPlan(plan), runner);
}

export async function getImportAutomationSampleExecutionReport(): Promise<ImportAutomationExecutionReport> {
  const plan = getImportAutomationSamplePlan();

  return executeImportAutomationPlan(plan, async (_item, action) => {
    if (action.type === "create_audio_track") {
      return {
        ok: true,
        message: "Created Logic audio track."
      };
    }

    if (action.type === "rename_track") {
      return {
        ok: true,
        message: "Renamed selected Logic track.",
        actualName: action.intendedName ?? null
      };
    }

    if (_item.detectedCategory === "unknown") {
      return {
        ok: false,
        message: "Skipped track color assignment.",
        actualName: action.previousName ?? null,
        reason: "Color assignment skipped because category is unknown."
      };
    }

    if (_item.originalFilename === "print.wav") {
      return {
        ok: false,
        message: "Skipped track color assignment.",
        actualName: action.previousName ?? null,
        reason: "Color assignment skipped for ambiguous print stem."
      };
    }

    return {
      ok: true,
      message: "Assigned Logic track color.",
      actualColor: action.intendedColor ?? null
    };
  });
}
