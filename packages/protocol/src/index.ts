import {
  IMPORT_AUTOMATION_COLORS,
  IMPORT_AUTOMATION_CATEGORIES,
  type ImportAutomationConfidence,
  type ImportAutomationColor,
  type ImportAutomationItem,
  type ImportAutomationPlan,
  type ImportAutomationTrackTarget
} from "./importAutomation.js";

export const CTRLX_PROTOCOL_VERSION = "1.2.0";
export * from "./importAutomation.js";
export * from "./gestureMappings.js";

export enum CtrlxMessageType {
  Hello = "hello",
  PairRequest = "pair_request",
  PairSuccess = "pair_success",
  Heartbeat = "heartbeat",
  Command = "command",
  ScreenInput = "screen_input",
  KeyboardInput = "keyboard_input",
  Ack = "ack",
  Result = "result",
  Error = "error",
  Status = "status",
  StreamRequest = "stream_request",
  StreamOffer = "stream_offer",
  StreamAnswer = "stream_answer",
  StreamIce = "stream_ice",
  StreamStatus = "stream_status",
  Pair = "pair",
  Paired = "paired",
  Input = "input",
  Ping = "ping",
  Pong = "pong"
}

export enum CtrlxCommand {
  Ping = "ping",
  OpenLogic = "session.open_logic",
  PlayStop = "transport.play_stop",
  SaveProject = "session.save",
  Undo = "edit.undo",
  CreateAudioTrack = "track.create_audio",
  ImportAudioFilesIntoCurrentProject = "import.import_audio_files_into_current_project",
  ZoomInHorizontal = "view.zoom_in_horizontal",
  ZoomOutHorizontal = "view.zoom_out_horizontal",
  ZoomInVertical = "view.zoom_in_vertical",
  ZoomOutVertical = "view.zoom_out_vertical",
  OpenSelectedEditor = "view.open_selected_editor",
  RequestImportSelection = "import.request_selection",
  ExecuteImportPlan = "import.execute_plan",
  RenameTrack = "track.rename",
  SetTrackColor = "track.set_color",
  MuteSelectedTrack = "track.mute_selected",
  SoloSelectedTrack = "track.solo_selected",
  ArmSelectedTrack = "track.arm_selected"
}

export type AssignableCtrlxCommandCategory = "transport" | "track" | "session" | "edit";
export type AssignableCtrlxCommandIconKey =
  | "logic"
  | "play_stop"
  | "save"
  | "undo"
  | "zoom_in_horizontal"
  | "zoom_out_horizontal"
  | "zoom_in_vertical"
  | "zoom_out_vertical"
  | "open_editor"
  | "mute"
  | "solo"
  | "arm";

export type AssignableCtrlxCommandCatalogEntry = {
  id: CtrlxCommand;
  label: string;
  iconKey: AssignableCtrlxCommandIconKey;
  category: AssignableCtrlxCommandCategory;
  implemented: true;
  assignable: true;
};

export type FutureCtrlxCommandCandidate = {
  id: string;
  label: string;
  iconKey: string;
  category: AssignableCtrlxCommandCategory;
  implemented: false;
  assignable: false;
  note: string;
};

export const ASSIGNABLE_CTRLX_COMMAND_CATALOG: readonly AssignableCtrlxCommandCatalogEntry[] = [
  {
    id: CtrlxCommand.OpenLogic,
    label: "Create Session",
    iconKey: "logic",
    category: "session",
    implemented: true,
    assignable: true
  },
  {
    id: CtrlxCommand.PlayStop,
    label: "Play / Stop",
    iconKey: "play_stop",
    category: "transport",
    implemented: true,
    assignable: true
  },
  {
    id: CtrlxCommand.SaveProject,
    label: "Save",
    iconKey: "save",
    category: "session",
    implemented: true,
    assignable: true
  },
  {
    id: CtrlxCommand.Undo,
    label: "Undo",
    iconKey: "undo",
    category: "edit",
    implemented: true,
    assignable: true
  },
  {
    id: CtrlxCommand.ZoomInHorizontal,
    label: "Zoom H In",
    iconKey: "zoom_in_horizontal",
    category: "edit",
    implemented: true,
    assignable: true
  },
  {
    id: CtrlxCommand.ZoomOutHorizontal,
    label: "Zoom H Out",
    iconKey: "zoom_out_horizontal",
    category: "edit",
    implemented: true,
    assignable: true
  },
  {
    id: CtrlxCommand.ZoomInVertical,
    label: "Zoom V In",
    iconKey: "zoom_in_vertical",
    category: "edit",
    implemented: true,
    assignable: true
  },
  {
    id: CtrlxCommand.ZoomOutVertical,
    label: "Zoom V Out",
    iconKey: "zoom_out_vertical",
    category: "edit",
    implemented: true,
    assignable: true
  },
  {
    id: CtrlxCommand.OpenSelectedEditor,
    label: "Open Editor",
    iconKey: "open_editor",
    category: "edit",
    implemented: true,
    assignable: true
  },
  {
    id: CtrlxCommand.MuteSelectedTrack,
    label: "Mute",
    iconKey: "mute",
    category: "track",
    implemented: true,
    assignable: true
  },
  {
    id: CtrlxCommand.SoloSelectedTrack,
    label: "Solo",
    iconKey: "solo",
    category: "track",
    implemented: true,
    assignable: true
  },
  {
    id: CtrlxCommand.ArmSelectedTrack,
    label: "Arm",
    iconKey: "arm",
    category: "track",
    implemented: true,
    assignable: true
  }
] as const;

