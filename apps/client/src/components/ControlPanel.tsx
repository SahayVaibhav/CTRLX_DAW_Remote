import { memo, useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject, type TouchEvent } from "react";
import {
  CtrlxCommand,
  getAssignableCtrlxCommandCatalog,
  getCtrlxGestureBindings,
  type AssignableCtrlxCommandCatalogEntry
} from "@ctrlx/protocol";
import {
  getDisplayedMediaRect,
  type ViewerInputHandler,
  type ViewerInputPayload,
  type DisplayedMediaLayout
} from "../inputHandler";

const CLIENT_EXPERIMENTAL_DRAG =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.experimentalDrag") === "1";
const CLIENT_DEBUG_CURSOR_MOVE =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugCursorMove") === "1";
const DEBUG_FULLSCREEN_VIEWER =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugFullscreen") === "1";
const DEBUG_MOVE_DIAGNOSTICS =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugMoveDiagnostics") === "1";
const DEBUG_RENDER_DIAGNOSTICS =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugRenders") === "1";
const DEBUG_GESTURE_DIAGNOSTICS =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugGestures") === "1";
const POINTER_MOVE_SAMPLE_MS = 16;
const POINTER_MOVE_MIN_DELTA = 0.0012;
const GESTURE_FRAME_MS = 16;
const TWO_FINGER_GESTURE_LOCK_MIN_DISTANCE_PX = 10;
const TWO_FINGER_GESTURE_LOCK_DOMINANCE_RATIO = 1.35;
const PINCH_AXIS_DOMINANCE_RATIO = 1.2;
const PAN_GESTURE_MIN_DELTA_PX = 6;
const PINCH_GESTURE_STEP_PX = 18;
const REGION_MOVE_HOLD_MS = 180;
const REGION_MOVE_STABILITY_PX = 10;
const REGION_MOVE_START_PX = 12;
const LONG_PRESS_REGION_MOVE_HOLD_MS = 380;
const LONG_PRESS_REGION_MOVE_CANCEL_PX = 14;
const LONG_PRESS_REGION_MOVE_MIN_DELTA_PX = 4;
const COMMAND_PAD_STORAGE_KEY = "ctrlx.commandPadAssignments";
const COMMAND_PAD_SLOT_COUNT = 10;

function useDevRenderDiagnostics(name: string, tracked: Record<string, unknown>): void {
  const previousTrackedRef = useRef<Record<string, unknown> | null>(null);
  const renderCountRef = useRef(0);

  renderCountRef.current += 1;

  useEffect(() => {
    if (!DEBUG_RENDER_DIAGNOSTICS) {
      return;
    }

    const previous = previousTrackedRef.current;
    const changedKeys = previous
      ? Object.keys(tracked).filter((key) => !Object.is(previous[key], tracked[key]))
      : Object.keys(tracked);

    console.debug(`[CTRLX render] ${name}`, {
      renderCount: renderCountRef.current,
      changedKeys,
      tracked
    });

    previousTrackedRef.current = tracked;
  });
}

type InputAckDebugState = {
  requestId: string;
  state: "sent" | "received" | "mapped" | "executed" | "failed";
  message: string;
  ok: boolean;
  at: number;
};

type MoveLatencyDiagnostic = {
  requestId: string;
  clientEventTimestamp: number;
  clientSendTimestamp: number;
  hostReceiveTimestamp: number | null;
  hostExecuteStartTimestamp: number | null;
  hostExecuteTimestamp: number | null;
  roundTripMs: number | null;
  hostQueueMs: number | null;
  hostExecuteMs: number | null;
  ackState: "received" | "mapped" | "executed" | "failed";
};

type MoveDiagnosticsRuntime = {
  transportDeferred: number;
  transportReplaced: number;
  transportFlushed: number;
  executedMoves: number;
  staleSkippedMoves: number;
};

type MoveDiagnosticsHud = {
  pointerEventRate: number;
  sentMoveRate: number;
  droppedMoves: number;
  coalescedMoves: number;
  throttledFrames: number;
  pointerModeActive: boolean;
  touchModeActive: boolean;
  fullscreenActive: boolean;
  mediaRectCached: boolean;
  coalescingActive: boolean;
};

type PendingMoveSource =
  | {
      kind: "pointer";
      pointerId: number;
    }
  | {
      kind: "touch";
      identifier: number;
    };

type TwoFingerGestureState = {
  identifiers: [number, number];
  layout: DisplayedMediaLayout | null;
  lastCenterX: number;
  lastCenterY: number;
  lastDistance: number;
  lastSpreadX: number;
  lastSpreadY: number;
  mode: "pending" | "pan" | "pinch" | "region_move_ready" | "region_move";
  pinchAxis: "pending" | "horizontal" | "vertical";
  holdStartedAt: number;
  maxPanMagnitude: number;
  maxPinchMagnitude: number;
  lockTravelPan: number;
  lockTravelPinch: number;
  pendingPanX: number;
  pendingPanY: number;
  pendingZoomDistancePx: number;
  pendingZoomSteps: number;
  lastSentAt: number;
};

type LongPressRegionMoveCandidate = {
  identifier: number;
  layout: DisplayedMediaLayout | null;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  timer: number;
};

type LongPressRegionMoveState = {
  identifier: number;
  layout: DisplayedMediaLayout | null;
  currentX: number;
  currentY: number;
  lastSentX: number;
  lastSentY: number;
  lastSentAt: number;
  pendingMove: boolean;
};

function logGestureDiagnostics(event: string, data?: Record<string, unknown>): void {
  if (!DEBUG_GESTURE_DIAGNOSTICS) {
    return;
  }

  console.debug(`[CTRLX gesture] ${event}`, data ?? {});
}

type ControlPanelProps = {
  onCommand: (command: CtrlxCommand) => void;
  isConnected: boolean;
  onToggleStream: () => void;
  onFullscreen: () => void;
  onExitFullscreen: () => void;
  isScreenVisible: boolean;
  isStreaming: boolean;
  isStreamConnecting: boolean;
  isViewerFullscreen: boolean;
  isViewerSoftFullscreen: boolean;
  isFullscreenKeyboardOverlayOpen: boolean;
  viewerMode: "normal_mode" | "fullscreen_view_mode" | "keyboard_input_mode";
  streamStatus: string;
  audioStatus: string;
  hasAudioStream: boolean;
  isAudioMuted: boolean;
  audioVolume: number;
  onToggleMute: () => void;
  onVolumeChange: (value: number) => void;
  onViewerInput: (payload: ViewerInputPayload) => void;
  onOpenKeyboardInputMode: () => void;
  onCloseKeyboardInputMode: () => void;
  onKeyboardDraftChange: (nextText: string, immediate?: boolean) => void;
  onKeyboardSubmit: (text: string) => void;
  onKeyboardEnter: () => void;
  inputAckStatus: InputAckDebugState | null;
  moveLatencyDiagnostic: MoveLatencyDiagnostic | null;
  moveDiagnosticsRuntime: MoveDiagnosticsRuntime | null;
  inputHandler: ViewerInputHandler;
  viewerContainerRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
};

type CommandIconProps = {
  className?: string;
};

function OpenLogicIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M5 19.25V7.5a1.75 1.75 0 0 1 1.75-1.75h7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 9h8.25A1.75 1.75 0 0 1 20 10.75v7.5A1.75 1.75 0 0 1 18.25 20h-7.5A1.75 1.75 0 0 1 9 18.25V10" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 4h6v6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m12.5 11.5 7.5-7.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PlayStopIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M6.5 6.75v10.5a.75.75 0 0 0 1.16.63l8-5.25a.75.75 0 0 0 0-1.26l-8-5.25a.75.75 0 0 0-1.16.63Z" fill="currentColor" stroke="none" />
      <rect x="17.25" y="7.25" width="3" height="9.5" rx="0.8" />
    </svg>
  );
}

function SaveIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M6.5 4.75h8.1c.46 0 .9.18 1.23.51l2.91 2.91c.33.33.51.77.51 1.23v8.85A1.75 1.75 0 0 1 17.5 20h-11A1.75 1.75 0 0 1 4.75 18.25V6.5A1.75 1.75 0 0 1 6.5 4.75Z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 4.75v4.5a.75.75 0 0 0 .75.75h5.5a.75.75 0 0 0 .75-.75V5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 19v-4.25A1.75 1.75 0 0 1 9.75 13h4.5A1.75 1.75 0 0 1 16 14.75V19" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UndoIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M8 8 4.75 11.25 8 14.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.25 11.25h8a5.5 5.5 0 1 1 0 11h-1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ZoomInHorizontalIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M4.5 12h10" strokeLinecap="round" />
      <path d="M11 8.5 14.5 12 11 15.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 8.5v7" strokeLinecap="round" />
      <path d="M20.5 12h-5" strokeLinecap="round" />
    </svg>
  );
}

function ZoomOutHorizontalIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M19.5 12h-10" strokeLinecap="round" />
      <path d="M13 8.5 9.5 12 13 15.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 8.5v7" strokeLinecap="round" />
      <path d="M3.5 12h5" strokeLinecap="round" />
    </svg>
  );
}

function ZoomInVerticalIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M12 19.5v-10" strokeLinecap="round" />
      <path d="M8.5 13 12 9.5 15.5 13" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 6h7" strokeLinecap="round" />
      <path d="M12 3.5v5" strokeLinecap="round" />
    </svg>
  );
}

function ZoomOutVerticalIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M12 4.5v10" strokeLinecap="round" />
      <path d="m8.5 11 3.5 3.5 3.5-3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.5 18h7" strokeLinecap="round" />
      <path d="M12 20.5v-5" strokeLinecap="round" />
    </svg>
  );
}

function OpenEditorIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <rect x="4.75" y="5.25" width="14.5" height="13.5" rx="2" />
      <path d="M8 9h8M8 12h5.5M8 15h4" strokeLinecap="round" />
      <path d="m14.5 4.75 1.75-1.75" strokeLinecap="round" />
    </svg>
  );
}

function MuteIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M5 9.75h3.25L12.5 6v12l-4.25-3.75H5z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m16.25 9.25 3.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="m19.75 9.25-3.5 5.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SoloIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="M16.5 6.5h-5A2.75 2.75 0 0 0 8.75 9c0 1.52 1.23 2.75 2.75 2.75h1A2.75 2.75 0 0 1 15.25 14c0 1.52-1.23 2.75-2.75 2.75h-5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18 6v12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArmIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="5.25" />
      <circle cx="12" cy="12" r="2.25" fill="currentColor" stroke="none" />
      <path d="M12 3.5v1.75M12 18.75v1.75M20.5 12h-1.75M5.25 12H3.5" strokeLinecap="round" />
    </svg>
  );
}

type ControlDefinition = AssignableCtrlxCommandCatalogEntry & {
  accent?: boolean;
  tone: string;
  summary: string;
  Icon: (props: CommandIconProps) => React.JSX.Element;
};

type CommandPadSlot = {
  slot: number;
  control: ControlDefinition | null;
};

type CommandPadAssignment = CtrlxCommand | null;

function PlaceholderIcon({ className = "h-6 w-6" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="3" strokeDasharray="2.5 2.5" />
      <path d="M12 8.5v7M8.5 12h7" strokeLinecap="round" />
    </svg>
  );
}

const controlPresentation: Record<
  ControlDefinition["iconKey"],
  Pick<ControlDefinition, "tone" | "summary" | "Icon" | "accent">
> = {
  logic: {
    tone: "from-sky-300/22 via-cyan-300/16 to-transparent",
    summary: "Session",
    Icon: OpenLogicIcon,
    accent: true
  },
  play_stop: {
    tone: "from-emerald-300/24 via-teal-300/14 to-transparent",
    summary: "Transport",
    Icon: PlayStopIcon,
    accent: true
  },
  save: {
    tone: "from-amber-300/20 via-orange-300/12 to-transparent",
    summary: "Session",
    Icon: SaveIcon
  },
  undo: {
    tone: "from-fuchsia-300/18 via-pink-300/12 to-transparent",
    summary: "History",
    Icon: UndoIcon
  },
  zoom_in_horizontal: {
    tone: "from-emerald-300/20 via-lime-300/10 to-transparent",
    summary: "Zoom",
    Icon: ZoomInHorizontalIcon
  },
  zoom_out_horizontal: {
    tone: "from-teal-300/20 via-cyan-300/10 to-transparent",
    summary: "Zoom",
    Icon: ZoomOutHorizontalIcon
  },
  zoom_in_vertical: {
    tone: "from-sky-300/18 via-blue-300/10 to-transparent",
    summary: "Zoom",
    Icon: ZoomInVerticalIcon
  },
  zoom_out_vertical: {
    tone: "from-indigo-300/18 via-violet-300/10 to-transparent",
    summary: "Zoom",
    Icon: ZoomOutVerticalIcon
  },
  open_editor: {
    tone: "from-rose-300/18 via-pink-300/10 to-transparent",
    summary: "Editor",
    Icon: OpenEditorIcon
  },
  mute: {
    tone: "from-slate-200/16 via-slate-200/8 to-transparent",
    summary: "Track",
    Icon: MuteIcon
  },
  solo: {
    tone: "from-violet-300/20 via-indigo-300/12 to-transparent",
    summary: "Track",
    Icon: SoloIcon
  },
  arm: {
    tone: "from-rose-300/22 via-red-300/14 to-transparent",
    summary: "Record",
    Icon: ArmIcon
  }
};

const commandCatalog: ControlDefinition[] = getAssignableCtrlxCommandCatalog().map((command) => ({
  ...command,
  ...controlPresentation[command.iconKey]
}));

const gestureBindingById = new Map(getCtrlxGestureBindings().map((binding) => [binding.gesture, binding] as const));
const commandCatalogById = new Map(commandCatalog.map((command) => [command.id, command] as const));
const assignableCommandIds = new Set(commandCatalog.map((command) => command.id));
const DEFAULT_COMMAND_PAD_ASSIGNMENTS: CommandPadAssignment[] = Array.from(
  { length: COMMAND_PAD_SLOT_COUNT },
  (_, index) => commandCatalog[index]?.id ?? null
);

type DebugMarker = {
  id: string;
  xNorm: number;
  yNorm: number;
};

