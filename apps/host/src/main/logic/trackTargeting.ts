import type { ImportAutomationTrackTarget } from "#protocol";
import type { AppleScriptRunner } from "../automation/applescript.js";

export type SupportedLogicTrackTargetKind = "selected" | "index" | "name";

export type ResolvedLogicTrackTarget = {
  target: ImportAutomationTrackTarget;
  supportedKind: SupportedLogicTrackTargetKind;
  descriptor: string;
  strategy: "selected_track" | "track_list_index_selection" | "track_list_name_selection";
  resolvedTrackIndex: number | null;
  resolvedTrackName: string | null;
  selectionChanged: boolean;
};

export type LogicTrackTargetResolutionContext = {
  applescript: AppleScriptRunner;
  logger?: (message: string) => void;
};

const HOST_TRACK_TARGETING_DEBUG =
  process.env.NODE_ENV !== "production" && process.env.CTRLX_DEBUG_IMPORT_AUTOMATION === "1";
const TRACK_TARGETING_TIMEOUT_MS = 12_000;

function debugTrackTargeting(event: string, payload: Record<string, unknown>): void {
  if (!HOST_TRACK_TARGETING_DEBUG) {
    return;
  }

  console.debug(`[CTRLX import host] ${event}`, payload);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function parseExpectedCurrentName(
  rawTarget: Record<string, unknown>,
  commandId: string
): string | null | undefined {
  if ("expectedCurrentName" in rawTarget && rawTarget.expectedCurrentName !== undefined) {
    if (rawTarget.expectedCurrentName !== null && typeof rawTarget.expectedCurrentName !== "string") {
      throw new Error(`${commandId} target.expectedCurrentName must be a string or null when provided.`);
    }

    return rawTarget.expectedCurrentName as string | null;
  }

  return undefined;
}

function buildTrackListHelperLines(): string[] {
  return [
    "on ctrlxTrimText(ctrlxValue)",
    '  set ctrlxValue to do shell script "/bin/echo " & quoted form of ctrlxValue & " | /usr/bin/tr \'\\r\\n\' \'  \' | /usr/bin/sed -E \'s/[[:space:]]+/ /g; s/^ //; s/ $//\'"',
    "  return ctrlxValue",
    "end ctrlxTrimText",
    "on ctrlxLowerText(ctrlxValue)",
    '  return do shell script "/bin/echo " & quoted form of ctrlxValue & " | /usr/bin/tr \'[:upper:]\' \'[:lower:]\'"',
    "end ctrlxLowerText",
    "on ctrlxIsUsableTrackLabel(ctrlxValue)",
    "  set ctrlxTrimmed to my ctrlxTrimText(ctrlxValue)",
    '  if ctrlxTrimmed is "" then return false',
    '  if ctrlxTrimmed is "M" or ctrlxTrimmed is "S" or ctrlxTrimmed is "R" or ctrlxTrimmed is "I" then return false',
    '  if ctrlxTrimmed is "Mute" or ctrlxTrimmed is "Solo" or ctrlxTrimmed is "Record" or ctrlxTrimmed is "Input" then return false',
    '  try',
    '    do shell script "/bin/echo " & quoted form of ctrlxTrimmed & " | /usr/bin/grep -Eq \'^[0-9]+$\'"',
    "    return false",
    "  on error",
    "    return true",
    "  end try",
    "end ctrlxIsUsableTrackLabel",
    "on ctrlxPrimaryRowLabel(ctrlxRow)",
    '  set ctrlxCandidates to {}',
    '  try',
    '    set ctrlxRowName to name of ctrlxRow as text',
    '    if my ctrlxIsUsableTrackLabel(ctrlxRowName) then set end of ctrlxCandidates to ctrlxRowName',
    '  end try',
    '  try',
    '    set ctrlxStaticTexts to every static text of entire contents of ctrlxRow',
    '    repeat with ctrlxStaticText in ctrlxStaticTexts',
    '      try',
    '        set ctrlxStaticValue to value of ctrlxStaticText as text',
    '        if my ctrlxIsUsableTrackLabel(ctrlxStaticValue) then set end of ctrlxCandidates to ctrlxStaticValue',
    '      end try',
    '      try',
    '        set ctrlxStaticName to name of ctrlxStaticText as text',
    '        if my ctrlxIsUsableTrackLabel(ctrlxStaticName) then set end of ctrlxCandidates to ctrlxStaticName',
    '      end try',
    '    end repeat',
    '  end try',
    '  repeat with ctrlxCandidate in ctrlxCandidates',
    '    set ctrlxNormalizedCandidate to my ctrlxTrimText(contents of ctrlxCandidate)',
    '    if ctrlxNormalizedCandidate is not "" then return ctrlxNormalizedCandidate',
    '  end repeat',
    '  return ""',
    "end ctrlxPrimaryRowLabel",
    "on ctrlxTrackContainersForProcess(ctrlxProcess)",
    '  set ctrlxContainers to {}',
    '  try',
    '    repeat with ctrlxOutline in every outline of entire contents of front window of ctrlxProcess',
    '      try',
    '        if (count of rows of ctrlxOutline) > 0 then set end of ctrlxContainers to ctrlxOutline',
    '      end try',
    '    end repeat',
    '  end try',
    '  try',
    '    repeat with ctrlxTable in every table of entire contents of front window of ctrlxProcess',
    '      try',
    '        if (count of rows of ctrlxTable) > 0 then set end of ctrlxContainers to ctrlxTable',
    '      end try',
    '    end repeat',
    '  end try',
    '  return ctrlxContainers',
    "end ctrlxTrackContainersForProcess",
    "on ctrlxBestTrackContainer(ctrlxProcess)",
    '  set ctrlxContainers to my ctrlxTrackContainersForProcess(ctrlxProcess)',
    '  if (count of ctrlxContainers) is 0 then return missing value',
    '  set ctrlxBestContainer to missing value',
    '  set ctrlxBestRowCount to -1',
    '  repeat with ctrlxContainer in ctrlxContainers',
    '    try',
    '      set ctrlxRowCount to count of rows of ctrlxContainer',
    '      if ctrlxRowCount > ctrlxBestRowCount then',
    '        set ctrlxBestContainer to ctrlxContainer',
    '        set ctrlxBestRowCount to ctrlxRowCount',
    '      end if',
    '    end try',
    '  end repeat',
    '  return ctrlxBestContainer',
    "end ctrlxBestTrackContainer",
    "on ctrlxSelectedRowFromContainer(ctrlxContainer)",
    '  repeat with ctrlxRow in rows of ctrlxContainer',
    '    try',
    '      if selected of ctrlxRow is true then return ctrlxRow',
    '    end try',
    '    try',
    '      if value of attribute "AXSelected" of ctrlxRow is true then return ctrlxRow',
    '    end try',
    '  end repeat',
    '  return missing value',
    "end ctrlxSelectedRowFromContainer",
    "on ctrlxRowIndex(ctrlxContainer, ctrlxTargetRow)",
    '  set ctrlxRows to rows of ctrlxContainer',
    '  repeat with ctrlxIndex from 1 to count of ctrlxRows',
    '    if item ctrlxIndex of ctrlxRows is ctrlxTargetRow then return ctrlxIndex',
    '  end repeat',
    '  return -1',
    "end ctrlxRowIndex",
    "on ctrlxPressRow(ctrlxRow)",
    '  try',
    '    perform action "AXPress" of ctrlxRow',
    '    return',
    '  on error',
    '  end try',
    '  try',
    '    click ctrlxRow',
    '    return',
    '  on error',
    '    error "selection_failed"',
    '  end try',
    "end ctrlxPressRow"
  ];
}

function parseTrackTargetResult(stdout: string, commandId: string): { resolvedTrackIndex: number | null; resolvedTrackName: string | null } {
  const [indexRaw = "", nameRaw = ""] = stdout.split("\t");
  const resolvedTrackIndex = Number.parseInt(indexRaw, 10);

  if (!Number.isFinite(resolvedTrackIndex) || resolvedTrackIndex < 1) {
    throw new Error(`${commandId} target resolution returned an invalid track index.`);
  }

  return {
    resolvedTrackIndex,
    resolvedTrackName: nameRaw.trim().length > 0 ? nameRaw.trim() : null
  };
}

function parseSelectedTrackTargetResult(
  stdout: string,
  commandId: string
): { resolvedTrackIndex: number | null; resolvedTrackName: string | null } {
  const [indexRaw = "", nameRaw = ""] = stdout.split("\t");
  const resolvedTrackIndex = Number.parseInt(indexRaw, 10);

  if (Number.isFinite(resolvedTrackIndex) && resolvedTrackIndex >= 1) {
    return {
      resolvedTrackIndex,
      resolvedTrackName: nameRaw.trim().length > 0 ? nameRaw.trim() : null
    };
  }

  if (indexRaw.trim() === "" || indexRaw.trim() === "0") {
    return {
      resolvedTrackIndex: null,
      resolvedTrackName: nameRaw.trim().length > 0 ? nameRaw.trim() : null
    };
  }

  throw new Error(`${commandId} target resolution returned an invalid selected track result.`);
}

function normalizeComparableName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

async function resolveSelectedTrackTarget(
  target: Extract<ImportAutomationTrackTarget, { kind: "selected" }>,
  commandId: string,
  context: LogicTrackTargetResolutionContext
): Promise<ResolvedLogicTrackTarget> {
  try {
    const result = await context.applescript.run(
      [
        ...buildTrackListHelperLines(),
        'tell application "Logic Pro" to activate',
        "delay 0.1",
        'tell application "System Events"',
        '  tell process "Logic Pro"',
        "    set frontmost to true",
        "    set ctrlxContainer to my ctrlxBestTrackContainer(it)",
        "    if ctrlxContainer is missing value then return \"0\" & tab & \"\"",
        "    set ctrlxSelectedRow to my ctrlxSelectedRowFromContainer(ctrlxContainer)",
        "    if ctrlxSelectedRow is missing value then error \"selection_failed\"",
        "    set ctrlxSelectedIndex to my ctrlxRowIndex(ctrlxContainer, ctrlxSelectedRow)",
        "    try",
        "      my ctrlxPressRow(ctrlxSelectedRow)",
        "    end try",
        "    delay 0.1",
        "    set ctrlxSelectedName to my ctrlxPrimaryRowLabel(ctrlxSelectedRow)",
        "    return (ctrlxSelectedIndex as text) & tab & ctrlxSelectedName",
        "  end tell",
        "end tell"
      ],
      { timeoutMs: TRACK_TARGETING_TIMEOUT_MS }
    );

    const parsed = parseSelectedTrackTargetResult(result.stdout, commandId);

    if (
      typeof target.expectedCurrentName === "string" &&
      parsed.resolvedTrackName &&
      normalizeComparableName(parsed.resolvedTrackName) !== normalizeComparableName(target.expectedCurrentName)
    ) {
      throw new Error(
        `${commandId} selection failed: expected selected track "${target.expectedCurrentName}", but resolved "${parsed.resolvedTrackName}".`
      );
    }

    return {
      target,
      supportedKind: "selected",
      descriptor: parsed.resolvedTrackName
        ? `selected Logic track "${parsed.resolvedTrackName}"`
        : "selected Logic track",
      strategy: "selected_track",
      resolvedTrackIndex: parsed.resolvedTrackIndex,
      resolvedTrackName: parsed.resolvedTrackName,
      selectionChanged: false
    };
  } catch (error) {
    const rawMessage =
      error instanceof Error && error.message ? error.message : typeof error === "string" ? error : "";
    const canFallbackToSelected =
      typeof target.expectedCurrentName !== "string" &&
      (rawMessage.includes("track_list_not_found") || rawMessage.includes("selection_failed"));

    if (!canFallbackToSelected) {
      throw error;
    }

    debugTrackTargeting("target_resolution_selected_fallback", {
      commandId,
      reason: rawMessage || "uninspectable_selected_track"
    });

    return {
      target,
      supportedKind: "selected",
      descriptor: "selected Logic track",
      strategy: "selected_track",
      resolvedTrackIndex: null,
      resolvedTrackName: null,
      selectionChanged: false
    };
  }
}

async function resolveTrackByIndex(
  target: Extract<ImportAutomationTrackTarget, { kind: "index" }>,
  commandId: string,
  context: LogicTrackTargetResolutionContext
): Promise<ResolvedLogicTrackTarget> {
  const result = await context.applescript.run(
    [
      ...buildTrackListHelperLines(),
      `set ctrlxRequestedTrackIndex to ${target.trackIndex}`,
      'tell application "Logic Pro" to activate',
      "delay 0.1",
      'tell application "System Events"',
      '  tell process "Logic Pro"',
      "    set frontmost to true",
      "    set ctrlxContainer to my ctrlxBestTrackContainer(it)",
      "    if ctrlxContainer is missing value then error \"track_list_not_found\"",
      "    set ctrlxRows to rows of ctrlxContainer",
      "    set ctrlxRowCount to count of ctrlxRows",
      "    if ctrlxRequestedTrackIndex > ctrlxRowCount then error \"index_out_of_range:\" & ctrlxRowCount",
      "    set ctrlxTargetRow to item ctrlxRequestedTrackIndex of ctrlxRows",
      "    try",
      "      my ctrlxPressRow(ctrlxTargetRow)",
      "    on error",
      "      error \"selection_failed\"",
      "    end try",
      "    delay 0.1",
      "    set ctrlxResolvedName to my ctrlxPrimaryRowLabel(ctrlxTargetRow)",
      "    return (ctrlxRequestedTrackIndex as text) & tab & ctrlxResolvedName",
      "  end tell",
      "end tell"
    ],
    { timeoutMs: TRACK_TARGETING_TIMEOUT_MS }
  );

  const parsed = parseTrackTargetResult(result.stdout, commandId);

  return {
    target,
    supportedKind: "index",
    descriptor: parsed.resolvedTrackName
      ? `Logic track at index ${target.trackIndex} ("${parsed.resolvedTrackName}")`
      : `Logic track at index ${target.trackIndex}`,
    strategy: "track_list_index_selection",
    resolvedTrackIndex: parsed.resolvedTrackIndex,
    resolvedTrackName: parsed.resolvedTrackName,
    selectionChanged: true
  };
}

async function resolveTrackByName(
  target: Extract<ImportAutomationTrackTarget, { kind: "name" }>,
  commandId: string,
  context: LogicTrackTargetResolutionContext
): Promise<ResolvedLogicTrackTarget> {
  const escapedRequestedName = escapeAppleScriptString(normalizeComparableName(target.trackName));

  const result = await context.applescript.run(
    [
      ...buildTrackListHelperLines(),
      `set ctrlxRequestedTrackName to "${escapedRequestedName}"`,
      'tell application "Logic Pro" to activate',
      "delay 0.1",
      'tell application "System Events"',
      '  tell process "Logic Pro"',
      "    set frontmost to true",
      "    set ctrlxContainer to my ctrlxBestTrackContainer(it)",
      "    if ctrlxContainer is missing value then error \"track_list_not_found\"",
      "    set ctrlxRows to rows of ctrlxContainer",
      '    set ctrlxExactMatches to {}',
      '    set ctrlxPartialMatches to {}',
      "    repeat with ctrlxIndex from 1 to count of ctrlxRows",
      "      set ctrlxRow to item ctrlxIndex of ctrlxRows",
      "      set ctrlxRowLabel to my ctrlxPrimaryRowLabel(ctrlxRow)",
      '      if ctrlxRowLabel is "" then',
      '        set ctrlxNormalizedRowLabel to ""',
      "      else",
      "        set ctrlxNormalizedRowLabel to my ctrlxLowerText(ctrlxRowLabel)",
      "      end if",
      "      if ctrlxNormalizedRowLabel is ctrlxRequestedTrackName then",
      "        set end of ctrlxExactMatches to (ctrlxIndex as text) & tab & ctrlxRowLabel",
      "      else if ctrlxNormalizedRowLabel contains ctrlxRequestedTrackName then",
      "        set end of ctrlxPartialMatches to (ctrlxIndex as text) & tab & ctrlxRowLabel",
      "      end if",
      "    end repeat",
      "    if (count of ctrlxExactMatches) > 1 then error \"ambiguous_track_name_exact\"",
      "    if (count of ctrlxExactMatches) is 1 then",
      "      set ctrlxMatchData to item 1 of ctrlxExactMatches",
      "    else",
      "      if (count of ctrlxPartialMatches) is 0 then error \"track_not_found\"",
      "      if (count of ctrlxPartialMatches) > 1 then error \"ambiguous_track_name_partial\"",
      "      set ctrlxMatchData to item 1 of ctrlxPartialMatches",
      "    end if",
      "    set AppleScript's text item delimiters to tab",
      "    set ctrlxMatchParts to text items of ctrlxMatchData",
      "    set AppleScript's text item delimiters to \"\"",
      "    set ctrlxResolvedIndex to item 1 of ctrlxMatchParts as integer",
      "    set ctrlxResolvedName to item 2 of ctrlxMatchParts",
      "    set ctrlxTargetRow to item ctrlxResolvedIndex of ctrlxRows",
      "    try",
      "      my ctrlxPressRow(ctrlxTargetRow)",
      "    on error",
      "      error \"selection_failed\"",
      "    end try",
      "    delay 0.1",
      "    return (ctrlxResolvedIndex as text) & tab & ctrlxResolvedName",
      "  end tell",
      "end tell"
    ],
    { timeoutMs: TRACK_TARGETING_TIMEOUT_MS }
  );

  const parsed = parseTrackTargetResult(result.stdout, commandId);

  return {
    target,
    supportedKind: "name",
    descriptor: parsed.resolvedTrackName
      ? `Logic track named "${parsed.resolvedTrackName}"`
      : `Logic track named "${target.trackName}"`,
    strategy: "track_list_name_selection",
    resolvedTrackIndex: parsed.resolvedTrackIndex,
    resolvedTrackName: parsed.resolvedTrackName,
    selectionChanged: true
  };
}

function mapTrackResolutionError(commandId: string, error: unknown): never {
  const rawMessage =
    error instanceof Error && error.message ? error.message : typeof error === "string" ? error : "target_resolution_failed";

  if (rawMessage.includes("track_list_not_found")) {
    throw new Error(`${commandId} target resolution failed: could not find the Logic track list.`);
  }

  if (rawMessage.includes("selection_failed")) {
    throw new Error(`${commandId} target resolution failed: selecting the target Logic track failed.`);
  }

  if (rawMessage.includes("index_out_of_range:")) {
    const [, rowCount = "0"] = rawMessage.split(":");
    throw new Error(`${commandId} target resolution failed: track index is out of range. Logic exposed ${rowCount} track rows.`);
  }

  if (rawMessage.includes("track_not_found")) {
    throw new Error(`${commandId} target resolution failed: track not found.`);
  }

  if (rawMessage.includes("ambiguous_track_name_exact") || rawMessage.includes("ambiguous_track_name_partial")) {
    throw new Error(`${commandId} target resolution failed: track name is ambiguous.`);
  }

  throw new Error(`${commandId} target resolution failed: ${rawMessage}`);
}

export function parseLogicTrackTarget(rawTarget: unknown, commandId: string): ImportAutomationTrackTarget {
  if (!isRecord(rawTarget) || typeof rawTarget.kind !== "string") {
    throw new Error(`${commandId} requires a valid target payload.`);
  }

  const expectedCurrentName = parseExpectedCurrentName(rawTarget, commandId);

  if (rawTarget.kind === "selected") {
    const target = {
      kind: "selected",
      expectedCurrentName
    } as const;
    debugTrackTargeting("target_parsed", {
      commandId,
      targetKind: target.kind,
      expectedCurrentName: target.expectedCurrentName ?? null
    });
    return target;
  }

  if (rawTarget.kind === "index") {
    if (
      typeof rawTarget.trackIndex !== "number" ||
      !Number.isFinite(rawTarget.trackIndex) ||
      !Number.isInteger(rawTarget.trackIndex) ||
      rawTarget.trackIndex < 1
    ) {
      throw new Error(`${commandId} target.trackIndex must be a positive integer for target.kind='index'.`);
    }

    const target = {
      kind: "index",
      trackIndex: rawTarget.trackIndex,
      expectedCurrentName
    } as const;
    debugTrackTargeting("target_parsed", {
      commandId,
      targetKind: target.kind,
      trackIndex: target.trackIndex,
      expectedCurrentName: target.expectedCurrentName ?? null
    });
    return target;
  }

  if (rawTarget.kind === "name") {
    if (typeof rawTarget.trackName !== "string" || rawTarget.trackName.trim().length === 0) {
      throw new Error(`${commandId} target.trackName must be a non-empty string for target.kind='name'.`);
    }

    const target = {
      kind: "name",
      trackName: rawTarget.trackName.trim(),
      expectedCurrentName
    } as const;
    debugTrackTargeting("target_parsed", {
      commandId,
      targetKind: target.kind,
      trackName: target.trackName,
      expectedCurrentName: target.expectedCurrentName ?? null
    });
    return target;
  }

  if (rawTarget.kind === "batch_slot") {
    throw new Error(`${commandId} target.kind='batch_slot' is not supported yet.`);
  }

  throw new Error(`${commandId} target.kind "${rawTarget.kind}" is not recognized.`);
}

export function describeLogicTrackTarget(target: ImportAutomationTrackTarget): string {
  switch (target.kind) {
    case "selected":
      return "selected Logic track";
    case "index":
      return `Logic track at index ${target.trackIndex}`;
    case "name":
      return `Logic track named "${target.trackName}"`;
    case "batch_slot":
      return `Logic batch track slot ${target.batchIndex}`;
  }
}

export async function resolveLogicTrackTarget(
  target: ImportAutomationTrackTarget,
  commandId: string,
  context: LogicTrackTargetResolutionContext
): Promise<ResolvedLogicTrackTarget> {
  context.logger?.(`Resolving Logic track target for ${commandId}: ${describeLogicTrackTarget(target)}`);

  try {
    let resolved: ResolvedLogicTrackTarget;

    switch (target.kind) {
      case "selected":
        resolved = await resolveSelectedTrackTarget(target, commandId, context);
        break;
      case "index":
        resolved = await resolveTrackByIndex(target, commandId, context);
        break;
      case "name":
        resolved = await resolveTrackByName(target, commandId, context);
        break;
      case "batch_slot":
        debugTrackTargeting("target_resolution_failed", {
          commandId,
          targetKind: target.kind,
          reason: "unsupported_target_kind"
        });
        throw new Error(`${commandId} target.kind='batch_slot' is not supported yet.`);
    }

    debugTrackTargeting("target_resolved", {
      commandId,
      targetKind: target.kind,
      strategy: resolved.strategy,
      descriptor: resolved.descriptor,
      resolvedTrackIndex: resolved.resolvedTrackIndex,
      resolvedTrackName: resolved.resolvedTrackName,
      selectionChanged: resolved.selectionChanged
    });

    return resolved;
  } catch (error) {
    debugTrackTargeting("target_resolution_failed", {
      commandId,
      targetKind: target.kind,
      reason: error instanceof Error ? error.message : String(error)
    });
    return mapTrackResolutionError(commandId, error);
  }
}

export async function captureCurrentlySelectedLogicTrack(
  commandId: string,
  context: LogicTrackTargetResolutionContext
): Promise<ResolvedLogicTrackTarget> {
  return resolveLogicTrackTarget(
    {
      kind: "selected",
      expectedCurrentName: null
    },
    commandId,
    context
  );
}