export const FUTURE_CTRLX_COMMAND_CANDIDATES: readonly FutureCtrlxCommandCandidate[] = [
  {
    id: "transport.record",
    label: "Record",
    iconKey: "record",
    category: "transport",
    implemented: false,
    assignable: false,
    note: "Not implemented in the current shared CTRLX command pipeline."
  },
  {
    id: "edit.redo",
    label: "Redo",
    iconKey: "redo",
    category: "edit",
    implemented: false,
    assignable: false,
    note: "Not implemented in the current shared CTRLX command pipeline."
  },
  {
    id: "track.new",
    label: "New Track",
    iconKey: "new_track",
    category: "track",
    implemented: false,
    assignable: false,
    note: "Not implemented in the current shared CTRLX command pipeline."
  },
  {
    id: "transport.metronome",
    label: "Metronome",
    iconKey: "metronome",
    category: "transport",
    implemented: false,
    assignable: false,
    note: "Not implemented in the current shared CTRLX command pipeline."
  },
  {
    id: "view.zoom_in",
    label: "Zoom In",
    iconKey: "zoom_in",
    category: "edit",
    implemented: false,
    assignable: false,
    note: "Not implemented in the current shared CTRLX command pipeline."
  },
  {
    id: "view.zoom_out",
    label: "Zoom Out",
    iconKey: "zoom_out",
    category: "edit",
    implemented: false,
    assignable: false,
    note: "Not implemented in the current shared CTRLX command pipeline."
  },
  {
    id: "navigation.previous",
    label: "Previous",
    iconKey: "previous",
    category: "transport",
    implemented: false,
    assignable: false,
    note: "Not implemented in the current shared CTRLX command pipeline."
  },
  {
    id: "navigation.next",
    label: "Next",
    iconKey: "next",
    category: "transport",
    implemented: false,
    assignable: false,
    note: "Not implemented in the current shared CTRLX command pipeline."
  }
] as const;

export function getAssignableCtrlxCommandCatalog(): AssignableCtrlxCommandCatalogEntry[] {
  return [...ASSIGNABLE_CTRLX_COMMAND_CATALOG];
}

export function getFutureCtrlxCommandCandidates(): FutureCtrlxCommandCandidate[] {
  return [...FUTURE_CTRLX_COMMAND_CANDIDATES];
}

export type CtrlxPeerRole = "host" | "client";
export type CtrlxConnectionState = "idle" | "waiting" | "paired" | "busy" | "error";
export type CtrlxScreenInputAction =
  | "tap"
  | "double_tap"
  | "pointer_down"
  | "pointer_move"
  | "pointer_up"
  | "gesture_pan"
  | "gesture_zoom"
  | "gesture_region_move";
export type CtrlxGesturePhase = "start" | "move" | "end";
export type CtrlxZoomAxis = "horizontal" | "vertical";
export type CtrlxKeyboardInputAction = "insert_text" | "backspace" | "enter" | "escape";
export type CtrlxAckState = "received" | "mapped" | "executed" | "failed";

export type CtrlxEnvelope<TType extends string, TPayload> = {
  type: TType;
  requestId?: string;
  sessionCode?: string;
  sentAt: string;
  payload: TPayload;
};

export type HelloPayload = {
  protocolVersion: string;
  role: CtrlxPeerRole;
  clientName?: string;
};

export type PairRequestPayload = {
  sessionCode: string;
  clientName?: string;
};

export type PairSuccessPayload = {
  sessionCode: string;
  hostName: string;
  connectionState: Extract<CtrlxConnectionState, "paired">;
};

export type HeartbeatPayload = {
  nonce: string;
  role?: CtrlxPeerRole;
};

export type StreamRequestPayload = {
  action: "start" | "stop";
};

export type StreamOfferPayload = {
  sdp: string;
  type: "offer";
};

export type StreamAnswerPayload = {
  sdp: string;
  type: "answer";
};

export type StreamIcePayload = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
};

export type StreamStatusPayload = {
  state: "idle" | "requesting" | "signaling" | "streaming" | "stopped" | "error";
  message?: string;
};

export type CtrlxLogLevel = "info" | "success" | "warn" | "error";
export type CtrlxLogSource = "host" | "client" | "ws" | "webrtc" | "input" | "keyboard" | "import";
export type CtrlxLogContext = Record<string, unknown>;
export type CtrlxLogEntry = {
  id: string;
  level: CtrlxLogLevel;
  message: string;
  at: string;
  source: CtrlxLogSource;
  context?: CtrlxLogContext;
};
export type CtrlxLogEntryStatusData = {
  kind: "log_entry";
  entry: CtrlxLogEntry;
};

export type ScreenInputPayload = {
  action: CtrlxScreenInputAction;
  xNorm: number;
  yNorm: number;
  viewerWidth: number;
  viewerHeight: number;
  timestamp: number;
  pointerType?: "touch" | "mouse" | "pen";
  gesturePhase?: CtrlxGesturePhase;
  zoomAxis?: CtrlxZoomAxis;
  deltaX?: number;
  deltaY?: number;
  zoomDelta?: number;
};

export type KeyboardInputPayload = {
  action: CtrlxKeyboardInputAction;
  text?: string;
  timestamp: number;
};

export type AckPayload = {
  ok: boolean;
  state: CtrlxAckState;
  ackFor?: string;
  message?: string;
  reason?: string;
  data?: Record<string, unknown>;
};

export type PingCommandPayload = {
  command: CtrlxCommand.Ping;
};