function EditIcon({ className = "h-4 w-4" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="m15 5 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 18.25h3.2L19 8.45a1.7 1.7 0 0 0 0-2.4l-1.05-1.05a1.7 1.7 0 0 0-2.4 0L5.75 14.8V18.25Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon({ className = "h-4 w-4" }: CommandIconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden="true">
      <path d="m7 7 10 10M17 7 7 17" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function normalizeCommandPadAssignments(raw: unknown): CommandPadAssignment[] {
  if (!Array.isArray(raw)) {
    return [...DEFAULT_COMMAND_PAD_ASSIGNMENTS];
  }

  return Array.from({ length: COMMAND_PAD_SLOT_COUNT }, (_, index) => {
    const value = raw[index];
    return typeof value === "string" && assignableCommandIds.has(value as CtrlxCommand)
      ? (value as CtrlxCommand)
      : null;
  });
}

function loadCommandPadAssignments(): CommandPadAssignment[] {
  if (typeof window === "undefined") {
    return [...DEFAULT_COMMAND_PAD_ASSIGNMENTS];
  }

  try {
    const stored = window.localStorage.getItem(COMMAND_PAD_STORAGE_KEY);
    if (!stored) {
      return [...DEFAULT_COMMAND_PAD_ASSIGNMENTS];
    }

    return normalizeCommandPadAssignments(JSON.parse(stored));
  } catch {
    return [...DEFAULT_COMMAND_PAD_ASSIGNMENTS];
  }
}

type LiveViewerSectionProps = {
  viewerContainerRef: RefObject<HTMLDivElement | null>;
  videoRef: RefObject<HTMLVideoElement | null>;
  inputHandler: ViewerInputHandler;
  isScreenVisible: boolean;
  isStreaming: boolean;
  isStreamConnecting: boolean;
  isViewerFullscreen: boolean;
  isViewerSoftFullscreen: boolean;
  streamStatus: string;
  inputAckStatus: InputAckDebugState | null;
  moveLatencyDiagnostic: MoveLatencyDiagnostic | null;
  moveDiagnosticsRuntime: MoveDiagnosticsRuntime | null;
  onFullscreen: () => void;
  onExitFullscreen: () => void;
  onViewerInput: (payload: ViewerInputPayload) => void;
  onOpenKeyboardInputMode: () => void;
};

const LiveViewerSection = memo(function LiveViewerSection({
  viewerContainerRef,
  videoRef,
  inputHandler,
  isScreenVisible,
  isStreaming,
  isStreamConnecting,
  isViewerFullscreen,
  isViewerSoftFullscreen,
  streamStatus,
  inputAckStatus,
  moveLatencyDiagnostic,
  moveDiagnosticsRuntime,
  onExitFullscreen,
  onViewerInput,
  onOpenKeyboardInputMode
}: LiveViewerSectionProps) {
  const pointerActiveRef = useRef(false);
  const [debugMarkers, setDebugMarkers] = useState<DebugMarker[]>([]);
  const [moveDiagnosticsHud, setMoveDiagnosticsHud] = useState<MoveDiagnosticsHud | null>(null);
  const lastPointerMoveSentAtRef = useRef(0);
  const lastSentPointerMoveRef = useRef<ViewerInputPayload | null>(null);
  const pendingPointerMoveSourceRef = useRef<PendingMoveSource | null>(null);
  const pointerMoveFrameRef = useRef<number | null>(null);
  const cursorDebugOverlayRef = useRef<HTMLDivElement | null>(null);
  const moveEventCountRef = useRef(0);
  const moveSentCountRef = useRef(0);
  const moveDroppedCountRef = useRef(0);
  const moveCoalescedCountRef = useRef(0);
  const throttledFrameCountRef = useRef(0);
  const functionIdentityRef = useRef<{
    emitViewerInput?: (payload: ViewerInputPayload | null) => void;
    flushPointerMove?: (frameTime: number) => void;
    schedulePointerMove?: (source: PendingMoveSource | null) => void;
  }>({});

  const addDebugMarker = useCallback((payload: ViewerInputPayload): void => {
    if (!import.meta.env.DEV) {
      return;
    }

    if (payload.action !== "tap" && payload.action !== "double_tap") {
      return;
    }

    const marker: DebugMarker = {
      id: `${payload.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      xNorm: payload.xNorm,
      yNorm: payload.yNorm
    };

    setDebugMarkers((current) => [...current, marker].slice(-6));
    window.setTimeout(() => {
      setDebugMarkers((current) => current.filter((entry) => entry.id !== marker.id));
    }, 480);
  }, []);

  const emitViewerInput = useCallback(
    (payload: ViewerInputPayload | null): void => {
      if (!payload) {
        return;
      }

      addDebugMarker(payload);
      onViewerInput(payload);
    },
    [addDebugMarker, onViewerInput]
  );

  const flushPointerMove = useCallback(
    (frameTime: number): void => {
      pointerMoveFrameRef.current = null;

      const video = videoRef.current;
      const pendingSource = pendingPointerMoveSourceRef.current;
      if (!video || !pendingSource) {
        return;
      }

      const elapsed = frameTime - lastPointerMoveSentAtRef.current;
      if (elapsed < POINTER_MOVE_SAMPLE_MS) {
        if (DEBUG_MOVE_DIAGNOSTICS) {
          throttledFrameCountRef.current += 1;
        }
        pointerMoveFrameRef.current = window.requestAnimationFrame(flushPointerMove);
        return;
      }

      const payload =
        pendingSource.kind === "pointer"
          ? inputHandler.buildPointerMovePayload(video, pendingSource.pointerId, isViewerFullscreen)
          : inputHandler.buildTouchMovePayload(video, pendingSource.identifier, isViewerFullscreen);

      pendingPointerMoveSourceRef.current = null;
      if (!payload) {
        if (pendingPointerMoveSourceRef.current) {
          pointerMoveFrameRef.current = window.requestAnimationFrame(flushPointerMove);
        }
        return;
      }

      lastPointerMoveSentAtRef.current = frameTime;
      lastSentPointerMoveRef.current = payload;
      if (DEBUG_MOVE_DIAGNOSTICS) {
        moveSentCountRef.current += 1;
      }

      if (CLIENT_DEBUG_CURSOR_MOVE && cursorDebugOverlayRef.current) {
        cursorDebugOverlayRef.current.style.left = `${payload.xNorm * 100}%`;
        cursorDebugOverlayRef.current.style.top = `${payload.yNorm * 100}%`;
        cursorDebugOverlayRef.current.style.opacity = "1";
      }

      emitViewerInput(payload);

      if (pendingPointerMoveSourceRef.current) {
        pointerMoveFrameRef.current = window.requestAnimationFrame(flushPointerMove);
      }
    },
    [emitViewerInput, inputHandler, isViewerFullscreen, videoRef]
  );

  const schedulePointerMove = useCallback(
    (source: PendingMoveSource | null): void => {
      if (!source) {
        return;
      }

      const video = videoRef.current;
      if (!video) {
        return;
      }

      const candidatePayload =
        source.kind === "pointer"
          ? inputHandler.buildPointerMovePayload(video, source.pointerId, isViewerFullscreen)
          : inputHandler.buildTouchMovePayload(video, source.identifier, isViewerFullscreen);

      if (!candidatePayload) {
        return;
      }

      const previousPayload =
        (pendingPointerMoveSourceRef.current
          ? pendingPointerMoveSourceRef.current.kind === "pointer"
            ? inputHandler.buildPointerMovePayload(video, pendingPointerMoveSourceRef.current.pointerId, isViewerFullscreen)
            : inputHandler.buildTouchMovePayload(video, pendingPointerMoveSourceRef.current.identifier, isViewerFullscreen)
          : null) ?? lastSentPointerMoveRef.current;

      if (previousPayload) {
        const deltaX = Math.abs(previousPayload.xNorm - candidatePayload.xNorm);
        const deltaY = Math.abs(previousPayload.yNorm - candidatePayload.yNorm);
        if (deltaX < POINTER_MOVE_MIN_DELTA && deltaY < POINTER_MOVE_MIN_DELTA) {
          if (DEBUG_MOVE_DIAGNOSTICS) {
            moveDroppedCountRef.current += 1;
          }
          return;
        }
      }

      if (DEBUG_MOVE_DIAGNOSTICS && pendingPointerMoveSourceRef.current) {
        moveCoalescedCountRef.current += 1;
      }
      pendingPointerMoveSourceRef.current = source;

      if (pointerMoveFrameRef.current !== null) {
        return;
      }

      pointerMoveFrameRef.current = window.requestAnimationFrame(flushPointerMove);
    },
    [flushPointerMove, inputHandler, isViewerFullscreen, videoRef]
  );

  useEffect(() => {
    return () => {
      if (pointerMoveFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerMoveFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!DEBUG_MOVE_DIAGNOSTICS) {
      return;
    }

    const interval = window.setInterval(() => {
      const debugState = inputHandler.getDebugState();
      setMoveDiagnosticsHud({
        pointerEventRate: moveEventCountRef.current * 2,
        sentMoveRate: moveSentCountRef.current * 2,
        droppedMoves: moveDroppedCountRef.current,
        coalescedMoves: moveCoalescedCountRef.current,
        throttledFrames: throttledFrameCountRef.current,
        pointerModeActive: debugState.pointerModeActive,
        touchModeActive: debugState.touchModeActive,
        fullscreenActive: isViewerFullscreen,
        mediaRectCached: debugState.mediaRectCached,
        coalescingActive: Boolean(pendingPointerMoveSourceRef.current || pointerMoveFrameRef.current !== null)
      });

      moveEventCountRef.current = 0;
      moveSentCountRef.current = 0;
      moveDroppedCountRef.current = 0;
      moveCoalescedCountRef.current = 0;
      throttledFrameCountRef.current = 0;
    }, 500);

    return () => {
      window.clearInterval(interval);
    };
  }, [inputHandler, isViewerFullscreen]);

  useEffect(() => {
    if (!DEBUG_FULLSCREEN_VIEWER || !isScreenVisible) {
      return;
    }

    const logFullscreenMetrics = () => {
      const video = videoRef.current;
      const container = viewerContainerRef.current;
      const layout = video ? getDisplayedMediaRect(video) : null;
      const containerRect = container?.getBoundingClientRect() ?? null;
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const orientation =
        viewportWidth > viewportHeight ? "landscape" : viewportWidth < viewportHeight ? "portrait" : "square";

      console.debug("[CTRLX fullscreen viewer]", {
        fullscreenActive: isViewerFullscreen,
        softFullscreenActive: isViewerSoftFullscreen,
        viewport: {
          width: Math.round(viewportWidth),
          height: Math.round(viewportHeight)
        },
        orientation,
        containerRect: containerRect
          ? {
              left: Math.round(containerRect.left),
              top: Math.round(containerRect.top),
              width: Math.round(containerRect.width),
              height: Math.round(containerRect.height)
            }
          : null,
        displayedMediaRect: layout
          ? {
              left: Math.round(layout.mediaRect.left),
              top: Math.round(layout.mediaRect.top),
              width: Math.round(layout.mediaRect.width),
              height: Math.round(layout.mediaRect.height)
            }
          : null
      });
    };

    logFullscreenMetrics();
    window.addEventListener("resize", logFullscreenMetrics);
    window.visualViewport?.addEventListener("resize", logFullscreenMetrics);
    window.screen.orientation?.addEventListener?.("change", logFullscreenMetrics);

    return () => {
      window.removeEventListener("resize", logFullscreenMetrics);
      window.visualViewport?.removeEventListener("resize", logFullscreenMetrics);
      window.screen.orientation?.removeEventListener?.("change", logFullscreenMetrics);
    };
  }, [isScreenVisible, isViewerFullscreen, isViewerSoftFullscreen, videoRef, viewerContainerRef]);

  const inputDebugState = inputHandler.getDebugState();
  const previousFunctionIdentity = functionIdentityRef.current;
  const functionIdentityChanges = {
    emitViewerInputChanged:
      previousFunctionIdentity.emitViewerInput !== undefined && previousFunctionIdentity.emitViewerInput !== emitViewerInput,
    flushPointerMoveChanged:
      previousFunctionIdentity.flushPointerMove !== undefined &&
      previousFunctionIdentity.flushPointerMove !== flushPointerMove,
    schedulePointerMoveChanged:
      previousFunctionIdentity.schedulePointerMove !== undefined &&
      previousFunctionIdentity.schedulePointerMove !== schedulePointerMove
  };

  functionIdentityRef.current = {
    emitViewerInput,
    flushPointerMove,
    schedulePointerMove
  };

  useDevRenderDiagnostics("ControlPanel.LiveViewer", {
    isScreenVisible,
    isStreaming,
    isStreamConnecting,
    isViewerFullscreen,
    isViewerSoftFullscreen,
    streamStatus,
    inputAckState: inputAckStatus?.state ?? null,
    moveAckState: moveLatencyDiagnostic?.ackState ?? null
  });

  useDevRenderDiagnostics("ControlPanel.PointerLayer", {
    isViewerFullscreen,
    pointerModeActive: inputDebugState.pointerModeActive,
    touchModeActive: inputDebugState.touchModeActive,
    mediaRectCached: inputDebugState.mediaRectCached,
    pendingPointerMove: Boolean(pendingPointerMoveSourceRef.current),
    pointerFrameScheduled: pointerMoveFrameRef.current !== null,
    pointerActive: pointerActiveRef.current,
    ...functionIdentityChanges
  });

  return (
    <div
      ref={viewerContainerRef}
      data-fullscreen={isViewerFullscreen ? "true" : "false"}
      className={[
        "relative mt-8 flex flex-1 items-center justify-center overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] transition-[border-radius,margin] duration-200",
        isViewerFullscreen ? "mt-0 rounded-none border-0 bg-black" : "",
        isViewerSoftFullscreen ? "fixed inset-0 z-[9999] h-[100dvh] w-[100vw]" : ""
      ].join(" ")}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(153,247,255,0.18),_transparent_30%)]" />
      <div className="absolute h-80 w-80 rounded-full border border-ctrlx-accent/10 bg-ctrlx-accentSoft blur-3xl" />
      {!isViewerFullscreen ? (
        <div className="absolute left-5 top-5 z-10 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-ctrlx text-ctrlx-edge backdrop-blur">
          {streamStatus}
        </div>
      ) : null}
      {import.meta.env.DEV && isScreenVisible && inputAckStatus ? (
        <div
          className={[
            "absolute bottom-5 left-5 z-20 max-w-[min(70vw,20rem)] rounded-2xl border px-3 py-2 backdrop-blur transition",
            inputAckStatus.state === "failed"
              ? "border-red-400/25 bg-red-500/10 text-red-100"
              : inputAckStatus.state === "executed"
                ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                : "border-white/10 bg-black/45 text-ctrlx-edge"
          ].join(" ")}
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] opacity-75">Input</span>
            <span className="rounded-full border border-current/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]">
              {inputAckStatus.state}
            </span>
          </div>
          <p className="mt-1 text-xs leading-5">{inputAckStatus.message}</p>
        </div>
      ) : null}
      {DEBUG_MOVE_DIAGNOSTICS && isScreenVisible && moveDiagnosticsHud ? (
        <div className="pointer-events-none absolute bottom-5 right-5 z-20 max-w-[min(72vw,22rem)] rounded-2xl border border-white/10 bg-black/55 px-3 py-2 text-[11px] text-ctrlx-edge backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-[0.22em] opacity-75">Move Debug</span>
            <span className="rounded-full border border-current/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]">
              {moveDiagnosticsHud.pointerModeActive || moveDiagnosticsHud.touchModeActive ? "active" : "idle"}
            </span>
          </div>
          <p className="mt-1">mode: pointer={String(moveDiagnosticsHud.pointerModeActive)} touch={String(moveDiagnosticsHud.touchModeActive)} fullscreen={String(moveDiagnosticsHud.fullscreenActive)}</p>
          <p>cache/coalesce: rect={String(moveDiagnosticsHud.mediaRectCached)} active={String(moveDiagnosticsHud.coalescingActive)}</p>
          <p>rates: events={moveDiagnosticsHud.pointerEventRate}/s sent={moveDiagnosticsHud.sentMoveRate}/s</p>
          <p>pressure: dropped={moveDiagnosticsHud.droppedMoves} coalesced={moveDiagnosticsHud.coalescedMoves} throttled={moveDiagnosticsHud.throttledFrames}</p>
          {moveDiagnosticsRuntime ? (
            <p>
              transport/host: deferred={moveDiagnosticsRuntime.transportDeferred} replaced={moveDiagnosticsRuntime.transportReplaced} flushed={moveDiagnosticsRuntime.transportFlushed} executed={moveDiagnosticsRuntime.executedMoves} skipped={moveDiagnosticsRuntime.staleSkippedMoves}
            </p>
          ) : null}
          {moveLatencyDiagnostic ? (
            <p>
              latency: state={moveLatencyDiagnostic.ackState} rtt={moveLatencyDiagnostic.roundTripMs ?? "-"}ms queue=
              {moveLatencyDiagnostic.hostQueueMs ?? "-"}ms exec={moveLatencyDiagnostic.hostExecuteMs ?? "-"}ms recv=
              {moveLatencyDiagnostic.hostReceiveTimestamp ?? "-"} start={moveLatencyDiagnostic.hostExecuteStartTimestamp ?? "-"} end=
              {moveLatencyDiagnostic.hostExecuteTimestamp ?? "-"}
            </p>
          ) : null}
        </div>
      ) : null}
      {isViewerFullscreen ? (
        <div
          className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3"
          style={{
            paddingTop: "env(safe-area-inset-top, 0px)",
            paddingLeft: "env(safe-area-inset-left, 0px)",
            paddingRight: "env(safe-area-inset-right, 0px)"
          }}
        >
          <div className="ml-4 mt-4 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-ctrlx-edge backdrop-blur">
            {streamStatus}
          </div>
          <div className="mr-4 mt-4 flex items-center gap-3">
            <button
              onClick={onOpenKeyboardInputMode}
              className="rounded-full border border-white/15 bg-black/45 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-ctrlx-edge backdrop-blur transition hover:border-ctrlx-accent/50 hover:bg-black/65"
            >
              Type
            </button>
            <button
              onClick={onExitFullscreen}
              className="rounded-full border border-white/15 bg-black/55 px-5 py-3 text-xs font-semibold uppercase tracking-ctrlx text-ctrlx-edge backdrop-blur transition hover:border-ctrlx-accent/50 hover:bg-black/70"
            >
              Exit
            </button>
          </div>
        </div>
      ) : null}
      <div
        className={["relative h-full w-full", isViewerFullscreen ? "p-0" : "p-6"].join(" ")}
        style={
          isViewerFullscreen
            ? {
                width: "100vw",
                height: "100dvh",
                paddingTop: "env(safe-area-inset-top, 0px)",
                paddingRight: "env(safe-area-inset-right, 0px)",
                paddingBottom: "env(safe-area-inset-bottom, 0px)",
                paddingLeft: "env(safe-area-inset-left, 0px)"
              }
            : undefined
        }
      >
        <div
          className={[
            "flex h-full w-full items-center justify-center overflow-hidden border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(153,247,255,0.08),rgba(6,10,16,0.96)_62%)] shadow-[0_0_60px_rgba(153,247,255,0.10),0_35px_80px_rgba(0,0,0,0.4)] transition-[border-radius] duration-200",
            isViewerFullscreen ? "rounded-none border-0 bg-black shadow-none" : "rounded-[28px]"
          ].join(" ")}
        >
          {isScreenVisible ? (
            <div className="relative h-full w-full">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                onPointerDown={(event) => {
                  const video = videoRef.current;
                  if (!video || inputHandler.shouldIgnorePointerEvent(event.nativeEvent)) {
                    return;
                  }

                  pointerActiveRef.current = true;
                  if (isViewerFullscreen || CLIENT_EXPERIMENTAL_DRAG) {
                    emitViewerInput(inputHandler.mapPointerDragPhase(video, event.nativeEvent, "pointer_down", isViewerFullscreen));
                  }
                }}
                onPointerMove={(event) => {
                  const video = videoRef.current;
                  if (!video || !pointerActiveRef.current || inputHandler.shouldIgnorePointerEvent(event.nativeEvent)) {
                    return;
                  }

                  if (DEBUG_MOVE_DIAGNOSTICS) {
                    moveEventCountRef.current += 1;
                  }
                  inputHandler.handlePointerMoveEvent(event.nativeEvent);
                  if (isViewerFullscreen) {
                    schedulePointerMove({
                      kind: "pointer",
                      pointerId: event.nativeEvent.pointerId
                    });
                  } else if (CLIENT_EXPERIMENTAL_DRAG) {
                    emitViewerInput(inputHandler.mapPointerDragPhase(video, event.nativeEvent, "pointer_move", isViewerFullscreen));
                  }
                }}
                onPointerUp={(event) => {
                  const video = videoRef.current;
                  if (!video || inputHandler.shouldIgnorePointerEvent(event.nativeEvent)) {
                    return;
                  }

                  inputHandler.handlePointerTapGesture(video, event.nativeEvent, emitViewerInput, isViewerFullscreen);
                  pointerActiveRef.current = false;
                  pendingPointerMoveSourceRef.current = null;
                  if (pointerMoveFrameRef.current !== null) {
                    window.cancelAnimationFrame(pointerMoveFrameRef.current);
                    pointerMoveFrameRef.current = null;
                  }
                  if (isViewerFullscreen || CLIENT_EXPERIMENTAL_DRAG) {
                    emitViewerInput(inputHandler.mapPointerDragPhase(video, event.nativeEvent, "pointer_up", isViewerFullscreen));
                  }
                  inputHandler.clearPointerGesture(event.nativeEvent.pointerId);
                }}
                onPointerCancel={(event) => {
                  pointerActiveRef.current = false;
                  pendingPointerMoveSourceRef.current = null;
                  if (pointerMoveFrameRef.current !== null) {
                    window.cancelAnimationFrame(pointerMoveFrameRef.current);
                    pointerMoveFrameRef.current = null;
                  }
                  inputHandler.clearPointerGesture(event.nativeEvent.pointerId);
                }}
                onTouchStart={(event) => {
                  const video = videoRef.current;
                  const touch = event.changedTouches[0];
                  if (!video || !touch) {
                    return;
                  }

                  inputHandler.handleTouchStart(touch);
                  inputHandler.primeTouchLayout(video);
                  if (isViewerFullscreen || CLIENT_EXPERIMENTAL_DRAG) {
                    emitViewerInput(inputHandler.mapTouchPointerPhase(video, touch, "pointer_down", isViewerFullscreen));
                  }
                }}
                onTouchMove={(event) => {
                  const video = videoRef.current;
                  const touch = event.changedTouches[0];
                  if (!video || !touch) {
                    return;
                  }

                  inputHandler.handleTouchMove(touch);
                  if (isViewerFullscreen) {
                    if (DEBUG_MOVE_DIAGNOSTICS) {
                      moveEventCountRef.current += 1;
                    }
                    event.preventDefault();
                    schedulePointerMove({
                      kind: "touch",
                      identifier: touch.identifier
                    });
                  }
                }}
                onTouchEnd={(event) => {
                  const video = videoRef.current;
                  const touch = event.changedTouches[0];
                  if (!video || !touch) {
                    return;
                  }

                  event.preventDefault();
                  pendingPointerMoveSourceRef.current = null;
                  if (pointerMoveFrameRef.current !== null) {
                    window.cancelAnimationFrame(pointerMoveFrameRef.current);
                    pointerMoveFrameRef.current = null;
                  }
                  if (isViewerFullscreen) {
                    emitViewerInput(inputHandler.mapTouchPointerPhase(video, touch, "pointer_up", isViewerFullscreen));
                  }
                  inputHandler.handleTouchEnd(video, touch, emitViewerInput, isViewerFullscreen);
                }}
                onTouchCancel={(event) => {
                  const touch = event.changedTouches[0];
                  pendingPointerMoveSourceRef.current = null;
                  if (pointerMoveFrameRef.current !== null) {
                    window.cancelAnimationFrame(pointerMoveFrameRef.current);
                    pointerMoveFrameRef.current = null;
                  }
                  inputHandler.cancelTouchGesture(touch?.identifier);
                }}
                className={[
                  "h-full w-full transition",
                  isViewerFullscreen ? "object-contain bg-black" : "object-contain",
                  isStreaming ? "opacity-100" : "opacity-0"
                ].join(" ")}
                style={{ touchAction: "none" }}
              />
              {import.meta.env.DEV
                ? debugMarkers.map((marker) => (
                    <div
                      key={marker.id}
                      className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ctrlx-accent/60 bg-ctrlx-accent/15 animate-ping"
                      style={{
                        left: `${marker.xNorm * 100}%`,
                        top: `${marker.yNorm * 100}%`
                      }}
                    />
                  ))
                : null}
              {CLIENT_DEBUG_CURSOR_MOVE ? (
                <div
                  ref={cursorDebugOverlayRef}
                  className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-300/70 bg-emerald-300/25"
                  style={{ left: "50%", top: "50%", opacity: 0 }}
                />
              ) : null}
              {isStreamConnecting ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-sm">
                  <div className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,23,34,0.96),rgba(9,14,22,0.96))] px-6 py-5 text-center shadow-panel">
                    <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Stream</p>
                    <p className="mt-3 text-lg font-semibold text-ctrlx-edge">Connecting to stream...</p>
                  </div>
                </div>
              ) : null}
              {!isStreaming && !isStreamConnecting ? (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="rounded-[22px] border border-white/10 bg-black/30 px-6 py-5 text-center backdrop-blur">
                    <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Stream Offline</p>
                    <p className="mt-3 text-sm text-ctrlx-text">Screen view is hidden or disconnected.</p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-64 w-64 items-center justify-center rounded-full border border-ctrlx-accent/25 bg-[radial-gradient(circle_at_top,_rgba(153,247,255,0.12),rgba(10,16,24,0.96)_62%)]">
              <div className="flex h-40 w-40 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                <span className="text-center text-sm font-semibold uppercase tracking-[0.22em] text-ctrlx-edge">
                  CTRLX
                  <br />
                  Surface
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

type CommandPadSectionProps = {
  isConnected: boolean;
  isViewerFullscreen: boolean;
  onCommand: (command: CtrlxCommand) => void;
};

const CommandPadSection = memo(function CommandPadSection({
  isConnected,
  isViewerFullscreen,
  onCommand
}: CommandPadSectionProps) {
  const [commandPadAssignments, setCommandPadAssignments] = useState<CommandPadAssignment[]>(() =>
    loadCommandPadAssignments()
  );
  const [assignmentSlotIndex, setAssignmentSlotIndex] = useState<number | null>(null);

  const commandPadSlots: CommandPadSlot[] = useMemo(
    () =>
      commandPadAssignments.map((commandId, index) => ({
        slot: index + 1,
        control: commandId ? commandCatalogById.get(commandId) ?? null : null
      })),
    [commandPadAssignments]
  );

  const activeAssignmentSlot = assignmentSlotIndex === null ? null : commandPadSlots[assignmentSlotIndex] ?? null;
  const createSessionSlot = commandPadSlots.find((slot) => slot.control?.id === CtrlxCommand.OpenLogic) ?? null;

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(COMMAND_PAD_STORAGE_KEY, JSON.stringify(commandPadAssignments));
  }, [commandPadAssignments]);

  useDevRenderDiagnostics("ControlPanel.CommandPad", {
    isConnected,
    assignmentSheetOpen: activeAssignmentSlot !== null,
    assignmentSignature: commandPadAssignments.join("|")
  });

  useDevRenderDiagnostics("ControlPanel.CreateSessionControl", {
    slot: createSessionSlot?.slot ?? null,
    assigned: Boolean(createSessionSlot),
    isConnected
  });

  const openAssignmentSheet = useCallback((slotIndex: number): void => {
    setAssignmentSlotIndex(slotIndex);
  }, []);

  const closeAssignmentSheet = useCallback((): void => {
    setAssignmentSlotIndex(null);
  }, []);

  const assignCommandToSlot = useCallback((slotIndex: number, commandId: CtrlxCommand): void => {
    setCommandPadAssignments((current) =>
      current.map((assignment, index) => (index === slotIndex ? commandId : assignment))
    );
    setAssignmentSlotIndex(null);
  }, []);

  const clearAssignedSlot = useCallback((slotIndex: number): void => {
    setCommandPadAssignments((current) =>
      current.map((assignment, index) => (index === slotIndex ? null : assignment))
    );
    setAssignmentSlotIndex(null);
  }, []);

  return (
    <>
      <div className="relative z-10 mt-6 md:mt-8">
        <div className="mb-3 flex items-center justify-between gap-3 px-1 md:mb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Command Pad</p>
            <p className="mt-1.5 text-[13px] text-ctrlx-text md:mt-2 md:text-sm">Mini Stream Deck for fast Logic control.</p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-ctrlx-muted md:px-3 md:py-1.5 md:tracking-[0.22em]">
            10 Slots
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 md:gap-3 xl:grid-cols-5">
          {commandPadSlots.map((slot) => {
            const control = slot.control;

            if (!control) {
              return (
                <div
                  key={`slot-${slot.slot}`}
                  className="group relative min-h-[126px] overflow-hidden rounded-[22px] border border-dashed border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] px-3 py-3 text-left text-ctrlx-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_28px_rgba(0,0,0,0.16)] sm:min-h-[136px] sm:rounded-[24px] md:min-h-[144px] md:px-4 md:py-4 md:rounded-[26px]"
                >
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_55%)] opacity-80" />
                  <button
                    type="button"
                    onClick={() => openAssignmentSheet(slot.slot - 1)}
                    aria-label={`Assign command to slot ${slot.slot}`}
                    className="absolute right-2.5 top-2.5 z-10 rounded-full border border-white/10 bg-black/25 p-2 text-ctrlx-muted transition hover:border-white/20 hover:bg-white/[0.06] hover:text-ctrlx-edge active:scale-[0.96] md:right-3 md:top-3 md:p-2.5"
                  >
                    <EditIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openAssignmentSheet(slot.slot - 1)}
                    aria-label={`Command slot ${slot.slot} unassigned`}
                    className="relative flex h-full w-full flex-col text-left transition active:translate-y-px active:scale-[0.985]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))] text-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:h-12 sm:w-12 sm:rounded-[18px] md:h-14 md:w-14 md:rounded-[20px]">
                        <PlaceholderIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                      </div>
                      <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-ctrlx-muted/70 sm:px-2.5 sm:py-1 sm:text-[10px] sm:tracking-[0.22em]">
                        {slot.slot}
                      </span>
                    </div>
                    <strong className="mt-4 block text-[14px] font-semibold leading-5 tracking-[-0.02em] text-ctrlx-text/85 sm:text-[15px] md:mt-5 md:text-base">
                      Unassigned
                    </strong>
                    <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ctrlx-muted/70 sm:text-[11px] sm:tracking-[0.18em] md:mt-2">
                      Tap to assign
                    </span>
                  </button>
                </div>
              );
            }

            return (
              <div
                key={control.id}
                className={[
                  "group relative min-h-[126px] overflow-hidden rounded-[22px] border px-3 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_16px_34px_rgba(0,0,0,0.2)] transition sm:min-h-[136px] sm:rounded-[24px] md:min-h-[144px] md:px-4 md:py-4 md:rounded-[26px]",
                  control.accent
                    ? "border-ctrlx-accent/30 bg-[linear-gradient(180deg,rgba(153,247,255,0.18),rgba(153,247,255,0.08))] text-ctrlx-edge hover:border-ctrlx-accent/60 hover:bg-ctrlx-accent/20"
                    : "border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] text-ctrlx-text hover:border-white/20 hover:bg-white/[0.06]"
                ].join(" ")}
              >
                <div className={["pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70 transition group-hover:opacity-100", control.tone].join(" ")} />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_58%)] opacity-90" />
                <button
                  type="button"
                  onClick={() => openAssignmentSheet(slot.slot - 1)}
                  aria-label={`Manage slot ${slot.slot}`}
                  className="absolute right-2.5 top-2.5 z-10 rounded-full border border-white/10 bg-black/25 p-2 text-ctrlx-edge/80 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-ctrlx-edge active:scale-[0.96] md:right-3 md:top-3 md:p-2.5"
                >
                  <EditIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={!isConnected}
                  onClick={() => onCommand(control.id)}
                  aria-label={control.label}
                  className="relative flex h-full w-full flex-col text-left transition active:translate-y-px active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={[
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition sm:h-12 sm:w-12 sm:rounded-[18px] md:h-14 md:w-14 md:rounded-[20px]",
                        control.accent
                          ? "border-ctrlx-accent/25 bg-[linear-gradient(180deg,rgba(0,0,0,0.24),rgba(0,0,0,0.12))] text-ctrlx-edge"
                          : "border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.035))] text-white/90 group-hover:border-white/20"
                      ].join(" ")}
                    >
                      <control.Icon className="h-5 w-5 sm:h-6 sm:w-6 md:h-7 md:w-7" />
                    </div>
                    <div className="mr-10 flex flex-col items-end gap-2">
                      <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-ctrlx-muted transition group-hover:text-ctrlx-edge sm:px-2.5 sm:py-1 sm:text-[10px] sm:tracking-[0.22em]">
                        {slot.slot}
                      </span>
                      <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ctrlx-muted transition group-hover:text-ctrlx-edge sm:text-[10px] sm:tracking-[0.18em]">
                        {control.summary}
                      </span>
                    </div>
                  </div>
                  <strong className="relative mt-4 block text-[14px] font-semibold leading-5 tracking-[-0.02em] sm:text-[15px] md:mt-5">
                    {control.label}
                  </strong>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {!isViewerFullscreen && activeAssignmentSlot ? (
        <div className="absolute inset-0 z-30 flex items-end bg-black/50 backdrop-blur-sm">
          <div className="w-full rounded-t-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,23,34,0.98),rgba(8,13,19,0.99))] p-5 shadow-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                  Assign Command
                </p>
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-ctrlx-text">
                  Slot {activeAssignmentSlot.slot}
                </h3>
                <p className="mt-2 text-sm text-ctrlx-muted">
                  Choose a Logic command for this pad button.
                </p>
              </div>
              <button
                type="button"
                onClick={closeAssignmentSheet}
                aria-label="Close command assignment"
                className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-ctrlx-muted transition hover:border-white/20 hover:bg-white/[0.06] hover:text-ctrlx-edge"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid max-h-[52vh] gap-3 overflow-y-auto pr-1">
              {commandCatalog.map((command) => {
                const isSelected = activeAssignmentSlot.control?.id === command.id;
                return (
                  <button
                    key={`${activeAssignmentSlot.slot}-${command.id}`}
                    type="button"
                    onClick={() => assignCommandToSlot(activeAssignmentSlot.slot - 1, command.id)}
                    className={[
                      "flex items-center gap-4 rounded-[22px] border px-4 py-4 text-left transition",
                      isSelected
                        ? "border-ctrlx-accent/45 bg-ctrlx-accent/10 text-ctrlx-edge"
                        : "border-white/10 bg-white/[0.03] text-ctrlx-text hover:border-white/20 hover:bg-white/[0.05]"
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border",
                        isSelected
                          ? "border-ctrlx-accent/35 bg-black/20"
                          : "border-white/10 bg-white/[0.04]"
                      ].join(" ")}
                    >
                      <command.Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <strong className="block text-base font-semibold tracking-[-0.02em]">{command.label}</strong>
                      <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-ctrlx-muted">
                        {command.category}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => clearAssignedSlot(activeAssignmentSlot.slot - 1)}
                className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-ctrlx-text transition hover:border-white/20 hover:bg-white/[0.05]"
              >
                Clear Slot
              </button>
              <button
                type="button"
                onClick={closeAssignmentSheet}
                className="rounded-[18px] border border-ctrlx-accent/30 bg-[linear-gradient(180deg,rgba(153,247,255,0.17),rgba(153,247,255,0.08))] px-4 py-3 text-sm font-semibold text-ctrlx-edge transition hover:border-ctrlx-accent/55"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
});

export function ControlPanel({
  onCommand,
  isConnected,
  onToggleStream,
  onFullscreen,
  onExitFullscreen,
  isScreenVisible,
  isStreaming,
  isStreamConnecting,
  isViewerFullscreen,
  isViewerSoftFullscreen,
  isFullscreenKeyboardOverlayOpen,
  viewerMode,
  streamStatus,
  audioStatus,
  hasAudioStream,
  isAudioMuted,
  audioVolume,
  onToggleMute,
  onVolumeChange,
  onViewerInput,
  onOpenKeyboardInputMode,
  onCloseKeyboardInputMode,
  onKeyboardDraftChange,
  onKeyboardSubmit,
  onKeyboardEnter,
  inputAckStatus,
  moveLatencyDiagnostic,
  moveDiagnosticsRuntime,
  inputHandler,
  viewerContainerRef,
  videoRef
}: ControlPanelProps) {
  const isFullscreenPresentationActive =
    isViewerFullscreen || isViewerSoftFullscreen || isFullscreenKeyboardOverlayOpen;
  const pointerActiveRef = useRef(false);
  const [debugMarkers, setDebugMarkers] = useState<DebugMarker[]>([]);
  const [moveDiagnosticsHud, setMoveDiagnosticsHud] = useState<MoveDiagnosticsHud | null>(null);
  const [keyboardDraft, setKeyboardDraft] = useState("");
  const [commandPadAssignments, setCommandPadAssignments] = useState<CommandPadAssignment[]>(() =>
    loadCommandPadAssignments()
  );
  const [assignmentSlotIndex, setAssignmentSlotIndex] = useState<number | null>(null);
  const lastPointerMoveSentAtRef = useRef(0);
  const lastSentPointerMoveRef = useRef<ViewerInputPayload | null>(null);
  const pendingPointerMoveSourceRef = useRef<PendingMoveSource | null>(null);
  const pointerMoveFrameRef = useRef<number | null>(null);
  const cursorDebugOverlayRef = useRef<HTMLDivElement | null>(null);
  const fullscreenKeyboardInputRef = useRef<HTMLInputElement | null>(null);
  const twoFingerGestureRef = useRef<TwoFingerGestureState | null>(null);
  const gestureFrameRef = useRef<number | null>(null);
  const longPressRegionMoveCandidateRef = useRef<LongPressRegionMoveCandidate | null>(null);
  const longPressRegionMoveRef = useRef<LongPressRegionMoveState | null>(null);
  const longPressRegionMoveFrameRef = useRef<number | null>(null);
  const moveEventCountRef = useRef(0);
  const moveSentCountRef = useRef(0);
  const moveDroppedCountRef = useRef(0);
  const moveCoalescedCountRef = useRef(0);
  const throttledFrameCountRef = useRef(0);
  const commandPadSlots: CommandPadSlot[] = commandPadAssignments.map((commandId, index) => ({
    slot: index + 1,
    control: commandId ? commandCatalogById.get(commandId) ?? null : null
  }));
  const activeAssignmentSlot = assignmentSlotIndex === null ? null : commandPadSlots[assignmentSlotIndex] ?? null;
  const createSessionSlot = commandPadSlots.find((slot) => slot.control?.id === CtrlxCommand.OpenLogic) ?? null;
  const functionIdentityRef = useRef<{
    emitViewerInput?: typeof emitViewerInput;
    flushPointerMove?: typeof flushPointerMove;
    schedulePointerMove?: typeof schedulePointerMove;
    handleKeyboardSubmit?: typeof handleKeyboardSubmit;
  }>({});

  function addDebugMarker(payload: ViewerInputPayload): void {
    if (!import.meta.env.DEV) {
      return;
    }

    if (payload.action !== "tap" && payload.action !== "double_tap") {
      return;
    }

    const marker: DebugMarker = {
      id: `${payload.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
      xNorm: payload.xNorm,
      yNorm: payload.yNorm
    };

    setDebugMarkers((current) => [...current, marker].slice(-6));
    window.setTimeout(() => {
      setDebugMarkers((current) => current.filter((entry) => entry.id !== marker.id));
    }, 480);
  }

  function buildGesturePayload(
    layout: DisplayedMediaLayout,
    action: "gesture_pan" | "gesture_zoom" | "gesture_region_move",
    clientX: number,
    clientY: number,
    extras: {
      gesturePhase?: "start" | "move" | "end";
      zoomAxis?: "horizontal" | "vertical";
      deltaX?: number;
      deltaY?: number;
      zoomDelta?: number;
    }
  ): ViewerInputPayload | null {
    const xNorm = Math.min(1, Math.max(0, (clientX - layout.mediaRect.left) / layout.mediaRect.width));
    const yNorm = Math.min(1, Math.max(0, (clientY - layout.mediaRect.top) / layout.mediaRect.height));

    return {
      action,
      xNorm,
      yNorm,
      viewerWidth: Math.round(layout.containerRect.width),
      viewerHeight: Math.round(layout.containerRect.height),
      timestamp: Date.now(),
      pointerType: "touch",
      gesturePhase: extras.gesturePhase,
      zoomAxis: extras.zoomAxis,
      deltaX: extras.deltaX,
      deltaY: extras.deltaY,
      zoomDelta: extras.zoomDelta
    };
  }

  function emitRegionMovePhase(
    gesture: TwoFingerGestureState,
    phase: "start" | "move" | "end"
  ): void {
    if (!gesture.layout) {
      return;
    }

    logGestureDiagnostics("region_move_emit", {
      phase,
      centroidX: Number(gesture.lastCenterX.toFixed(2)),
      centroidY: Number(gesture.lastCenterY.toFixed(2))
    });

    emitViewerInput(
      buildGesturePayload(gesture.layout, "gesture_region_move", gesture.lastCenterX, gesture.lastCenterY, {
        gesturePhase: phase
      })
    );
  }

  function emitLongPressRegionMovePhase(
    state: LongPressRegionMoveState,
    phase: "start" | "move" | "end"
  ): void {
    if (!state.layout) {
      return;
    }

    logGestureDiagnostics("long_press_region_move_emit", {
      phase,
      x: Number(state.currentX.toFixed(2)),
      y: Number(state.currentY.toFixed(2))
    });

    emitViewerInput(
      buildGesturePayload(state.layout, "gesture_region_move", state.currentX, state.currentY, {
        gesturePhase: phase
      })
    );
  }

  function emitViewerInput(payload: ViewerInputPayload | null): void {
    if (!payload) {
      return;
    }

    // Control input layer:
    // The viewer captures UI interaction locally, converts it to normalized
    // JSON-safe coordinates, and forwards only protocol payloads to the
    // websocket control path. The media stream itself stays WebRTC-only.
    addDebugMarker(payload);
    onViewerInput(payload);
  }

  function dispatchGestureCommand(command: CtrlxCommand, context: Record<string, unknown>): void {
    logGestureDiagnostics("gesture_command_dispatch", {
      command,
      ...context
    });
    onCommand(command);
  }

  function cancelTwoFingerGesture(reason = "cancelled"): void {
    if (twoFingerGestureRef.current) {
      if (twoFingerGestureRef.current.mode === "region_move") {
        emitRegionMovePhase(twoFingerGestureRef.current, "end");
      }
      logGestureDiagnostics("two_finger_end", {
        reason,
        mode: twoFingerGestureRef.current.mode,
        pinchAxis: twoFingerGestureRef.current.pinchAxis,
        pendingPanX: Number(twoFingerGestureRef.current.pendingPanX.toFixed(2)),
        pendingPanY: Number(twoFingerGestureRef.current.pendingPanY.toFixed(2)),
        pendingZoomDistancePx: Number(twoFingerGestureRef.current.pendingZoomDistancePx.toFixed(2)),
        pendingZoomSteps: twoFingerGestureRef.current.pendingZoomSteps
      });
    }
    twoFingerGestureRef.current = null;
    if (gestureFrameRef.current !== null) {
      window.cancelAnimationFrame(gestureFrameRef.current);
      gestureFrameRef.current = null;
    }
  }

  function clearLongPressRegionMoveCandidate(reason = "cancelled"): void {
    const candidate = longPressRegionMoveCandidateRef.current;
    if (!candidate) {
      return;
    }

    window.clearTimeout(candidate.timer);
    longPressRegionMoveCandidateRef.current = null;
    logGestureDiagnostics("long_press_cancelled", {
      reason,
      identifier: candidate.identifier
    });
  }

  function endLongPressRegionMove(reason = "ended"): void {
    const activeRegionMove = longPressRegionMoveRef.current;
    if (!activeRegionMove) {
      return;
    }

    if (longPressRegionMoveFrameRef.current !== null) {
      window.cancelAnimationFrame(longPressRegionMoveFrameRef.current);
      longPressRegionMoveFrameRef.current = null;
    }

    emitLongPressRegionMovePhase(activeRegionMove, "end");
    longPressRegionMoveRef.current = null;
    logGestureDiagnostics("long_press_region_move_end", {
      reason,
      identifier: activeRegionMove.identifier
    });
  }

  function flushLongPressRegionMove(frameTime: number): void {
    longPressRegionMoveFrameRef.current = null;
    const activeRegionMove = longPressRegionMoveRef.current;
    if (!activeRegionMove || !activeRegionMove.layout) {
      return;
    }

    if (frameTime - activeRegionMove.lastSentAt < GESTURE_FRAME_MS) {
      longPressRegionMoveFrameRef.current = window.requestAnimationFrame(flushLongPressRegionMove);
      return;
    }

    if (!activeRegionMove.pendingMove) {
      return;
    }

    const deltaX = activeRegionMove.currentX - activeRegionMove.lastSentX;
    const deltaY = activeRegionMove.currentY - activeRegionMove.lastSentY;
    if (
      Math.abs(deltaX) < LONG_PRESS_REGION_MOVE_MIN_DELTA_PX &&
      Math.abs(deltaY) < LONG_PRESS_REGION_MOVE_MIN_DELTA_PX
    ) {
      activeRegionMove.pendingMove = false;
      return;
    }

    emitLongPressRegionMovePhase(activeRegionMove, "move");
    activeRegionMove.lastSentX = activeRegionMove.currentX;
    activeRegionMove.lastSentY = activeRegionMove.currentY;
    activeRegionMove.lastSentAt = frameTime;
    activeRegionMove.pendingMove = false;
  }

  function scheduleLongPressRegionMove(): void {
    if (longPressRegionMoveFrameRef.current !== null) {
      return;
    }

    longPressRegionMoveFrameRef.current = window.requestAnimationFrame(flushLongPressRegionMove);
  }

  function activateLongPressRegionMove(): void {
    const candidate = longPressRegionMoveCandidateRef.current;
    if (!candidate) {
      return;
    }

    window.clearTimeout(candidate.timer);
    longPressRegionMoveCandidateRef.current = null;
    inputHandler.clearPendingTapGesture("touch");
    pendingPointerMoveSourceRef.current = null;
    if (pointerMoveFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerMoveFrameRef.current);
      pointerMoveFrameRef.current = null;
    }

    longPressRegionMoveRef.current = {
      identifier: candidate.identifier,
      layout: candidate.layout,
      currentX: candidate.currentX,
      currentY: candidate.currentY,
      lastSentX: candidate.currentX,
      lastSentY: candidate.currentY,
      lastSentAt: 0,
      pendingMove: false
    };

    logGestureDiagnostics("long_press_region_move_start", {
      holdMs: LONG_PRESS_REGION_MOVE_HOLD_MS,
      identifier: candidate.identifier,
      x: Number(candidate.currentX.toFixed(2)),
      y: Number(candidate.currentY.toFixed(2))
    });

    emitLongPressRegionMovePhase(longPressRegionMoveRef.current, "start");
  }

  function flushTwoFingerGesture(frameTime: number): void {
    gestureFrameRef.current = null;
    const gesture = twoFingerGestureRef.current;
    if (!gesture || !gesture.layout) {
      return;
    }

    if (frameTime - gesture.lastSentAt < GESTURE_FRAME_MS) {
      gestureFrameRef.current = window.requestAnimationFrame(flushTwoFingerGesture);
      return;
    }

    const centerX = gesture.lastCenterX;
    const centerY = gesture.lastCenterY;
    let sent = false;

    if (
      gesture.mode === "pan" &&
      (Math.abs(gesture.pendingPanX) >= PAN_GESTURE_MIN_DELTA_PX ||
        Math.abs(gesture.pendingPanY) >= PAN_GESTURE_MIN_DELTA_PX)
    ) {
      logGestureDiagnostics("pan_emit", {
        centroidX: Number(centerX.toFixed(2)),
        centroidY: Number(centerY.toFixed(2)),
        deltaX: Number(gesture.pendingPanX.toFixed(2)),
        deltaY: Number(gesture.pendingPanY.toFixed(2))
      });
      emitViewerInput(
        buildGesturePayload(gesture.layout, "gesture_pan", centerX, centerY, {
          deltaX: gesture.pendingPanX,
          deltaY: gesture.pendingPanY
        })
      );
      gesture.pendingPanX = 0;
      gesture.pendingPanY = 0;
      sent = true;
    }

    if (gesture.mode === "pinch" && gesture.pendingZoomSteps !== 0) {
      if (gesture.pinchAxis === "pending") {
        gestureFrameRef.current = window.requestAnimationFrame(flushTwoFingerGesture);
        return;
      }
      const zoomSteps = gesture.pendingZoomSteps;
      const zoomCommand =
        gesture.pinchAxis === "horizontal"
          ? zoomSteps > 0
            ? gestureBindingById.get("pinch_out")?.commandId
            : gestureBindingById.get("pinch_in")?.commandId
          : zoomSteps > 0
            ? gestureBindingById.get("pinch_out_vertical")?.commandId
            : gestureBindingById.get("pinch_in_vertical")?.commandId;
      logGestureDiagnostics("pinch_emit", {
        centroidX: Number(centerX.toFixed(2)),
        centroidY: Number(centerY.toFixed(2)),
        zoomDelta: zoomSteps,
        zoomAxis: gesture.pinchAxis,
        dispatchKind: "command",
        command: zoomCommand ?? null
      });

      if (typeof zoomCommand === "string") {
        const repeatCount = Math.min(4, Math.max(1, Math.abs(Math.trunc(zoomSteps))));
        for (let step = 0; step < repeatCount; step += 1) {
          dispatchGestureCommand(zoomCommand as CtrlxCommand, {
            gesture: "pinch",
            axis: gesture.pinchAxis,
            step: step + 1,
            repeatCount,
            zoomDelta: zoomSteps
          });
        }
      } else {
        logGestureDiagnostics("pinch_emit_skipped", {
          reason: "missing_zoom_command_binding",
          zoomAxis: gesture.pinchAxis,
          zoomDelta: zoomSteps
        });
      }

      gesture.pendingZoomSteps = 0;
      sent = true;
    }

    if (
      gesture.mode === "region_move" &&
      (Math.abs(gesture.pendingPanX) >= PAN_GESTURE_MIN_DELTA_PX ||
        Math.abs(gesture.pendingPanY) >= PAN_GESTURE_MIN_DELTA_PX)
    ) {
      emitRegionMovePhase(gesture, "move");
      gesture.pendingPanX = 0;
      gesture.pendingPanY = 0;
      sent = true;
    }

    if (sent) {
      gesture.lastSentAt = frameTime;
    }

    if (
      (gesture.mode === "pan" &&
        (Math.abs(gesture.pendingPanX) >= PAN_GESTURE_MIN_DELTA_PX ||
          Math.abs(gesture.pendingPanY) >= PAN_GESTURE_MIN_DELTA_PX)) ||
      (gesture.mode === "pinch" && (gesture.pendingZoomSteps !== 0 || gesture.pinchAxis === "pending")) ||
      (gesture.mode === "region_move" &&
        (Math.abs(gesture.pendingPanX) >= PAN_GESTURE_MIN_DELTA_PX ||
          Math.abs(gesture.pendingPanY) >= PAN_GESTURE_MIN_DELTA_PX))
    ) {
      gestureFrameRef.current = window.requestAnimationFrame(flushTwoFingerGesture);
    }
  }

  function scheduleTwoFingerGestureFlush(): void {
    if (gestureFrameRef.current !== null) {
      return;
    }

    gestureFrameRef.current = window.requestAnimationFrame(flushTwoFingerGesture);
  }

  function startTwoFingerGesture(event: TouchEvent<HTMLVideoElement>): boolean {
    if (!isViewerFullscreen || event.touches.length < 2) {
      return false;
    }

    const first = event.touches[0];
    const second = event.touches[1];
    const layout = getDisplayedMediaRect(event.currentTarget);
    if (!layout) {
      return false;
    }

    const centerX = (first.clientX + second.clientX) / 2;
    const centerY = (first.clientY + second.clientY) / 2;
    const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
    const spreadX = Math.abs(second.clientX - first.clientX);
    const spreadY = Math.abs(second.clientY - first.clientY);

    cancelTwoFingerGesture("restart");
    clearLongPressRegionMoveCandidate("two_finger_start");
    endLongPressRegionMove("two_finger_start");
    pendingPointerMoveSourceRef.current = null;
    if (pointerMoveFrameRef.current !== null) {
      window.cancelAnimationFrame(pointerMoveFrameRef.current);
      pointerMoveFrameRef.current = null;
    }
    pointerActiveRef.current = false;
    inputHandler.cancelTouchGesture(first.identifier);
    inputHandler.cancelTouchGesture(second.identifier);
    inputHandler.clearPendingTapGesture("touch");

    twoFingerGestureRef.current = {
      identifiers: [first.identifier, second.identifier],
      layout,
      lastCenterX: centerX,
      lastCenterY: centerY,
      lastDistance: distance,
      lastSpreadX: spreadX,
      lastSpreadY: spreadY,
      mode: "pending",
      pinchAxis: "pending",
      holdStartedAt: performance.now(),
      maxPanMagnitude: 0,
      maxPinchMagnitude: 0,
      lockTravelPan: 0,
      lockTravelPinch: 0,
      pendingPanX: 0,
      pendingPanY: 0,
      pendingZoomDistancePx: 0,
      pendingZoomSteps: 0,
      lastSentAt: 0
    };

    logGestureDiagnostics("two_finger_start", {
      activeTouches: event.touches.length,
      centroidX: Number(centerX.toFixed(2)),
      centroidY: Number(centerY.toFixed(2)),
      distance: Number(distance.toFixed(2))
    });

    return true;
  }

  function flushPointerMove(frameTime: number): void {
    pointerMoveFrameRef.current = null;

    const video = videoRef.current;
    const pendingSource = pendingPointerMoveSourceRef.current;
    if (!video || !pendingSource) {
      return;
    }

    const elapsed = frameTime - lastPointerMoveSentAtRef.current;
    if (elapsed < POINTER_MOVE_SAMPLE_MS) {
      if (DEBUG_MOVE_DIAGNOSTICS) {
        throttledFrameCountRef.current += 1;
      }
      pointerMoveFrameRef.current = window.requestAnimationFrame(flushPointerMove);
      return;
    }

    const payload =
      pendingSource.kind === "pointer"
        ? inputHandler.buildPointerMovePayload(video, pendingSource.pointerId, isViewerFullscreen)
        : inputHandler.buildTouchMovePayload(video, pendingSource.identifier, isViewerFullscreen);

    pendingPointerMoveSourceRef.current = null;
    if (!payload) {
      if (pendingPointerMoveSourceRef.current) {
        pointerMoveFrameRef.current = window.requestAnimationFrame(flushPointerMove);
      }
      return;
    }

    lastPointerMoveSentAtRef.current = frameTime;
    lastSentPointerMoveRef.current = payload;
    if (DEBUG_MOVE_DIAGNOSTICS) {
      moveSentCountRef.current += 1;
    }

    if (CLIENT_DEBUG_CURSOR_MOVE && cursorDebugOverlayRef.current) {
      cursorDebugOverlayRef.current.style.left = `${payload.xNorm * 100}%`;
      cursorDebugOverlayRef.current.style.top = `${payload.yNorm * 100}%`;
      cursorDebugOverlayRef.current.style.opacity = "1";
    }

    emitViewerInput(payload);

    if (pendingPointerMoveSourceRef.current) {
      pointerMoveFrameRef.current = window.requestAnimationFrame(flushPointerMove);
    }
  }

  function schedulePointerMove(source: PendingMoveSource | null): void {
    if (!source) {
      return;
    }

    const video = videoRef.current;
    if (!video) {
      return;
    }

    const candidatePayload =
      source.kind === "pointer"
        ? inputHandler.buildPointerMovePayload(video, source.pointerId, isViewerFullscreen)
        : inputHandler.buildTouchMovePayload(video, source.identifier, isViewerFullscreen);

    if (!candidatePayload) {
      return;
    }

    const previousPayload =
      (pendingPointerMoveSourceRef.current
        ? pendingPointerMoveSourceRef.current.kind === "pointer"
          ? inputHandler.buildPointerMovePayload(video, pendingPointerMoveSourceRef.current.pointerId, isViewerFullscreen)
          : inputHandler.buildTouchMovePayload(video, pendingPointerMoveSourceRef.current.identifier, isViewerFullscreen)
        : null) ?? lastSentPointerMoveRef.current;
    if (previousPayload) {
      const deltaX = Math.abs(previousPayload.xNorm - candidatePayload.xNorm);
      const deltaY = Math.abs(previousPayload.yNorm - candidatePayload.yNorm);
      if (deltaX < POINTER_MOVE_MIN_DELTA && deltaY < POINTER_MOVE_MIN_DELTA) {
        if (DEBUG_MOVE_DIAGNOSTICS) {
          moveDroppedCountRef.current += 1;
        }
        return;
      }
    }

    if (DEBUG_MOVE_DIAGNOSTICS && pendingPointerMoveSourceRef.current) {
      moveCoalescedCountRef.current += 1;
    }
    pendingPointerMoveSourceRef.current = source;

    if (pointerMoveFrameRef.current !== null) {
      return;
    }

    pointerMoveFrameRef.current = window.requestAnimationFrame(flushPointerMove);
  }

  useEffect(() => {
    return () => {
      if (pointerMoveFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerMoveFrameRef.current);
      }
      if (gestureFrameRef.current !== null) {
        window.cancelAnimationFrame(gestureFrameRef.current);
      }
      if (longPressRegionMoveFrameRef.current !== null) {
        window.cancelAnimationFrame(longPressRegionMoveFrameRef.current);
      }
      const candidate = longPressRegionMoveCandidateRef.current;
      if (candidate) {
        window.clearTimeout(candidate.timer);
      }
    };
  }, []);

  useEffect(() => {
    if (!DEBUG_MOVE_DIAGNOSTICS) {
      return;
    }

    const interval = window.setInterval(() => {
      const debugState = inputHandler.getDebugState();
      setMoveDiagnosticsHud({
        pointerEventRate: moveEventCountRef.current * 2,
        sentMoveRate: moveSentCountRef.current * 2,
        droppedMoves: moveDroppedCountRef.current,
        coalescedMoves: moveCoalescedCountRef.current,
        throttledFrames: throttledFrameCountRef.current,
        pointerModeActive: debugState.pointerModeActive,
        touchModeActive: debugState.touchModeActive,
        fullscreenActive: isViewerFullscreen,
        mediaRectCached: debugState.mediaRectCached,
        coalescingActive: Boolean(pendingPointerMoveSourceRef.current || pointerMoveFrameRef.current !== null)
      });

      moveEventCountRef.current = 0;
      moveSentCountRef.current = 0;
      moveDroppedCountRef.current = 0;
      moveCoalescedCountRef.current = 0;
      throttledFrameCountRef.current = 0;
    }, 500);

    return () => {
      window.clearInterval(interval);
    };
  }, [inputHandler, isViewerFullscreen]);

  const isKeyboardPanelOpen = viewerMode === "keyboard_input_mode";

  useEffect(() => {
    if (!isFullscreenKeyboardOverlayOpen) {
      return;
    }

    window.setTimeout(() => {
      fullscreenKeyboardInputRef.current?.focus();
      fullscreenKeyboardInputRef.current?.select();
    }, 0);
  }, [isFullscreenKeyboardOverlayOpen]);

  useEffect(() => {
    if (!isKeyboardPanelOpen) {
      setKeyboardDraft("");
    }
  }, [isKeyboardPanelOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(COMMAND_PAD_STORAGE_KEY, JSON.stringify(commandPadAssignments));
  }, [commandPadAssignments]);

  useEffect(() => {
    if (!DEBUG_FULLSCREEN_VIEWER || !isScreenVisible) {
      return;
    }

    const logFullscreenMetrics = () => {
      const video = videoRef.current;
      const container = viewerContainerRef.current;
      const layout = video ? getDisplayedMediaRect(video) : null;
      const containerRect = container?.getBoundingClientRect() ?? null;
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const orientation =
        viewportWidth > viewportHeight ? "landscape" : viewportWidth < viewportHeight ? "portrait" : "square";

      console.debug("[CTRLX fullscreen viewer]", {
        fullscreenActive: isViewerFullscreen,
        softFullscreenActive: isViewerSoftFullscreen,
        viewport: {
          width: Math.round(viewportWidth),
          height: Math.round(viewportHeight)
        },
        orientation,
        containerRect: containerRect
          ? {
              left: Math.round(containerRect.left),
              top: Math.round(containerRect.top),
              width: Math.round(containerRect.width),
              height: Math.round(containerRect.height)
            }
          : null,
        displayedMediaRect: layout
          ? {
              left: Math.round(layout.mediaRect.left),
              top: Math.round(layout.mediaRect.top),
              width: Math.round(layout.mediaRect.width),
              height: Math.round(layout.mediaRect.height)
            }
          : null
      });
    };

    logFullscreenMetrics();
    window.addEventListener("resize", logFullscreenMetrics);
    window.visualViewport?.addEventListener("resize", logFullscreenMetrics);
    window.screen.orientation?.addEventListener?.("change", logFullscreenMetrics);

    return () => {
      window.removeEventListener("resize", logFullscreenMetrics);
      window.visualViewport?.removeEventListener("resize", logFullscreenMetrics);
      window.screen.orientation?.removeEventListener?.("change", logFullscreenMetrics);
    };
  }, [isScreenVisible, isViewerFullscreen, isViewerSoftFullscreen, videoRef, viewerContainerRef]);

  function handleKeyboardSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = keyboardDraft;
    if (text.length === 0) {
      return;
    }

    onKeyboardSubmit(text);
    setKeyboardDraft("");
  }

  const previousFunctionIdentity = functionIdentityRef.current;
  const functionIdentityChanges = {
    emitViewerInputChanged:
      previousFunctionIdentity.emitViewerInput !== undefined && previousFunctionIdentity.emitViewerInput !== emitViewerInput,
    flushPointerMoveChanged:
      previousFunctionIdentity.flushPointerMove !== undefined &&
      previousFunctionIdentity.flushPointerMove !== flushPointerMove,
    schedulePointerMoveChanged:
      previousFunctionIdentity.schedulePointerMove !== undefined &&
      previousFunctionIdentity.schedulePointerMove !== schedulePointerMove,
    handleKeyboardSubmitChanged:
      previousFunctionIdentity.handleKeyboardSubmit !== undefined &&
      previousFunctionIdentity.handleKeyboardSubmit !== handleKeyboardSubmit
  };

  functionIdentityRef.current = {
    emitViewerInput,
    flushPointerMove,
    schedulePointerMove,
    handleKeyboardSubmit
  };

  const inputDebugState = inputHandler.getDebugState();

  useDevRenderDiagnostics("ControlPanel", {
    isConnected,
    isScreenVisible,
    isStreaming,
    isStreamConnecting,
    isViewerFullscreen,
    isViewerSoftFullscreen,
    viewerMode,
    isKeyboardPanelOpen,
    assignmentSheetOpen: activeAssignmentSlot !== null
  });

  useDevRenderDiagnostics("ControlPanel.LiveViewer", {
    isScreenVisible,
    isStreaming,
    isStreamConnecting,
    isViewerFullscreen,
    isViewerSoftFullscreen,
    streamStatus,
    inputAckState: inputAckStatus?.state ?? null,
    moveAckState: moveLatencyDiagnostic?.ackState ?? null
  });

  useDevRenderDiagnostics("ControlPanel.PointerLayer", {
    isViewerFullscreen,
    pointerModeActive: inputDebugState.pointerModeActive,
    touchModeActive: inputDebugState.touchModeActive,
    mediaRectCached: inputDebugState.mediaRectCached,
    pendingPointerMove: Boolean(pendingPointerMoveSourceRef.current),
    pointerFrameScheduled: pointerMoveFrameRef.current !== null,
    pointerActive: pointerActiveRef.current,
    ...functionIdentityChanges
  });

  useDevRenderDiagnostics("ControlPanel.CommandPad", {
    isConnected,
    assignmentSheetOpen: activeAssignmentSlot !== null,
    assignmentSignature: commandPadAssignments.join("|")
  });

  useDevRenderDiagnostics("ControlPanel.CreateSessionControl", {
    slot: createSessionSlot?.slot ?? null,
    assigned: Boolean(createSessionSlot),
    viewerMode,
    isConnected
  });

  function openAssignmentSheet(slotIndex: number): void {
    setAssignmentSlotIndex(slotIndex);
  }

  function closeAssignmentSheet(): void {
    setAssignmentSlotIndex(null);
  }

  function assignCommandToSlot(slotIndex: number, commandId: CtrlxCommand): void {
    setCommandPadAssignments((current) =>
      current.map((assignment, index) => (index === slotIndex ? commandId : assignment))
    );
    setAssignmentSlotIndex(null);
  }

  function clearAssignedSlot(slotIndex: number): void {
    setCommandPadAssignments((current) =>
      current.map((assignment, index) => (index === slotIndex ? null : assignment))
    );
    setAssignmentSlotIndex(null);
  }

  return (
    <section className="relative flex h-full flex-col overflow-hidden rounded-[36px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,23,34,0.96),rgba(8,13,19,0.98))] p-7 shadow-panel">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(153,247,255,0.12),_transparent_26%),radial-gradient(circle_at_bottom,_rgba(153,247,255,0.06),_transparent_30%)]" />
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Core Controls</p>
          <h2 className="mt-4 text-[2.6rem] font-semibold tracking-[-0.05em] text-ctrlx-text">Logic Surface</h2>
        </div>
        <div className="rounded-full border border-ctrlx-accent/20 bg-ctrlx-accentSoft px-4 py-2 text-xs font-semibold uppercase tracking-ctrlx text-ctrlx-edge shadow-glow">
          Phase 1 MVP
        </div>
      </div>

      <div className="relative z-10 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-ctrlx-muted">
        <span>{isConnected ? "Host paired. Commands are live." : "Connect and pair with the host to enable commands."}</span>
        <div className="flex gap-3">
          {!isViewerFullscreen ? (
            <button
              disabled={!isConnected || !isScreenVisible}
              onClick={isKeyboardPanelOpen ? onCloseKeyboardInputMode : onOpenKeyboardInputMode}
              className="rounded-[16px] border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold uppercase tracking-ctrlx text-ctrlx-muted disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.02] disabled:text-ctrlx-muted/60"
            >
              {isKeyboardPanelOpen ? "Hide Keyboard" : "Keyboard Input"}
            </button>
          ) : null}
          <button
            disabled={!isConnected}
            onClick={onToggleStream}
            className="rounded-[16px] border border-ctrlx-accent/30 bg-[linear-gradient(180deg,rgba(153,247,255,0.17),rgba(153,247,255,0.08))] px-4 py-2 text-xs font-semibold uppercase tracking-ctrlx text-ctrlx-edge disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.02] disabled:text-ctrlx-muted/60"
          >
            {isScreenVisible ? "Hide Screen" : "View Screen"}
          </button>
          <button
            disabled={!isStreaming}
            onClick={onFullscreen}
            className="rounded-[16px] border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold uppercase tracking-ctrlx text-ctrlx-muted disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.02] disabled:text-ctrlx-muted/60"
          >
            {isViewerFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
        </div>
      </div>

      <div className="relative z-10 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-ctrlx-muted">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Audio</p>
          <p className="mt-2 font-medium text-ctrlx-text">{audioStatus}</p>
        </div>
        <div className="flex min-w-[280px] items-center gap-3">
          <button
            disabled={!hasAudioStream}
            onClick={onToggleMute}
            className="rounded-[16px] border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold uppercase tracking-ctrlx text-ctrlx-text disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.02] disabled:text-ctrlx-muted/60"
          >
            {isAudioMuted ? "Unmute" : "Mute"}
          </button>
          <label className="flex flex-1 items-center gap-3 text-xs font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
            <span>Volume</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={audioVolume}
              disabled={!hasAudioStream}
              onChange={(event) => onVolumeChange(Number(event.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[#99f7ff] disabled:cursor-not-allowed"
            />
          </label>
        </div>
      </div>

      {!isViewerFullscreen && isKeyboardPanelOpen ? (
        <div className="relative z-10 mt-4 rounded-[22px] border border-white/10 bg-white/[0.03] p-4 text-sm text-ctrlx-muted">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Keyboard Input</p>
              <p className="mt-2 text-sm text-ctrlx-text">Use your phone keyboard to type into the focused field on the host.</p>
            </div>
            <button
              onClick={onCloseKeyboardInputMode}
              className="rounded-[14px] border border-white/10 bg-white/[0.05] px-3 py-2 text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted"
            >
              Close
            </button>
          </div>

          <form onSubmit={handleKeyboardSubmit} className="mt-4 space-y-3">
            <input
              type="text"
              value={keyboardDraft}
              onChange={(event) => {
                const nextText = event.target.value;
                setKeyboardDraft(nextText);
                onKeyboardDraftChange(nextText);
              }}
              className="w-full rounded-[18px] border border-white/10 bg-ctrlx-panelAlt px-4 py-3 text-sm text-ctrlx-text outline-none transition placeholder:text-ctrlx-muted/60 focus:border-ctrlx-accent/50 focus:bg-[#101926]"
              placeholder="Type for the host..."
              autoCapitalize="sentences"
              autoCorrect="on"
              enterKeyHint="send"
            />
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => {
                  const nextText = keyboardDraft.slice(0, -1);
                  setKeyboardDraft(nextText);
                  onKeyboardDraftChange(nextText, true);
                }}
                className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-ctrlx-text transition hover:border-white/20 hover:bg-white/[0.06]"
              >
                Backspace
              </button>
              <button
                type="button"
                onClick={onKeyboardEnter}
                className="rounded-[18px] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-ctrlx-text transition hover:border-white/20 hover:bg-white/[0.06]"
              >
                Return
              </button>
              <button
                type="submit"
                disabled={keyboardDraft.length === 0}
                className="rounded-[18px] border border-ctrlx-accent/30 bg-[linear-gradient(180deg,rgba(153,247,255,0.17),rgba(153,247,255,0.08))] px-4 py-3 text-sm font-semibold text-ctrlx-edge transition disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.02] disabled:text-ctrlx-muted/60"
              >
                Send Text
              </button>
            </div>
          </form>
        </div>
      ) : null}

      <div
        ref={viewerContainerRef}
        data-fullscreen={isFullscreenPresentationActive ? "true" : "false"}
        className={[
          "relative mt-8 flex flex-1 items-center justify-center overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] transition-[border-radius,margin] duration-200",
          isFullscreenPresentationActive ? "mt-0 rounded-none border-0 bg-black" : ""
          ,
          (isViewerSoftFullscreen || isFullscreenKeyboardOverlayOpen) ? "fixed inset-0 z-[9999] h-[100dvh] w-[100vw]" : ""
        ].join(" ")}
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(153,247,255,0.18),_transparent_30%)]" />
        <div className="absolute h-80 w-80 rounded-full border border-ctrlx-accent/10 bg-ctrlx-accentSoft blur-3xl" />
        {!isFullscreenPresentationActive ? (
          <div className="absolute left-5 top-5 z-10 rounded-full border border-white/10 bg-black/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-ctrlx text-ctrlx-edge backdrop-blur">
            {streamStatus}
          </div>
        ) : null}
        {import.meta.env.DEV && isScreenVisible && inputAckStatus ? (
          <div
            className={[
              "absolute bottom-5 left-5 z-20 max-w-[min(70vw,20rem)] rounded-2xl border px-3 py-2 backdrop-blur transition",
              inputAckStatus.state === "failed"
                ? "border-red-400/25 bg-red-500/10 text-red-100"
                : inputAckStatus.state === "executed"
                  ? "border-emerald-400/25 bg-emerald-500/10 text-emerald-100"
                  : "border-white/10 bg-black/45 text-ctrlx-edge"
            ].join(" ")}
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] opacity-75">Input</span>
              <span className="rounded-full border border-current/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]">
                {inputAckStatus.state}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5">{inputAckStatus.message}</p>
          </div>
        ) : null}
        {DEBUG_MOVE_DIAGNOSTICS && isScreenVisible && moveDiagnosticsHud ? (
          <div className="pointer-events-none absolute bottom-5 right-5 z-20 max-w-[min(72vw,22rem)] rounded-2xl border border-white/10 bg-black/55 px-3 py-2 text-[11px] text-ctrlx-edge backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.22em] opacity-75">Move Debug</span>
              <span className="rounded-full border border-current/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em]">
                {moveDiagnosticsHud.pointerModeActive || moveDiagnosticsHud.touchModeActive ? "active" : "idle"}
              </span>
            </div>
            <p className="mt-1">mode: pointer={String(moveDiagnosticsHud.pointerModeActive)} touch={String(moveDiagnosticsHud.touchModeActive)} fullscreen={String(moveDiagnosticsHud.fullscreenActive)}</p>
            <p>cache/coalesce: rect={String(moveDiagnosticsHud.mediaRectCached)} active={String(moveDiagnosticsHud.coalescingActive)}</p>
            <p>rates: events={moveDiagnosticsHud.pointerEventRate}/s sent={moveDiagnosticsHud.sentMoveRate}/s</p>
            <p>pressure: dropped={moveDiagnosticsHud.droppedMoves} coalesced={moveDiagnosticsHud.coalescedMoves} throttled={moveDiagnosticsHud.throttledFrames}</p>
            {moveDiagnosticsRuntime ? (
              <p>
                transport/host: deferred={moveDiagnosticsRuntime.transportDeferred} replaced={moveDiagnosticsRuntime.transportReplaced} flushed={moveDiagnosticsRuntime.transportFlushed} executed={moveDiagnosticsRuntime.executedMoves} skipped={moveDiagnosticsRuntime.staleSkippedMoves}
              </p>
            ) : null}
            {moveLatencyDiagnostic ? (
              <p>
                latency: state={moveLatencyDiagnostic.ackState} rtt={moveLatencyDiagnostic.roundTripMs ?? "-"}ms queue=
                {moveLatencyDiagnostic.hostQueueMs ?? "-"}ms exec={moveLatencyDiagnostic.hostExecuteMs ?? "-"}ms recv=
                {moveLatencyDiagnostic.hostReceiveTimestamp ?? "-"} start={moveLatencyDiagnostic.hostExecuteStartTimestamp ?? "-"} end=
                {moveLatencyDiagnostic.hostExecuteTimestamp ?? "-"}
              </p>
            ) : null}
          </div>
        ) : null}
        {isFullscreenPresentationActive ? (
          <div
            className="absolute inset-x-0 top-0 z-20 flex items-start justify-between gap-3"
            style={{
              paddingTop: "env(safe-area-inset-top, 0px)",
              paddingLeft: "env(safe-area-inset-left, 0px)",
              paddingRight: "env(safe-area-inset-right, 0px)"
            }}
          >
            <div className="ml-4 mt-4 rounded-full border border-white/10 bg-black/45 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-ctrlx-edge backdrop-blur">
              {streamStatus}
            </div>
            <div className="mr-4 mt-4 flex items-center gap-3">
              <button
                onClick={onOpenKeyboardInputMode}
                className="rounded-full border border-white/15 bg-black/45 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-ctrlx-edge backdrop-blur transition hover:border-ctrlx-accent/50 hover:bg-black/65"
              >
                {isFullscreenKeyboardOverlayOpen ? "Hide Type" : "Type"}
              </button>
              <button
                onClick={onExitFullscreen}
                className="rounded-full border border-white/15 bg-black/55 px-5 py-3 text-xs font-semibold uppercase tracking-ctrlx text-ctrlx-edge backdrop-blur transition hover:border-ctrlx-accent/50 hover:bg-black/70"
              >
                Exit
              </button>
            </div>
          </div>
        ) : null}
        {isFullscreenKeyboardOverlayOpen ? (
          <div
            className="absolute inset-x-0 top-0 z-20"
            style={{
              paddingTop: "calc(env(safe-area-inset-top, 0px) + 4.75rem)",
              paddingLeft: "env(safe-area-inset-left, 0px)",
              paddingRight: "env(safe-area-inset-right, 0px)"
            }}
          >
            <div className="mx-4 rounded-[24px] border border-white/10 bg-black/68 p-3 shadow-[0_18px_55px_rgba(0,0,0,0.45)] backdrop-blur-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-ctrlx-muted">Quick Type</p>
                  <p className="mt-1 text-xs text-ctrlx-edge/90">Type while keeping the live viewer in sight.</p>
                </div>
                <button
                  type="button"
                  onClick={onCloseKeyboardInputMode}
                  className="rounded-full border border-white/15 bg-white/[0.04] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-ctrlx-edge"
                >
                  Close
                </button>
              </div>
              <form onSubmit={handleKeyboardSubmit} className="mt-3 space-y-3">
                <input
                  ref={fullscreenKeyboardInputRef}
                  type="text"
                  value={keyboardDraft}
                  onChange={(event) => {
                    const nextText = event.target.value;
                    setKeyboardDraft(nextText);
                    onKeyboardDraftChange(nextText);
                  }}
                  className="w-full rounded-[18px] border border-white/10 bg-white/[0.06] px-4 py-3 text-sm text-ctrlx-text outline-none transition placeholder:text-ctrlx-muted/60 focus:border-ctrlx-accent/45 focus:bg-white/[0.08]"
                  placeholder="Type for the host..."
                  autoCapitalize="sentences"
                  autoCorrect="on"
                  enterKeyHint="send"
                />
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const nextText = keyboardDraft.slice(0, -1);
                      setKeyboardDraft(nextText);
                      onKeyboardDraftChange(nextText, true);
                    }}
                    className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-xs font-semibold text-ctrlx-text"
                  >
                    Backspace
                  </button>
                  <button
                    type="button"
                    onClick={onKeyboardEnter}
                    className="rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-3 text-xs font-semibold text-ctrlx-text"
                  >
                    Return
                  </button>
                  <button
                    type="submit"
                    disabled={keyboardDraft.length === 0}
                    className="rounded-[16px] border border-ctrlx-accent/30 bg-[linear-gradient(180deg,rgba(153,247,255,0.17),rgba(153,247,255,0.08))] px-3 py-3 text-xs font-semibold text-ctrlx-edge disabled:cursor-not-allowed disabled:border-white/5 disabled:bg-white/[0.02] disabled:text-ctrlx-muted/60"
                  >
                    Send Text
                  </button>
                </div>
              </form>
            </div>
          </div>
        ) : null}
        <div
          className={["relative h-full w-full", isFullscreenPresentationActive ? "p-0" : "p-6"].join(" ")}
          style={
            isFullscreenPresentationActive
              ? {
                  width: "100vw",
                  height: "100dvh",
                  paddingTop: "env(safe-area-inset-top, 0px)",
                  paddingRight: "env(safe-area-inset-right, 0px)",
                  paddingBottom: "env(safe-area-inset-bottom, 0px)",
                  paddingLeft: "env(safe-area-inset-left, 0px)"
                }
              : undefined
          }
        >
          <div
            className={[
              "flex h-full w-full items-center justify-center overflow-hidden border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(153,247,255,0.08),rgba(6,10,16,0.96)_62%)] shadow-[0_0_60px_rgba(153,247,255,0.10),0_35px_80px_rgba(0,0,0,0.4)] transition-[border-radius] duration-200",
              isFullscreenPresentationActive ? "rounded-none border-0 bg-black shadow-none" : "rounded-[28px]"
            ].join(" ")}
          >
            {isScreenVisible ? (
              <div className="relative h-full w-full">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onPointerDown={(event) => {
                    const video = videoRef.current;
                    if (!video || inputHandler.shouldIgnorePointerEvent(event.nativeEvent)) {
                      return;
                    }

                    pointerActiveRef.current = true;
                    if (isViewerFullscreen || CLIENT_EXPERIMENTAL_DRAG) {
                      emitViewerInput(inputHandler.mapPointerDragPhase(video, event.nativeEvent, "pointer_down", isViewerFullscreen));
                    }
                  }}
                  onPointerMove={(event) => {
                    const video = videoRef.current;
                    if (!video || !pointerActiveRef.current || inputHandler.shouldIgnorePointerEvent(event.nativeEvent)) {
                      return;
                    }

                    if (DEBUG_MOVE_DIAGNOSTICS) {
                      moveEventCountRef.current += 1;
                    }
                    inputHandler.handlePointerMoveEvent(event.nativeEvent);
                    if (isViewerFullscreen) {
                      schedulePointerMove({
                        kind: "pointer",
                        pointerId: event.nativeEvent.pointerId
                      });
                    } else if (CLIENT_EXPERIMENTAL_DRAG) {
                      emitViewerInput(inputHandler.mapPointerDragPhase(video, event.nativeEvent, "pointer_move", isViewerFullscreen));
                    }
                  }}
                  onPointerUp={(event) => {
                    const video = videoRef.current;
                    if (!video || inputHandler.shouldIgnorePointerEvent(event.nativeEvent)) {
                      return;
                    }

                    inputHandler.handlePointerTapGesture(video, event.nativeEvent, emitViewerInput, isViewerFullscreen);
                    pointerActiveRef.current = false;
                    pendingPointerMoveSourceRef.current = null;
                    if (pointerMoveFrameRef.current !== null) {
                      window.cancelAnimationFrame(pointerMoveFrameRef.current);
                      pointerMoveFrameRef.current = null;
                    }
                    if (isViewerFullscreen || CLIENT_EXPERIMENTAL_DRAG) {
                      emitViewerInput(inputHandler.mapPointerDragPhase(video, event.nativeEvent, "pointer_up", isViewerFullscreen));
                    }
                    inputHandler.clearPointerGesture(event.nativeEvent.pointerId);
                  }}
                  onPointerCancel={(event) => {
                    pointerActiveRef.current = false;
                    pendingPointerMoveSourceRef.current = null;
                    if (pointerMoveFrameRef.current !== null) {
                      window.cancelAnimationFrame(pointerMoveFrameRef.current);
                      pointerMoveFrameRef.current = null;
                    }
                    inputHandler.clearPointerGesture(event.nativeEvent.pointerId);
                  }}
                  onTouchStart={(event) => {
                    const video = videoRef.current;
                    if (event.touches.length !== 1) {
                      clearLongPressRegionMoveCandidate("touch_count_changed_on_start");
                      endLongPressRegionMove("touch_count_changed_on_start");
                    }
                    if (twoFingerGestureRef.current && event.touches.length !== 2) {
                      cancelTwoFingerGesture("touch_count_changed_on_start");
                      event.preventDefault();
                      return;
                    }
                    if (startTwoFingerGesture(event)) {
                      event.preventDefault();
                      return;
                    }
                    const touch = event.changedTouches[0];
                    if (!video || !touch) {
                      return;
                    }

                    inputHandler.handleTouchStart(touch);
                    inputHandler.primeTouchLayout(video);
                    logGestureDiagnostics("single_touch_start", {
                      activeTouches: event.touches.length,
                      x: Number(touch.clientX.toFixed(2)),
                      y: Number(touch.clientY.toFixed(2))
                    });
                    if (isViewerFullscreen) {
                      const layout = getDisplayedMediaRect(video);
                      if (layout) {
                        const timer = window.setTimeout(() => {
                          const candidate = longPressRegionMoveCandidateRef.current;
                          if (!candidate || candidate.identifier !== touch.identifier) {
                            return;
                          }
                          activateLongPressRegionMove();
                        }, LONG_PRESS_REGION_MOVE_HOLD_MS);

                        longPressRegionMoveCandidateRef.current = {
                          identifier: touch.identifier,
                          layout,
                          startX: touch.clientX,
                          startY: touch.clientY,
                          currentX: touch.clientX,
                          currentY: touch.clientY,
                          timer
                        };

                        logGestureDiagnostics("long_press_pending", {
                          identifier: touch.identifier,
                          holdMs: LONG_PRESS_REGION_MOVE_HOLD_MS,
                          activeTouches: event.touches.length
                        });
                      }
                    }
                    if (isViewerFullscreen || CLIENT_EXPERIMENTAL_DRAG) {
                      emitViewerInput(inputHandler.mapTouchPointerPhase(video, touch, "pointer_down", isViewerFullscreen));
                    }
                  }}
                  onTouchMove={(event) => {
                    const video = videoRef.current;
                    const gesture = twoFingerGestureRef.current;
                    if (gesture) {
                      if (event.touches.length !== 2) {
                        event.preventDefault();
                        cancelTwoFingerGesture("touch_count_changed_on_move");
                        return;
                      }
                      const first = Array.from(event.touches).find((touch) => touch.identifier === gesture.identifiers[0]);
                      const second = Array.from(event.touches).find((touch) => touch.identifier === gesture.identifiers[1]);

                      if (!first || !second) {
                        cancelTwoFingerGesture("tracked_touches_missing");
                        return;
                      }

                      const centerX = (first.clientX + second.clientX) / 2;
                      const centerY = (first.clientY + second.clientY) / 2;
                      const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY);
                      const spreadX = Math.abs(second.clientX - first.clientX);
                      const spreadY = Math.abs(second.clientY - first.clientY);

                      const panDeltaX = centerX - gesture.lastCenterX;
                      const panDeltaY = centerY - gesture.lastCenterY;
                      const panMagnitude = Math.hypot(panDeltaX, panDeltaY);

                      const distanceDelta = distance - gesture.lastDistance;
                      const pinchMagnitude = Math.abs(distanceDelta);
                      const gestureElapsedMs = performance.now() - gesture.holdStartedAt;
                      gesture.maxPanMagnitude = Math.max(gesture.maxPanMagnitude, panMagnitude);
                      gesture.maxPinchMagnitude = Math.max(gesture.maxPinchMagnitude, pinchMagnitude);

                      if (gesture.mode === "pending") {
                        gesture.lockTravelPan += panMagnitude;
                        gesture.lockTravelPinch += pinchMagnitude;

                        logGestureDiagnostics("two_finger_pending", {
                          activeTouches: event.touches.length,
                          centroidDx: Number(panDeltaX.toFixed(2)),
                          centroidDy: Number(panDeltaY.toFixed(2)),
                          centroidTravel: Number(gesture.lockTravelPan.toFixed(2)),
                          distanceDelta: Number(distanceDelta.toFixed(2)),
                          pinchTravel: Number(gesture.lockTravelPinch.toFixed(2))
                        });

                        if (
                          gestureElapsedMs >= REGION_MOVE_HOLD_MS &&
                          gesture.lockTravelPan <= REGION_MOVE_STABILITY_PX &&
                          gesture.lockTravelPinch <= REGION_MOVE_STABILITY_PX
                        ) {
                          gesture.mode = "region_move_ready";
                          logGestureDiagnostics("two_finger_lock", {
                            mode: "region_move_ready",
                            holdMs: REGION_MOVE_HOLD_MS,
                            panTravel: Number(gesture.lockTravelPan.toFixed(2)),
                            pinchTravel: Number(gesture.lockTravelPinch.toFixed(2))
                          });
                        }

                        const lockReached =
                          gesture.lockTravelPan >= TWO_FINGER_GESTURE_LOCK_MIN_DISTANCE_PX ||
                          gesture.lockTravelPinch >= TWO_FINGER_GESTURE_LOCK_MIN_DISTANCE_PX;

                        if (lockReached && gesture.mode === "pending") {
                          const dominantPan = gesture.lockTravelPan;
                          const dominantPinch = gesture.lockTravelPinch;

                          if (dominantPan >= dominantPinch * TWO_FINGER_GESTURE_LOCK_DOMINANCE_RATIO) {
                            gesture.mode = "pan";
                            logGestureDiagnostics("two_finger_lock", {
                              mode: "pan",
                              panTravel: Number(dominantPan.toFixed(2)),
                              pinchTravel: Number(dominantPinch.toFixed(2)),
                              dominanceRatio: TWO_FINGER_GESTURE_LOCK_DOMINANCE_RATIO
                            });
                          } else if (dominantPinch >= dominantPan * TWO_FINGER_GESTURE_LOCK_DOMINANCE_RATIO) {
                            gesture.mode = "pinch";
                            gesture.pinchAxis =
                              spreadX >= spreadY * PINCH_AXIS_DOMINANCE_RATIO
                                ? "horizontal"
                                : spreadY >= spreadX * PINCH_AXIS_DOMINANCE_RATIO
                                  ? "vertical"
                                  : spreadX >= spreadY
                                    ? "horizontal"
                                    : "vertical";
                            logGestureDiagnostics("two_finger_lock", {
                              mode: "pinch",
                              panTravel: Number(dominantPan.toFixed(2)),
                              pinchTravel: Number(dominantPinch.toFixed(2)),
                              dominanceRatio: TWO_FINGER_GESTURE_LOCK_DOMINANCE_RATIO,
                              zoomAxis: gesture.pinchAxis,
                              spreadX: Number(spreadX.toFixed(2)),
                              spreadY: Number(spreadY.toFixed(2))
                            });
                          }
                        }
                      }

                      if (gesture.mode === "region_move_ready") {
                        if (pinchMagnitude > REGION_MOVE_STABILITY_PX) {
                          gesture.mode = "pinch";
                          logGestureDiagnostics("two_finger_lock", {
                            mode: "pinch",
                            reason: "region_move_ready_became_pinch",
                            distanceDelta: Number(distanceDelta.toFixed(2))
                          });
                        } else if (panMagnitude >= REGION_MOVE_START_PX) {
                          gesture.mode = "region_move";
                          emitRegionMovePhase(gesture, "start");
                        }
                      }

                      if (gesture.mode === "pinch" && gesture.pinchAxis === "pending") {
                        if (spreadX >= spreadY * PINCH_AXIS_DOMINANCE_RATIO) {
                          gesture.pinchAxis = "horizontal";
                        } else if (spreadY >= spreadX * PINCH_AXIS_DOMINANCE_RATIO) {
                          gesture.pinchAxis = "vertical";
                        }
                      }

                      if (gesture.mode === "pan") {
                        gesture.pendingPanX += panDeltaX;
                        gesture.pendingPanY += panDeltaY;
                      } else if (gesture.mode === "pinch") {
                        gesture.pendingZoomDistancePx += distanceDelta;

                        const zoomStepCount =
                          Math.trunc(gesture.pendingZoomDistancePx / PINCH_GESTURE_STEP_PX);
                        if (zoomStepCount !== 0) {
                          gesture.pendingZoomSteps += zoomStepCount;
                          gesture.pendingZoomDistancePx -= zoomStepCount * PINCH_GESTURE_STEP_PX;
                        }
                      } else if (gesture.mode === "region_move") {
                        gesture.pendingPanX += panDeltaX;
                        gesture.pendingPanY += panDeltaY;
                      }

                      gesture.lastCenterX = centerX;
                      gesture.lastCenterY = centerY;
                      gesture.lastDistance = distance;
                      gesture.lastSpreadX = spreadX;
                      gesture.lastSpreadY = spreadY;

                      event.preventDefault();
                      scheduleTwoFingerGestureFlush();
                      return;
                    }
                      const touch = event.changedTouches[0];
                    if (!video || !touch) {
                      return;
                    }

                    const activeRegionMove = longPressRegionMoveRef.current;
                    if (activeRegionMove && activeRegionMove.identifier === touch.identifier) {
                      activeRegionMove.currentX = touch.clientX;
                      activeRegionMove.currentY = touch.clientY;
                      activeRegionMove.pendingMove = true;
                      event.preventDefault();
                      scheduleLongPressRegionMove();
                      return;
                    }

                    inputHandler.handleTouchMove(touch);
                    const longPressCandidate = longPressRegionMoveCandidateRef.current;
                    if (longPressCandidate && longPressCandidate.identifier === touch.identifier) {
                      longPressCandidate.currentX = touch.clientX;
                      longPressCandidate.currentY = touch.clientY;
                      const movement = Math.hypot(
                        touch.clientX - longPressCandidate.startX,
                        touch.clientY - longPressCandidate.startY
                      );
                      if (movement > LONG_PRESS_REGION_MOVE_CANCEL_PX) {
                        clearLongPressRegionMoveCandidate("movement_before_hold");
                      }
                    }
                    logGestureDiagnostics("single_touch_move", {
                      activeTouches: event.touches.length,
                      x: Number(touch.clientX.toFixed(2)),
                      y: Number(touch.clientY.toFixed(2))
                    });
                    if (isViewerFullscreen) {
                      if (DEBUG_MOVE_DIAGNOSTICS) {
                        moveEventCountRef.current += 1;
                      }
                      event.preventDefault();
                      schedulePointerMove({
                        kind: "touch",
                        identifier: touch.identifier
                      });
                    }
                  }}
                  onTouchEnd={(event) => {
                    const video = videoRef.current;
                    if (twoFingerGestureRef.current) {
                      event.preventDefault();
                      cancelTwoFingerGesture("touch_end");
                      inputHandler.clearPendingTapGesture("touch");
                      return;
                    }
                    const touch = event.changedTouches[0];
                    if (!video || !touch) {
                      return;
                    }

                    const activeRegionMove = longPressRegionMoveRef.current;
                    if (activeRegionMove && activeRegionMove.identifier === touch.identifier) {
                      activeRegionMove.currentX = touch.clientX;
                      activeRegionMove.currentY = touch.clientY;
                      event.preventDefault();
                      endLongPressRegionMove("touch_end");
                      pendingPointerMoveSourceRef.current = null;
                      if (pointerMoveFrameRef.current !== null) {
                        window.cancelAnimationFrame(pointerMoveFrameRef.current);
                        pointerMoveFrameRef.current = null;
                      }
                      inputHandler.cancelTouchGesture(touch.identifier);
                      return;
                    }

                    const longPressCandidate = longPressRegionMoveCandidateRef.current;
                    if (longPressCandidate && longPressCandidate.identifier === touch.identifier) {
                      clearLongPressRegionMoveCandidate("touch_end_before_hold");
                    }

                    logGestureDiagnostics("single_touch_end", {
                      activeTouches: event.touches.length,
                      x: Number(touch.clientX.toFixed(2)),
                      y: Number(touch.clientY.toFixed(2))
                    });
                    event.preventDefault();
                    pendingPointerMoveSourceRef.current = null;
                    if (pointerMoveFrameRef.current !== null) {
                      window.cancelAnimationFrame(pointerMoveFrameRef.current);
                      pointerMoveFrameRef.current = null;
                    }
                    if (isViewerFullscreen) {
                      emitViewerInput(inputHandler.mapTouchPointerPhase(video, touch, "pointer_up", isViewerFullscreen));
                    }
                    inputHandler.handleTouchEnd(video, touch, emitViewerInput, isViewerFullscreen);
                  }}
                  onTouchCancel={(event) => {
                    if (twoFingerGestureRef.current) {
                      cancelTwoFingerGesture("touch_cancel");
                      inputHandler.clearPendingTapGesture("touch");
                    }
                    const touch = event.changedTouches[0];
                    if (longPressRegionMoveRef.current && touch && longPressRegionMoveRef.current.identifier === touch.identifier) {
                      longPressRegionMoveRef.current.currentX = touch.clientX;
                      longPressRegionMoveRef.current.currentY = touch.clientY;
                      endLongPressRegionMove("touch_cancel");
                    }
                    if (longPressRegionMoveCandidateRef.current && touch && longPressRegionMoveCandidateRef.current.identifier === touch.identifier) {
                      clearLongPressRegionMoveCandidate("touch_cancel");
                    }
                    logGestureDiagnostics("touch_reset", {
                      activeTouches: event.touches.length,
                      identifier: touch?.identifier ?? null,
                      reason: "touch_cancel"
                    });
                    pendingPointerMoveSourceRef.current = null;
                    if (pointerMoveFrameRef.current !== null) {
                      window.cancelAnimationFrame(pointerMoveFrameRef.current);
                      pointerMoveFrameRef.current = null;
                    }
                    inputHandler.cancelTouchGesture(touch?.identifier);
                  }}
                  className={[
                    "h-full w-full transition",
                    isViewerFullscreen ? "object-contain bg-black" : "object-contain",
                    isStreaming ? "opacity-100" : "opacity-0"
                  ].join(" ")}
                  style={{ touchAction: "none" }}
                />
                {import.meta.env.DEV
                  ? debugMarkers.map((marker) => (
                      <div
                        key={marker.id}
                        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-ctrlx-accent/60 bg-ctrlx-accent/15 animate-ping"
                        style={{
                          left: `${marker.xNorm * 100}%`,
                          top: `${marker.yNorm * 100}%`
                        }}
                      />
                    ))
                  : null}
                {CLIENT_DEBUG_CURSOR_MOVE ? (
                  <div
                    ref={cursorDebugOverlayRef}
                    className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-emerald-300/70 bg-emerald-300/25"
                    style={{ left: "50%", top: "50%", opacity: 0 }}
                  />
                ) : null}
                {isStreamConnecting ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-sm">
                    <div className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,23,34,0.96),rgba(9,14,22,0.96))] px-6 py-5 text-center shadow-panel">
                      <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Stream</p>
                      <p className="mt-3 text-lg font-semibold text-ctrlx-edge">Connecting to stream...</p>
                    </div>
                  </div>
                ) : null}
                {!isStreaming && !isStreamConnecting ? (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="rounded-[22px] border border-white/10 bg-black/30 px-6 py-5 text-center backdrop-blur">
                      <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Stream Offline</p>
                      <p className="mt-3 text-sm text-ctrlx-text">Screen view is hidden or disconnected.</p>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="flex h-64 w-64 items-center justify-center rounded-full border border-ctrlx-accent/25 bg-[radial-gradient(circle_at_top,_rgba(153,247,255,0.12),rgba(10,16,24,0.96)_62%)]">
                <div className="flex h-40 w-40 items-center justify-center rounded-full border border-white/10 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
                  <span className="text-center text-sm font-semibold uppercase tracking-[0.22em] text-ctrlx-edge">
                    CTRLX
                    <br />
                    Surface
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="relative z-10 mt-6 md:mt-8">
        <div className="mb-3 flex items-center justify-between gap-3 px-1 md:mb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">Command Pad</p>
            <p className="mt-1.5 text-[13px] text-ctrlx-text md:mt-2 md:text-sm">Mini Stream Deck for fast Logic control.</p>
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-ctrlx-muted md:px-3 md:py-1.5 md:tracking-[0.22em]">
            10 Slots
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 md:gap-3 xl:grid-cols-5">
          {commandPadSlots.map((slot) => {
            const control = slot.control;

            if (!control) {
              return (
                <div
                  key={`slot-${slot.slot}`}
                  className="group relative min-h-[126px] overflow-hidden rounded-[22px] border border-dashed border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),rgba(255,255,255,0.015))] px-3 py-3 text-left text-ctrlx-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_28px_rgba(0,0,0,0.16)] sm:min-h-[136px] sm:rounded-[24px] md:min-h-[144px] md:px-4 md:py-4 md:rounded-[26px]"
                >
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_55%)] opacity-80" />
                  <button
                    type="button"
                    onClick={() => openAssignmentSheet(slot.slot - 1)}
                    aria-label={`Assign command to slot ${slot.slot}`}
                    className="absolute right-2.5 top-2.5 z-10 rounded-full border border-white/10 bg-black/25 p-2 text-ctrlx-muted transition hover:border-white/20 hover:bg-white/[0.06] hover:text-ctrlx-edge active:scale-[0.96] md:right-3 md:top-3 md:p-2.5"
                  >
                    <EditIcon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openAssignmentSheet(slot.slot - 1)}
                    aria-label={`Command slot ${slot.slot} unassigned`}
                    className="relative flex h-full w-full flex-col text-left transition active:translate-y-px active:scale-[0.985]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.025))] text-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:h-12 sm:w-12 sm:rounded-[18px] md:h-14 md:w-14 md:rounded-[20px]">
                        <PlaceholderIcon className="h-5 w-5 sm:h-6 sm:w-6" />
                      </div>
                      <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-ctrlx-muted/70 sm:px-2.5 sm:py-1 sm:text-[10px] sm:tracking-[0.22em]">
                        {slot.slot}
                      </span>
                    </div>
                    <strong className="mt-4 block text-[14px] font-semibold leading-5 tracking-[-0.02em] text-ctrlx-text/85 sm:text-[15px] md:mt-5 md:text-base">
                      Unassigned
                    </strong>
                    <span className="mt-1.5 block text-[10px] font-semibold uppercase tracking-[0.16em] text-ctrlx-muted/70 sm:text-[11px] sm:tracking-[0.18em] md:mt-2">
                      Tap to assign
                    </span>
                  </button>
                </div>
              );
            }

            return (
              <div
                key={control.id}
                className={[
                  "group relative min-h-[126px] overflow-hidden rounded-[22px] border px-3 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_16px_34px_rgba(0,0,0,0.2)] transition sm:min-h-[136px] sm:rounded-[24px] md:min-h-[144px] md:px-4 md:py-4 md:rounded-[26px]",
                  control.accent
                    ? "border-ctrlx-accent/30 bg-[linear-gradient(180deg,rgba(153,247,255,0.18),rgba(153,247,255,0.08))] text-ctrlx-edge hover:border-ctrlx-accent/60 hover:bg-ctrlx-accent/20"
                    : "border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] text-ctrlx-text hover:border-white/20 hover:bg-white/[0.06]"
                ].join(" ")}
              >
                <div className={["pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70 transition group-hover:opacity-100", control.tone].join(" ")} />
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_58%)] opacity-90" />
                <button
                  type="button"
                  onClick={() => openAssignmentSheet(slot.slot - 1)}
                  aria-label={`Manage slot ${slot.slot}`}
                  className="absolute right-2.5 top-2.5 z-10 rounded-full border border-white/10 bg-black/25 p-2 text-ctrlx-edge/80 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-ctrlx-edge active:scale-[0.96] md:right-3 md:top-3 md:p-2.5"
                  >
                  <EditIcon className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={!isConnected}
                  onClick={() => onCommand(control.id)}
                  aria-label={control.label}
                  className="relative flex h-full w-full flex-col text-left transition active:translate-y-px active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div
                      className={[
                        "flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition sm:h-12 sm:w-12 sm:rounded-[18px] md:h-14 md:w-14 md:rounded-[20px]",
                        control.accent
                          ? "border-ctrlx-accent/25 bg-[linear-gradient(180deg,rgba(0,0,0,0.24),rgba(0,0,0,0.12))] text-ctrlx-edge"
                          : "border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.035))] text-white/90 group-hover:border-white/20"
                      ].join(" ")}
                    >
                      <control.Icon className="h-5 w-5 sm:h-6 sm:w-6 md:h-7 md:w-7" />
                    </div>
                    <div className="mr-10 flex flex-col items-end gap-2">
                      <span className="rounded-full border border-white/10 bg-black/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.2em] text-ctrlx-muted transition group-hover:text-ctrlx-edge sm:px-2.5 sm:py-1 sm:text-[10px] sm:tracking-[0.22em]">
                        {slot.slot}
                      </span>
                      <span className="text-[9px] font-semibold uppercase tracking-[0.16em] text-ctrlx-muted transition group-hover:text-ctrlx-edge sm:text-[10px] sm:tracking-[0.18em]">
                        {control.summary}
                      </span>
                    </div>
                  </div>
                  <strong className="relative mt-4 block text-[14px] font-semibold leading-5 tracking-[-0.02em] sm:text-[15px] md:mt-5">
                    {control.label}
                  </strong>
                </button>
              </div>
            );
          })}
        </div>
      </div>
      {!isViewerFullscreen && activeAssignmentSlot ? (
        <div className="absolute inset-0 z-30 flex items-end bg-black/50 backdrop-blur-sm">
          <div className="w-full rounded-t-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(16,23,34,0.98),rgba(8,13,19,0.99))] p-5 shadow-panel">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">
                  Assign Command
                </p>
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-ctrlx-text">
                  Slot {activeAssignmentSlot.slot}
                </h3>
                <p className="mt-2 text-sm text-ctrlx-muted">
                  Choose a Logic command for this pad button.
                </p>
              </div>
              <button
                type="button"
                onClick={closeAssignmentSheet}
                aria-label="Close command assignment"
                className="rounded-full border border-white/10 bg-white/[0.04] p-2 text-ctrlx-muted transition hover:border-white/20 hover:bg-white/[0.06] hover:text-ctrlx-edge"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid max-h-[52vh] gap-3 overflow-y-auto pr-1">
              {commandCatalog.map((command) => {
                const isSelected = activeAssignmentSlot.control?.id === command.id;
                return (
                  <button
                    key={`${activeAssignmentSlot.slot}-${command.id}`}
                    type="button"
                    onClick={() => assignCommandToSlot(activeAssignmentSlot.slot - 1, command.id)}
                    className={[
                      "flex items-center gap-4 rounded-[22px] border px-4 py-4 text-left transition",
                      isSelected
                        ? "border-ctrlx-accent/45 bg-ctrlx-accent/10 text-ctrlx-edge"
                        : "border-white/10 bg-white/[0.03] text-ctrlx-text hover:border-white/20 hover:bg-white/[0.05]"
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border",
                        isSelected
                          ? "border-ctrlx-accent/35 bg-black/20"
                          : "border-white/10 bg-white/[0.04]"
                      ].join(" ")}
                    >
                      <command.Icon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <strong className="block text-base font-semibold tracking-[-0.02em]">{command.label}</strong>
                      <span className="mt-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-ctrlx-muted">
                        {command.category}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => clearAssignedSlot(activeAssignmentSlot.slot - 1)}
                className="rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-ctrlx-text transition hover:border-white/20 hover:bg-white/[0.05]"
              >
                Clear Slot
              </button>
              <button
                type="button"
                onClick={closeAssignmentSheet}
                className="rounded-[18px] border border-ctrlx-accent/30 bg-[linear-gradient(180deg,rgba(153,247,255,0.17),rgba(153,247,255,0.08))] px-4 py-3 text-sm font-semibold text-ctrlx-edge transition hover:border-ctrlx-accent/55"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