export type OpenLogicCommandPayload = {
  command: CtrlxCommand.OpenLogic;
};

export type PlayStopCommandPayload = {
  command: CtrlxCommand.PlayStop;
};

export type SaveProjectCommandPayload = {
  command: CtrlxCommand.SaveProject;
};

export type UndoCommandPayload = {
  command: CtrlxCommand.Undo;
};

export type CreateAudioTrackCommandInput = {
  count?: number;
};

export type CreateAudioTrackCommandPayload = {
  command: CtrlxCommand.CreateAudioTrack;
  input?: CreateAudioTrackCommandInput;
};

export type ImportAudioFilesIntoCurrentProjectCommandInput = {
  filePaths: string[];
};

export type ImportAudioFilesIntoCurrentProjectCommandPayload = {
  command: CtrlxCommand.ImportAudioFilesIntoCurrentProject;
  input: ImportAudioFilesIntoCurrentProjectCommandInput;
};

export type ZoomInHorizontalCommandPayload = {
  command: CtrlxCommand.ZoomInHorizontal;
};

export type ZoomOutHorizontalCommandPayload = {
  command: CtrlxCommand.ZoomOutHorizontal;
};

export type ZoomInVerticalCommandPayload = {
  command: CtrlxCommand.ZoomInVertical;
};

export type ZoomOutVerticalCommandPayload = {
  command: CtrlxCommand.ZoomOutVertical;
};

export type OpenSelectedEditorCommandPayload = {
  command: CtrlxCommand.OpenSelectedEditor;
};

export type RequestImportSelectionCommandInput = {
  allowFolders?: boolean;
};

export type RequestImportSelectionCommandPayload = {
  command: CtrlxCommand.RequestImportSelection;
  input?: RequestImportSelectionCommandInput;
};

export type ExecuteImportPlanCommandInput = {
  importSessionId?: string;
  folderPath?: string;
  plan: ImportAutomationPlan;
};

export type ExecuteImportPlanCommandPayload = {
  command: CtrlxCommand.ExecuteImportPlan;
  input: ExecuteImportPlanCommandInput;
};

export type RenameTrackTarget = ImportAutomationTrackTarget;

export type RenameTrackCommandInput = {
  target: RenameTrackTarget;
  newName: string;
  previousName?: string | null;
};

export type RenameTrackCommandPayload = {
  command: CtrlxCommand.RenameTrack;
  input: RenameTrackCommandInput;
};

export type SetTrackColorTarget = ImportAutomationTrackTarget;

export type SetTrackColorCommandInput = {
  target: SetTrackColorTarget;
  color: ImportAutomationColor;
  previousColor?: ImportAutomationColor | null;
};

export type SetTrackColorCommandPayload = {
  command: CtrlxCommand.SetTrackColor;
  input: SetTrackColorCommandInput;
};

export type MuteSelectedTrackCommandPayload = {
  command: CtrlxCommand.MuteSelectedTrack;
};

export type SoloSelectedTrackCommandPayload = {
  command: CtrlxCommand.SoloSelectedTrack;
};

export type ArmSelectedTrackCommandPayload = {
  command: CtrlxCommand.ArmSelectedTrack;
};

export type CommandPayload =
  | PingCommandPayload
  | OpenLogicCommandPayload
  | PlayStopCommandPayload
  | SaveProjectCommandPayload
  | UndoCommandPayload
  | CreateAudioTrackCommandPayload
  | ImportAudioFilesIntoCurrentProjectCommandPayload
  | ZoomInHorizontalCommandPayload
  | ZoomOutHorizontalCommandPayload
  | ZoomInVerticalCommandPayload
  | ZoomOutVerticalCommandPayload
  | OpenSelectedEditorCommandPayload
  | RequestImportSelectionCommandPayload
  | ExecuteImportPlanCommandPayload
  | RenameTrackCommandPayload
  | SetTrackColorCommandPayload
  | MuteSelectedTrackCommandPayload
  | SoloSelectedTrackCommandPayload
  | ArmSelectedTrackCommandPayload;

export type CommandResultPayload = {
  command: string;
  ok: true;
  message: string;
  data?: Record<string, unknown>;
};

export type CommandErrorPayload = {
  command?: string;
  ok: false;
  code:
    | "INVALID_MESSAGE"
    | "INVALID_SESSION"
    | "ALREADY_PAIRED"
    | "UNAUTHORIZED"
    | "UNKNOWN_COMMAND"
    | "EXECUTION_FAILED";
  message: string;
};

export type StatusPayload = {
  connectionState: CtrlxConnectionState;
  activeClientId?: string | null;
  hostName?: string;
  message?: string;
  data?: Record<string, unknown> | CtrlxLogEntryStatusData;
};

export type HelloMessage = CtrlxEnvelope<CtrlxMessageType.Hello, HelloPayload>;
export type PairRequestMessage = CtrlxEnvelope<CtrlxMessageType.PairRequest, PairRequestPayload>;
export type PairSuccessMessage = CtrlxEnvelope<CtrlxMessageType.PairSuccess, PairSuccessPayload>;
export type HeartbeatMessage = CtrlxEnvelope<CtrlxMessageType.Heartbeat, HeartbeatPayload>;
export type CommandMessage = CtrlxEnvelope<CtrlxMessageType.Command, CommandPayload>;
export type ScreenInputMessage = CtrlxEnvelope<CtrlxMessageType.ScreenInput, ScreenInputPayload>;
export type KeyboardInputMessage = CtrlxEnvelope<CtrlxMessageType.KeyboardInput, KeyboardInputPayload>;
export type AckMessage = CtrlxEnvelope<CtrlxMessageType.Ack, AckPayload>;
export type ResultMessage = CtrlxEnvelope<CtrlxMessageType.Result, CommandResultPayload>;
export type ErrorMessage = CtrlxEnvelope<CtrlxMessageType.Error, CommandErrorPayload>;
export type StatusMessage = CtrlxEnvelope<CtrlxMessageType.Status, StatusPayload>;
export type StreamRequestMessage = CtrlxEnvelope<CtrlxMessageType.StreamRequest, StreamRequestPayload>;
export type StreamOfferMessage = CtrlxEnvelope<CtrlxMessageType.StreamOffer, StreamOfferPayload>;
export type StreamAnswerMessage = CtrlxEnvelope<CtrlxMessageType.StreamAnswer, StreamAnswerPayload>;
export type StreamIceMessage = CtrlxEnvelope<CtrlxMessageType.StreamIce, StreamIcePayload>;
export type StreamStatusMessage = CtrlxEnvelope<CtrlxMessageType.StreamStatus, StreamStatusPayload>;

export type PairMessage = PairRequestMessage;
export type PairedMessage = PairSuccessMessage;
export type InputPayload = ScreenInputPayload;
export type InputMessage = ScreenInputMessage;
export type KeyboardMessage = KeyboardInputMessage;
export type PingPayload = HeartbeatPayload;
export type PongPayload = HeartbeatPayload;
export type PingMessage = HeartbeatMessage;
export type PongMessage = HeartbeatMessage;

export type CtrlxClientMessage =
  | HelloMessage
  | PairRequestMessage
  | HeartbeatMessage
  | CommandMessage
  | ScreenInputMessage
  | KeyboardInputMessage
  | StreamRequestMessage
  | StreamAnswerMessage
  | StreamIceMessage;

export type CtrlxHostMessage =
  | PairSuccessMessage
  | HeartbeatMessage
  | AckMessage
  | ResultMessage
  | ErrorMessage
  | StatusMessage
  | StreamOfferMessage
  | StreamIceMessage
  | StreamStatusMessage;

export type CtrlxMessage = CtrlxClientMessage | CtrlxHostMessage;

export type CtrlxValidationSuccess = {
  ok: true;
  message: CtrlxMessage;
  normalizedType: CtrlxMessage["type"];
  legacyType?: string;
  parsed: Record<string, unknown>;
};

export type CtrlxValidationFailure = {
  ok: false;
  reason: string;
  parsed?: unknown;
};

export function createTimestamp(): string {
  return new Date().toISOString();
}

export function isCtrlxCommand(value: unknown): value is CtrlxCommand {
  return typeof value === "string" && Object.values(CtrlxCommand).includes(value as CtrlxCommand);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isCtrlxLogLevel(value: unknown): value is CtrlxLogLevel {
  return value === "info" || value === "success" || value === "warn" || value === "error";
}

function isCtrlxLogSource(value: unknown): value is CtrlxLogSource {
  return (
    value === "host" ||
    value === "client" ||
    value === "ws" ||
    value === "webrtc" ||
    value === "input" ||
    value === "keyboard" ||
    value === "import"
  );
}

export function isCtrlxLogEntry(value: unknown): value is CtrlxLogEntry {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isCtrlxLogLevel(value.level) &&
    isString(value.message) &&
    isString(value.at) &&
    isCtrlxLogSource(value.source) &&
    (!("context" in value) || value.context === undefined || isRecord(value.context))
  );
}

export function isCtrlxLogEntryStatusData(value: unknown): value is CtrlxLogEntryStatusData {
  return isRecord(value) && value.kind === "log_entry" && isCtrlxLogEntry(value.entry);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isScreenInputAction(value: unknown): value is CtrlxScreenInputAction {
  return (
    value === "tap" ||
    value === "double_tap" ||
    value === "pointer_down" ||
    value === "pointer_move" ||
    value === "pointer_up" ||
    value === "gesture_pan" ||
    value === "gesture_zoom" ||
    value === "gesture_region_move"
  );
}

function isGesturePhase(value: unknown): value is CtrlxGesturePhase {
  return value === "start" || value === "move" || value === "end";
}

function isZoomAxis(value: unknown): value is CtrlxZoomAxis {
  return value === "horizontal" || value === "vertical";
}

function isKeyboardInputAction(value: unknown): value is CtrlxKeyboardInputAction {
  return value === "insert_text" || value === "backspace" || value === "enter" || value === "escape";
}

function isAckState(value: unknown): value is CtrlxAckState {
  return value === "received" || value === "mapped" || value === "executed" || value === "failed";
}

function isImportAutomationColor(value: unknown): value is ImportAutomationColor {
  return typeof value === "string" && IMPORT_AUTOMATION_COLORS.includes(value as ImportAutomationColor);
}

function normalizeImportAutomationTrackTarget(input: unknown): ImportAutomationTrackTarget | null {
  if (!isRecord(input) || !isString(input.kind)) {
    return null;
  }

  const expectedCurrentName =
    "expectedCurrentName" in input && input.expectedCurrentName !== undefined
      ? isNullableString(input.expectedCurrentName)
        ? input.expectedCurrentName
        : null
      : undefined;

  if ("expectedCurrentName" in input && input.expectedCurrentName !== undefined && expectedCurrentName === null && input.expectedCurrentName !== null) {
    return null;
  }

  if (input.kind === "selected") {
    return {
      kind: "selected",
      expectedCurrentName
    };
  }

  if (input.kind === "index") {
    if (!isFiniteNumber(input.trackIndex) || !Number.isInteger(input.trackIndex) || input.trackIndex < 1) {
      return null;
    }

    return {
      kind: "index",
      trackIndex: input.trackIndex,
      expectedCurrentName
    };
  }

  if (input.kind === "name") {
    if (!isString(input.trackName)) {
      return null;
    }

    const trackName = input.trackName.trim();
    if (trackName.length === 0) {
      return null;
    }

    return {
      kind: "name",
      trackName,
      expectedCurrentName
    };
  }

  if (input.kind === "batch_slot") {
    if (!isFiniteNumber(input.batchIndex) || !Number.isInteger(input.batchIndex) || input.batchIndex < 0) {
      return null;
    }

    return {
      kind: "batch_slot",
      batchIndex: input.batchIndex,
      expectedCurrentName
    };
  }

  return null;
}

function normalizeRenameTrackCommandInput(input: unknown): RenameTrackCommandInput | null {
  if (!isRecord(input)) {
    return null;
  }

  const target = normalizeImportAutomationTrackTarget(input.target);
  if (!target) {
    return null;
  }

  if (!isString(input.newName)) {
    return null;
  }

  const normalizedNewName = input.newName.trim();
  if (normalizedNewName.length === 0) {
    return null;
  }

  if ("previousName" in input && input.previousName !== undefined && !isNullableString(input.previousName)) {
    return null;
  }

  const previousName =
    "previousName" in input && isNullableString(input.previousName) ? input.previousName : undefined;

  return {
    target,
    newName: normalizedNewName,
    previousName
  };
}

function normalizeSetTrackColorCommandInput(input: unknown): SetTrackColorCommandInput | null {
  if (!isRecord(input)) {
    return null;
  }

  const target = normalizeImportAutomationTrackTarget(input.target);
  if (!target) {
    return null;
  }

  if (!isImportAutomationColor(input.color)) {
    return null;
  }

  if ("previousColor" in input && input.previousColor !== undefined && input.previousColor !== null && !isImportAutomationColor(input.previousColor)) {
    return null;
  }

  const previousColor =
    "previousColor" in input && (isImportAutomationColor(input.previousColor) || input.previousColor === null)
      ? input.previousColor
      : undefined;

  return {
    target,
    color: input.color,
    previousColor
  };
}

function normalizeCreateAudioTrackCommandInput(input: unknown): CreateAudioTrackCommandInput | null {
  if (input === undefined) {
    return {};
  }

  if (!isRecord(input)) {
    return null;
  }

  if ("count" in input && input.count !== undefined) {
    if (!isFiniteNumber(input.count) || !Number.isInteger(input.count) || input.count < 1 || input.count > 128) {
      return null;
    }

    return {
      count: input.count
    };
  }

  return {};
}

function normalizeImportAudioFilesIntoCurrentProjectCommandInput(
  input: unknown
): ImportAudioFilesIntoCurrentProjectCommandInput | null {
  if (!isRecord(input) || !Array.isArray(input.filePaths) || input.filePaths.length === 0) {
    return null;
  }

  const filePaths = input.filePaths
    .map((value) => (isString(value) ? value.trim() : ""))
    .filter((value) => value.length > 0);

  if (filePaths.length !== input.filePaths.length) {
    return null;
  }

  return {
    filePaths
  };
}

function normalizeRequestImportSelectionCommandInput(input: unknown): RequestImportSelectionCommandInput | null {
  if (input === undefined) {
    return {};
  }

  if (!isRecord(input)) {
    return null;
  }

  if ("allowFolders" in input && input.allowFolders !== undefined && typeof input.allowFolders !== "boolean") {
    return null;
  }

  return {
    allowFolders: typeof input.allowFolders === "boolean" ? input.allowFolders : undefined
  };
}

function isImportAutomationCategory(value: unknown): value is ImportAutomationItem["detectedCategory"] {
  return typeof value === "string" && IMPORT_AUTOMATION_CATEGORIES.includes(value as ImportAutomationItem["detectedCategory"]);
}

function isImportAutomationConfidence(value: unknown): value is ImportAutomationConfidence {
  return value === "high" || value === "medium" || value === "low";
}

function normalizeImportAutomationItem(input: unknown): ImportAutomationItem | null {
  if (!isRecord(input)) {
    return null;
  }

  if (!isString(input.originalFilename) || !isString(input.normalizedFilename) || !isString(input.cleanTrackName)) {
    return null;
  }

  const originalFilename = input.originalFilename.trim();
  const normalizedFilename = input.normalizedFilename.trim();
  const cleanTrackName = input.cleanTrackName.trim();

  if (
    originalFilename.length === 0 ||
    normalizedFilename.length === 0 ||
    cleanTrackName.length === 0 ||
    !isImportAutomationCategory(input.detectedCategory) ||
    !isImportAutomationColor(input.assignedColor) ||
    !isImportAutomationConfidence(input.confidence)
  ) {
    return null;
  }

  return {
    originalFilename,
    normalizedFilename,
    detectedCategory: input.detectedCategory,
    cleanTrackName,
    assignedColor: input.assignedColor,
    confidence: input.confidence
  };
}

function normalizeExecuteImportPlanCommandInput(input: unknown): ExecuteImportPlanCommandInput | null {
  if (!isRecord(input) || !isRecord(input.plan) || !Array.isArray(input.plan.items)) {
    return null;
  }

  const importSessionId =
    isString(input.importSessionId) && input.importSessionId.trim().length > 0 ? input.importSessionId.trim() : undefined;
  const folderPath =
    isString(input.folderPath) && input.folderPath.trim().length > 0 ? input.folderPath.trim() : undefined;

  if (!importSessionId && !folderPath) {
    return null;
  }

  const normalizedItems = input.plan.items.map(normalizeImportAutomationItem);
  if (normalizedItems.some((item) => item === null)) {
    return null;
  }

  return {
    importSessionId,
    folderPath,
    plan: {
      source: "import_automation",
      items: normalizedItems as ImportAutomationItem[],
      executableItems: [],
      suggestionActions: []
    }
  };
}

function toCanonicalType(type: string): { type: string; legacyType?: string } {
  switch (type) {
    case CtrlxMessageType.Pair:
      return { type: CtrlxMessageType.PairRequest, legacyType: type };
    case CtrlxMessageType.Paired:
      return { type: CtrlxMessageType.PairSuccess, legacyType: type };
    case CtrlxMessageType.Input:
      return { type: CtrlxMessageType.ScreenInput, legacyType: type };
    case CtrlxMessageType.Ping:
    case CtrlxMessageType.Pong:
      return { type: CtrlxMessageType.Heartbeat, legacyType: type };
    default:
      return { type };
  }
}

function normalizeScreenInputPayload(payload: unknown): ScreenInputPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const action = payload.action === "click" ? "tap" : payload.action;
  if (!isScreenInputAction(action)) {
    return null;
  }

  const xNorm = isFiniteNumber(payload.xNorm) ? payload.xNorm : payload.x;
  const yNorm = isFiniteNumber(payload.yNorm) ? payload.yNorm : payload.y;
  if (!isFiniteNumber(xNorm) || !isFiniteNumber(yNorm)) {
    return null;
  }

  if (!isFiniteNumber(payload.viewerWidth) || !isFiniteNumber(payload.viewerHeight) || !isFiniteNumber(payload.timestamp)) {
    return null;
  }

  const pointerType =
    payload.pointerType === undefined ||
    payload.pointerType === "touch" ||
    payload.pointerType === "mouse" ||
    payload.pointerType === "pen"
      ? payload.pointerType
      : undefined;

  const deltaX = payload.deltaX;
  const deltaY = payload.deltaY;
  const zoomDelta = payload.zoomDelta;
  const gesturePhase = payload.gesturePhase;
  const zoomAxis = payload.zoomAxis;

  if (action === "gesture_pan") {
    if (!isFiniteNumber(deltaX) || !isFiniteNumber(deltaY)) {
      return null;
    }
  }

  if (action === "gesture_zoom") {
    if (!isFiniteNumber(zoomDelta) || !isZoomAxis(zoomAxis)) {
      return null;
    }
  }

  if (action === "gesture_region_move") {
    if (!isGesturePhase(gesturePhase)) {
      return null;
    }
  }

  return {
    action,
    xNorm,
    yNorm,
    viewerWidth: payload.viewerWidth,
    viewerHeight: payload.viewerHeight,
    timestamp: payload.timestamp,
    pointerType,
    gesturePhase: isGesturePhase(gesturePhase) ? gesturePhase : undefined,
    zoomAxis: isZoomAxis(zoomAxis) ? zoomAxis : undefined,
    deltaX: isFiniteNumber(deltaX) ? deltaX : undefined,
    deltaY: isFiniteNumber(deltaY) ? deltaY : undefined,
    zoomDelta: isFiniteNumber(zoomDelta) ? zoomDelta : undefined
  };
}

function normalizeKeyboardInputPayload(payload: unknown): KeyboardInputPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const action = payload.action === "submit_text" ? "insert_text" : payload.action;
  if (!isKeyboardInputAction(action)) {
    return null;
  }

  if (!isFiniteNumber(payload.timestamp)) {
    return null;
  }

  if ("text" in payload && payload.text !== undefined && !isString(payload.text)) {
    return null;
  }

  if (action === "insert_text" && (!isString(payload.text) || payload.text.length === 0)) {
    return null;
  }

  return {
    action,
    text: isString(payload.text) ? payload.text : undefined,
    timestamp: payload.timestamp
  };
}

function normalizeCandidate(message: Record<string, unknown>): Record<string, unknown> {
  const typeInfo = isString(message.type) ? toCanonicalType(message.type) : { type: message.type };
  if (typeInfo.type === CtrlxMessageType.ScreenInput) {
    const payload = normalizeScreenInputPayload(message.payload);
    return {
      ...message,
      type: typeInfo.type,
      payload: payload ?? message.payload
    };
  }

  if (typeInfo.type === CtrlxMessageType.KeyboardInput) {
    const payload = normalizeKeyboardInputPayload(message.payload);
    return {
      ...message,
      type: typeInfo.type,
      payload: payload ?? message.payload
    };
  }

  if (typeInfo.type === CtrlxMessageType.Heartbeat && isRecord(message.payload)) {
    return {
      ...message,
      type: typeInfo.type,
      payload: {
        ...message.payload,
        role:
          message.payload.role === "client" || message.payload.role === "host" ? message.payload.role : undefined
      }
    };
  }

  return {
    ...message,
    type: typeInfo.type
  };
}

function normalizeAckPayload(payload: unknown): AckPayload | null {
  if (!isRecord(payload)) {
    return null;
  }

  const ok = typeof payload.ok === "boolean" ? payload.ok : true;
  const state = isAckState(payload.state) ? payload.state : ok ? "received" : "failed";

  if ("ackFor" in payload && payload.ackFor !== undefined && !isString(payload.ackFor)) {
    return null;
  }

  if ("message" in payload && payload.message !== undefined && !isString(payload.message)) {
    return null;
  }

  if ("reason" in payload && payload.reason !== undefined && !isString(payload.reason)) {
    return null;
  }

  if ("data" in payload && payload.data !== undefined && !isRecord(payload.data)) {
    return null;
  }

  return {
    ok,
    state,
    ackFor: isString(payload.ackFor) ? payload.ackFor : undefined,
    message: isString(payload.message) ? payload.message : undefined,
    reason: isString(payload.reason) ? payload.reason : undefined,
    data: isRecord(payload.data) ? payload.data : undefined
  };
}

function validateRequiredEnvelope(candidate: Record<string, unknown>): CtrlxValidationFailure | null {
  if (!isString(candidate.type)) {
    return { ok: false, reason: "Missing or non-string message.type.", parsed: candidate };
  }

  if (!isString(candidate.sentAt)) {
    return { ok: false, reason: "Missing or non-string message.sentAt.", parsed: candidate };
  }

  if ("requestId" in candidate && candidate.requestId !== undefined && !isString(candidate.requestId)) {
    return { ok: false, reason: "message.requestId must be a string when present.", parsed: candidate };
  }

  if ("sessionCode" in candidate && candidate.sessionCode !== undefined && !isString(candidate.sessionCode)) {
    return { ok: false, reason: "message.sessionCode must be a string when present.", parsed: candidate };
  }

  if (!("payload" in candidate)) {
    return { ok: false, reason: "Missing message.payload.", parsed: candidate };
  }

  return null;
}

function normalizeCommandPayload(payload: unknown): CommandPayload | null {
  if (!isRecord(payload) || !isCtrlxCommand(payload.command)) {
    return null;
  }

  if (payload.command === CtrlxCommand.RenameTrack) {
    const input = normalizeRenameTrackCommandInput(payload.input);
    if (!input) {
      return null;
    }

    return {
      command: CtrlxCommand.RenameTrack,
      input
    };
  }

  if (payload.command === CtrlxCommand.SetTrackColor) {
    const input = normalizeSetTrackColorCommandInput(payload.input);
    if (!input) {
      return null;
    }

    return {
      command: CtrlxCommand.SetTrackColor,
      input
    };
  }

  if (payload.command === CtrlxCommand.CreateAudioTrack) {
    const input = normalizeCreateAudioTrackCommandInput(payload.input);
    if (!input) {
      return null;
    }

    return {
      command: CtrlxCommand.CreateAudioTrack,
      input
    };
  }

  if (payload.command === CtrlxCommand.ImportAudioFilesIntoCurrentProject) {
    const input = normalizeImportAudioFilesIntoCurrentProjectCommandInput(payload.input);
    if (!input) {
      return null;
    }

    return {
      command: CtrlxCommand.ImportAudioFilesIntoCurrentProject,
      input
    };
  }

  if (payload.command === CtrlxCommand.RequestImportSelection) {
    const input = normalizeRequestImportSelectionCommandInput(payload.input);
    if (!input) {
      return null;
    }

    return {
      command: CtrlxCommand.RequestImportSelection,
      input
    };
  }

  if (payload.command === CtrlxCommand.ExecuteImportPlan) {
    const input = normalizeExecuteImportPlanCommandInput(payload.input);
    if (!input) {
      return null;
    }

    return {
      command: CtrlxCommand.ExecuteImportPlan,
      input
    };
  }

  return { command: payload.command } as CommandPayload;
}

export function validateCtrlxMessage(value: unknown): CtrlxValidationSuccess | CtrlxValidationFailure {
  if (!isRecord(value)) {
    return { ok: false, reason: "Incoming value is not an object.", parsed: value };
  }

  const requiredFailure = validateRequiredEnvelope(value);
  if (requiredFailure) {
    return requiredFailure;
  }

  const candidate = normalizeCandidate(value);
  const { type } = candidate;
  const legacyType = isString(value.type) && value.type !== type ? value.type : undefined;

  switch (type) {
    case CtrlxMessageType.Hello:
      if (!isRecord(candidate.payload)) {
        return { ok: false, reason: "hello.payload must be an object.", parsed: candidate };
      }
      if (!isString(candidate.payload.protocolVersion)) {
        return { ok: false, reason: "hello.payload.protocolVersion must be a string.", parsed: candidate };
      }
      if (candidate.payload.role !== "client" && candidate.payload.role !== "host") {
        return { ok: false, reason: "hello.payload.role must be 'client' or 'host'.", parsed: candidate };
      }
      break;
    case CtrlxMessageType.PairRequest:
      if (!isRecord(candidate.payload) || !isString(candidate.payload.sessionCode)) {
        return { ok: false, reason: "pair_request.payload.sessionCode must be a string.", parsed: candidate };
      }
      if ("clientName" in candidate.payload && candidate.payload.clientName !== undefined && !isString(candidate.payload.clientName)) {
        return { ok: false, reason: "pair_request.payload.clientName must be a string when present.", parsed: candidate };
      }
      break;
    case CtrlxMessageType.PairSuccess:
      if (!isRecord(candidate.payload)) {
        return { ok: false, reason: "pair_success.payload must be an object.", parsed: candidate };
      }
      if (!isString(candidate.payload.sessionCode)) {
        return { ok: false, reason: "pair_success.payload.sessionCode must be a string.", parsed: candidate };
      }
      if (!isString(candidate.payload.hostName)) {
        return { ok: false, reason: "pair_success.payload.hostName must be a string.", parsed: candidate };
      }
      if (candidate.payload.connectionState !== "paired") {
        return { ok: false, reason: "pair_success.payload.connectionState must be 'paired'.", parsed: candidate };
      }
      break;
    case CtrlxMessageType.Heartbeat:
      if (!isRecord(candidate.payload) || !isString(candidate.payload.nonce)) {
        return { ok: false, reason: "heartbeat.payload.nonce must be a string.", parsed: candidate };
      }
      if ("role" in candidate.payload && candidate.payload.role !== undefined && candidate.payload.role !== "client" && candidate.payload.role !== "host") {
        return { ok: false, reason: "heartbeat.payload.role must be 'client' or 'host' when present.", parsed: candidate };
      }
      break;
    case CtrlxMessageType.Command:
      {
        const payload = normalizeCommandPayload(candidate.payload);
        if (!payload) {
          return { ok: false, reason: "command.payload.command is missing or not recognized.", parsed: candidate };
        }
        candidate.payload = payload;
      }
      break;
    case CtrlxMessageType.ScreenInput: {
      const payload = normalizeScreenInputPayload(candidate.payload);
      if (!payload) {
        return {
          ok: false,
          reason: "screen_input.payload must contain a valid action plus coordinates/dimensions/timestamp, and any required gesture deltas.",
          parsed: candidate
        };
      }
      candidate.payload = payload;
      break;
    }
    case CtrlxMessageType.KeyboardInput: {
      const payload = normalizeKeyboardInputPayload(candidate.payload);
      if (!payload) {
        return {
          ok: false,
          reason: "keyboard_input.payload must contain a valid action, optional text, and timestamp.",
          parsed: candidate
        };
      }
      candidate.payload = payload;
      break;
    }
    case CtrlxMessageType.Ack:
      if (!normalizeAckPayload(candidate.payload)) {
        return { ok: false, reason: "ack.payload must contain a valid ack state and optional metadata.", parsed: candidate };
      }
      candidate.payload = normalizeAckPayload(candidate.payload);
      break;
    case CtrlxMessageType.Result:
      if (!isRecord(candidate.payload) || candidate.payload.ok !== true || !isString(candidate.payload.message)) {
        return { ok: false, reason: "result.payload must be a successful result object.", parsed: candidate };
      }
      break;
    case CtrlxMessageType.Error:
      if (!isRecord(candidate.payload) || candidate.payload.ok !== false || !isString(candidate.payload.message)) {
        return { ok: false, reason: "error.payload must be an error object.", parsed: candidate };
      }
      break;
    case CtrlxMessageType.Status:
      if (!isRecord(candidate.payload)) {
        return { ok: false, reason: "status.payload must be an object.", parsed: candidate };
      }
      if (
        candidate.payload.connectionState !== "idle" &&
        candidate.payload.connectionState !== "waiting" &&
        candidate.payload.connectionState !== "paired" &&
        candidate.payload.connectionState !== "busy" &&
        candidate.payload.connectionState !== "error"
      ) {
        return { ok: false, reason: "status.payload.connectionState is invalid.", parsed: candidate };
      }
      break;
    case CtrlxMessageType.StreamRequest:
      if (!isRecord(candidate.payload) || (candidate.payload.action !== "start" && candidate.payload.action !== "stop")) {
        return { ok: false, reason: "stream_request.payload.action must be 'start' or 'stop'.", parsed: candidate };
      }
      break;
    case CtrlxMessageType.StreamOffer:
      if (!isRecord(candidate.payload) || !isString(candidate.payload.sdp) || candidate.payload.type !== "offer") {
        return { ok: false, reason: "stream_offer payload is invalid.", parsed: candidate };
      }
      break;
    case CtrlxMessageType.StreamAnswer:
      if (!isRecord(candidate.payload) || !isString(candidate.payload.sdp) || candidate.payload.type !== "answer") {
        return { ok: false, reason: "stream_answer payload is invalid.", parsed: candidate };
      }
      break;
    case CtrlxMessageType.StreamIce:
      if (
        !isRecord(candidate.payload) ||
        !isString(candidate.payload.candidate) ||
        !isNullableString(candidate.payload.sdpMid) ||
        !isNullableNumber(candidate.payload.sdpMLineIndex)
      ) {
        return { ok: false, reason: "stream_ice payload is invalid.", parsed: candidate };
      }
      break;
    case CtrlxMessageType.StreamStatus:
      if (
        !isRecord(candidate.payload) ||
        (candidate.payload.state !== "idle" &&
          candidate.payload.state !== "requesting" &&
          candidate.payload.state !== "signaling" &&
          candidate.payload.state !== "streaming" &&
          candidate.payload.state !== "stopped" &&
          candidate.payload.state !== "error")
      ) {
        return { ok: false, reason: "stream_status payload is invalid.", parsed: candidate };
      }
      break;
    default:
      return { ok: false, reason: `Unsupported message type '${String(type)}'.`, parsed: candidate };
  }

  return {
    ok: true,
    message: candidate as CtrlxMessage,
    normalizedType: candidate.type as CtrlxMessage["type"],
    legacyType,
    parsed: candidate
  };
}

export function parseCtrlxMessage(raw: string): CtrlxValidationSuccess | CtrlxValidationFailure {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return validateCtrlxMessage(parsed);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON.",
      parsed: undefined
    };
  }
}

export function isCtrlxMessage(value: unknown): value is CtrlxMessage {
  return validateCtrlxMessage(value).ok;
}
