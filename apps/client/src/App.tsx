import { useEffect, useMemo, useRef, useState } from "react";
import {
  CtrlxCommand,
  CtrlxMessageType,
  type ImportAutomationExecutionReport,
  type ImportAutomationItem,
  type ImportAutomationPlan,
  type ImportExecutionProgressUpdate,
  type AckMessage,
  type CtrlxHostMessage,
  type StreamIceMessage,
  type StreamOfferMessage,
  type StreamStatusMessage
} from "@ctrlx/protocol";
import {
  createCtrlxActionLayer,
  createReviewedImportWorkflowRequest,
  normalizeUploadedImportPlan
} from "./actionLayer";
import { AssistantPanel } from "./components/AssistantPanel";
import { ConnectionPanel } from "./components/ConnectionPanel";
import { ControlPanel } from "./components/ControlPanel";
import { createClientId } from "./id";
import { ViewerInputHandler, type ViewerInputPayload } from "./inputHandler";
import { CtrlxWebRtcClient } from "./webrtc";
import {
  CtrlxWsClient,
  createClientLogEntry,
  type ClientLogEntry,
  type ConnectionStatus,
  type PointerMoveTransportEvent
} from "./ws";

const shellClassName =
  "min-h-screen bg-[#070b11] text-white bg-[radial-gradient(circle_at_top,_rgba(153,247,255,0.12),_transparent_24%),radial-gradient(circle_at_bottom_left,_rgba(153,247,255,0.05),_transparent_28%),linear-gradient(180deg,_#05080d_0%,_#070b11_55%,_#05070a_100%)]";

type FullscreenCapableElement = HTMLDivElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

type WebkitFullscreenVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
  webkitDisplayingFullscreen?: boolean;
};

type ScreenOrientationWithLock = ScreenOrientation & {
  lock?: (orientation: "landscape" | "portrait" | "any") => Promise<void>;
  unlock?: () => void;
};

type InputAckDebugState = {
  requestId: string;
  state: "sent" | AckMessage["payload"]["state"];
  message: string;
  ok: boolean;
  at: number;
};

type InputLatencyDiagnostic = {
  action: ViewerInputPayload["action"];
  eventTimestamp: number;
  clientSendAt: number;
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
  ackState: AckMessage["payload"]["state"];
};

type MoveDiagnosticsRuntime = {
  transportDeferred: number;
  transportReplaced: number;
  transportFlushed: number;
  executedMoves: number;
  staleSkippedMoves: number;
};

type ViewerMode = "normal_mode" | "fullscreen_view_mode" | "keyboard_input_mode";

export type ImportReviewSuggestionOverride = {
  suggestedOrder?: number;
  suggestedGroupLabel?: string;
  suggestedStackLabel?: string;
  suggestedBusLabel?: string;
};

const DEBUG_INPUT_LATENCY =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugLatency") === "1";
const DEBUG_CURSOR_MOVE =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugCursorMove") === "1";
const DEBUG_MOVE_DIAGNOSTICS =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugMoveDiagnostics") === "1";
const DEBUG_KEYBOARD_INPUT =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  (window.localStorage.getItem("ctrlx.debugKeyboard") === "1" ||
    window.localStorage.getItem("ctrlx.debugControl") === "1");
const DEBUG_RENDER_DIAGNOSTICS =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugRenders") === "1";
const KEYBOARD_LIVE_SYNC_MS = 70;

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

async function tryLockLandscapeOrientation(): Promise<void> {
  const orientation = window.screen.orientation as ScreenOrientationWithLock | undefined;
  if (!orientation?.lock) {
    return;
  }

  try {
    await orientation.lock("landscape");
  } catch {
    // Browser/device can reject this. Fullscreen still works without a lock.
  }
}

function tryUnlockOrientation(): void {
  const orientation = window.screen.orientation as ScreenOrientationWithLock | undefined;
  try {
    orientation?.unlock?.();
  } catch {
    // Ignore unsupported browsers.
  }
}

export default function App() {
  const appendClientLog = (
    level: ClientLogEntry["level"],
    message: string,
    source: ClientLogEntry["source"] = "client"
  ) => {
    setLogs((current: ClientLogEntry[]) => [createClientLogEntry(level, message, source), ...current].slice(0, 20));
  };

  const [host, setHost] = useState(() => window.location.hostname || "localhost");
  const [sessionCode, setSessionCode] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [statusMessage, setStatusMessage] = useState("Disconnected");
  const [assistantPrompt, setAssistantPrompt] = useState("");
  const [isScreenVisible, setIsScreenVisible] = useState(false);
  const [streamStatus, setStreamStatus] = useState("Idle");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [audioTrackCount, setAudioTrackCount] = useState(0);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [audioVolume, setAudioVolume] = useState(0.85);
  const [isViewerFullscreen, setIsViewerFullscreen] = useState(false);
  const [isViewerSoftFullscreen, setIsViewerSoftFullscreen] = useState(false);
  const [isKeyboardInputMode, setIsKeyboardInputMode] = useState(false);
  const [isFullscreenKeyboardOverlayOpen, setIsFullscreenKeyboardOverlayOpen] = useState(false);
  const [inputAckStatus, setInputAckStatus] = useState<InputAckDebugState | null>(null);
  const [moveLatencyDiagnostic, setMoveLatencyDiagnostic] = useState<MoveLatencyDiagnostic | null>(null);
  const [moveDiagnosticsRuntime, setMoveDiagnosticsRuntime] = useState<MoveDiagnosticsRuntime | null>(null);
  const [logs, setLogs] = useState<ClientLogEntry[]>([
    createClientLogEntry("info", "CTRLX client ready. Enter a host address and session code to connect.", "client")
  ]);
  const [importPlanItems, setImportPlanItems] = useState<ImportAutomationItem[]>([]);
  const [importReviewPlan, setImportReviewPlan] = useState<ImportAutomationPlan | null>(null);
  const [importReviewSuggestionOverrides, setImportReviewSuggestionOverrides] = useState<
    ImportReviewSuggestionOverride[]
  >([]);
  const [importReviewSessionId, setImportReviewSessionId] = useState<string | null>(null);
  const [importExecutionReport, setImportExecutionReport] = useState<ImportAutomationExecutionReport | null>(null);
  const [importExecutionProgressUpdates, setImportExecutionProgressUpdates] = useState<ImportExecutionProgressUpdate[]>([]);
  const [isImportPlanExecuting, setIsImportPlanExecuting] = useState(false);
  const [isImportPlanLoading, setIsImportPlanLoading] = useState(false);
  const [importPlanSourceLabel, setImportPlanSourceLabel] = useState<string | null>(null);

  const wsRef = useRef<CtrlxWsClient | null>(null);
  const webrtcRef = useRef<CtrlxWebRtcClient | null>(null);
  const inputHandlerRef = useRef<ViewerInputHandler | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  const inputDiagnosticsRef = useRef(new Map<string, InputLatencyDiagnostic>());
  const transportDeferredCountRef = useRef(0);
  const transportReplacedCountRef = useRef(0);
  const transportFlushedCountRef = useRef(0);
  const executedMoveCountRef = useRef(0);
  const staleSkippedMoveCountRef = useRef(0);
  const isViewerSoftFullscreenRef = useRef(false);
  const isFullscreenKeyboardOverlayOpenRef = useRef(false);
  const fullscreenKeyboardIntentRef = useRef(false);
  const keyboardDraftRef = useRef("");
  const keyboardSyncedDraftRef = useRef("");
  const keyboardSyncTimerRef = useRef<number | null>(null);

  useEffect(() => {
    isViewerSoftFullscreenRef.current = isViewerSoftFullscreen;
  }, [isViewerSoftFullscreen]);

  useEffect(() => {
    isFullscreenKeyboardOverlayOpenRef.current = isFullscreenKeyboardOverlayOpen;
  }, [isFullscreenKeyboardOverlayOpen]);

  if (!inputHandlerRef.current) {
    inputHandlerRef.current = new ViewerInputHandler();
  }

  const inputHandler = inputHandlerRef.current;

  if (!webrtcRef.current) {
    webrtcRef.current = new CtrlxWebRtcClient({
      onRemoteStream: (stream) => {
        setRemoteStream(stream);
      },
      onStatusChange: (nextStatus) => {
        setStreamStatus(nextStatus);
      },
      sendStreamRequest: (action) => {
        wsRef.current?.sendStreamRequest(action);
      },
      sendAnswer: (payload) => {
        wsRef.current?.sendStreamAnswer(payload);
      },
      sendIceCandidate: (payload) => {
        wsRef.current?.sendStreamIceCandidate(payload);
      },
      log: (message, level = "info") => {
        appendClientLog(level, message, "webrtc");
      }
    });
  }

  if (!wsRef.current) {
    wsRef.current = new CtrlxWsClient({
      onStatusChange: (nextStatus, message) => {
        setStatus(nextStatus);
        setStatusMessage(message ?? nextStatus);
      },
      onMessage: (message: CtrlxHostMessage) => {
        if (
          message.type === CtrlxMessageType.StreamOffer ||
          message.type === CtrlxMessageType.StreamIce ||
          message.type === CtrlxMessageType.StreamStatus
        ) {
          void webrtcRef.current?.handleSignal(
            message as StreamOfferMessage | StreamIceMessage | StreamStatusMessage
          );
        }

        if (
          message.type === CtrlxMessageType.Status &&
          message.payload.data &&
          typeof message.payload.data === "object" &&
          "kind" in message.payload.data &&
          message.payload.data.kind === "import_execution"
        ) {
          if ("keepAlive" in message.payload.data && message.payload.data.keepAlive === true) {
            return;
          }
          setImportExecutionProgressUpdates((current) => [
            message.payload.data as unknown as ImportExecutionProgressUpdate,
            ...current
          ].slice(0, 40));
        }
      },
      onLog: (entry) => {
        setLogs((current: ClientLogEntry[]) => [entry, ...current].slice(0, 20));
      },
      onAck: (message) => {
        const ackRequestId = message.payload.ackFor ?? message.requestId ?? createClientId();
        const diagnostic = inputDiagnosticsRef.current.get(ackRequestId);
        const shouldSurfaceAck =
          message.payload.data?.action !== "pointer_move" && diagnostic?.action !== "pointer_move"
            ? true
            : DEBUG_CURSOR_MOVE;

        if (DEBUG_INPUT_LATENCY && diagnostic) {
          const hostReceivedAt =
            typeof message.payload.data?.hostReceivedAt === "number" ? message.payload.data.hostReceivedAt : null;
          const hostExecuteStartAt =
            typeof message.payload.data?.hostExecuteStartAt === "number" ? message.payload.data.hostExecuteStartAt : null;
          const hostExecutedAt =
            typeof message.payload.data?.hostExecutedAt === "number" ? message.payload.data.hostExecutedAt : null;
          const now = Date.now();
          console.debug("[CTRLX latency]", {
            requestId: ackRequestId,
            action: diagnostic.action,
            state: message.payload.state,
            clientEventTimestamp: diagnostic.eventTimestamp,
            clientSendTimestamp: diagnostic.clientSendAt,
            hostReceiveTimestamp: hostReceivedAt,
            hostExecuteStartTimestamp: hostExecuteStartAt,
            hostExecuteTimestamp: hostExecutedAt,
            roundTripMs: now - diagnostic.clientSendAt,
            eventToAckMs: now - diagnostic.eventTimestamp,
            hostQueueMs: hostReceivedAt ? hostReceivedAt - diagnostic.clientSendAt : null,
            hostExecuteMs: hostExecuteStartAt && hostExecutedAt ? hostExecutedAt - hostExecuteStartAt : null
          });
        }

        if (DEBUG_MOVE_DIAGNOSTICS && diagnostic?.action === "pointer_move") {
          const hostReceivedAt =
            typeof message.payload.data?.hostReceivedAt === "number" ? message.payload.data.hostReceivedAt : null;
          const hostExecuteStartAt =
            typeof message.payload.data?.hostExecuteStartAt === "number" ? message.payload.data.hostExecuteStartAt : null;
          const hostExecutedAt =
            typeof message.payload.data?.hostExecutedAt === "number" ? message.payload.data.hostExecutedAt : null;
          const now = Date.now();
          setMoveLatencyDiagnostic({
            requestId: ackRequestId,
            clientEventTimestamp: diagnostic.eventTimestamp,
            clientSendTimestamp: diagnostic.clientSendAt,
            hostReceiveTimestamp: hostReceivedAt,
            hostExecuteStartTimestamp: hostExecuteStartAt,
            hostExecuteTimestamp: hostExecutedAt,
            roundTripMs: message.payload.state === "executed" || message.payload.state === "failed" ? now - diagnostic.clientSendAt : null,
            hostQueueMs: hostExecuteStartAt ? hostExecuteStartAt - diagnostic.clientSendAt : hostReceivedAt ? hostReceivedAt - diagnostic.clientSendAt : null,
            hostExecuteMs: hostExecuteStartAt && hostExecutedAt ? hostExecutedAt - hostExecuteStartAt : null,
            ackState: message.payload.state
          });
        }

        if (message.payload.data?.action === "pointer_move") {
          if (message.payload.state === "executed") {
            executedMoveCountRef.current += 1;
          } else if (
            message.payload.state === "failed" &&
            typeof message.payload.reason === "string" &&
            (message.payload.reason.includes("Superseded") || message.payload.reason.includes("Skipped"))
          ) {
            staleSkippedMoveCountRef.current += 1;
          }
        }

        if (message.payload.state === "executed" || message.payload.state === "failed") {
          inputDiagnosticsRef.current.delete(ackRequestId);
        }

        if (!shouldSurfaceAck) {
          if (
            DEBUG_KEYBOARD_INPUT &&
            typeof message.payload.data?.action === "string" &&
            (message.payload.data.action === "insert_text" ||
              message.payload.data.action === "backspace" ||
              message.payload.data.action === "enter" ||
              message.payload.data.action === "escape")
          ) {
            console.debug("[CTRLX keyboard ack]", {
              requestId: ackRequestId,
              state: message.payload.state,
              ok: message.payload.ok,
              reason: message.payload.reason,
              message: message.payload.message,
              data: message.payload.data
            });
          }
          return;
        }

        if (
          DEBUG_KEYBOARD_INPUT &&
          typeof message.payload.data?.action === "string" &&
          (message.payload.data.action === "insert_text" ||
            message.payload.data.action === "backspace" ||
            message.payload.data.action === "enter" ||
            message.payload.data.action === "escape")
        ) {
          console.debug("[CTRLX keyboard ack]", {
            requestId: ackRequestId,
            state: message.payload.state,
            ok: message.payload.ok,
            reason: message.payload.reason,
            message: message.payload.message,
            data: message.payload.data
          });
        }

        setInputAckStatus({
          requestId: ackRequestId,
          state: message.payload.state,
          message:
            message.payload.state === "failed"
              ? message.payload.reason ?? message.payload.message ?? "Host input failed."
              : message.payload.message ?? `Host ack: ${message.payload.state}`,
          ok: message.payload.ok,
          at: Date.now()
        });
      },
      onPointerMoveTransportEvent: (event: PointerMoveTransportEvent) => {
        if (!DEBUG_MOVE_DIAGNOSTICS) {
          return;
        }

        if (event.kind === "deferred") {
          transportDeferredCountRef.current += 1;
        } else if (event.kind === "replaced") {
          transportReplacedCountRef.current += 1;
        } else if (event.kind === "flushed") {
          transportFlushedCountRef.current += 1;
        }
      }
    });
  }

  const ws = wsRef.current;
  const webrtc = webrtcRef.current;
  const actionLayer = useMemo(() => createCtrlxActionLayer({ transport: ws }), [ws]);

  useEffect(() => {
    if (!DEBUG_MOVE_DIAGNOSTICS) {
      setMoveDiagnosticsRuntime(null);
      return;
    }

    const interval = window.setInterval(() => {
      setMoveDiagnosticsRuntime({
        transportDeferred: transportDeferredCountRef.current,
        transportReplaced: transportReplacedCountRef.current,
        transportFlushed: transportFlushedCountRef.current,
        executedMoves: executedMoveCountRef.current,
        staleSkippedMoves: staleSkippedMoveCountRef.current
      });
    }, 500);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!videoRef.current) {
      return;
    }

    videoRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  useEffect(() => {
    if (!audioRef.current) {
      return;
    }

    audioRef.current.srcObject = remoteStream;
    audioRef.current.muted = isAudioMuted;
    audioRef.current.volume = audioVolume;

    if (remoteStream) {
      void audioRef.current.play().catch(() => undefined);
    } else {
      audioRef.current.pause();
    }
  }, [remoteStream, isAudioMuted, audioVolume]);

  useEffect(() => {
    if (!remoteStream) {
      setAudioTrackCount(0);
      return;
    }

    const syncAudioTracks = () => {
      setAudioTrackCount(remoteStream.getAudioTracks().length);
    };

    syncAudioTracks();
    remoteStream.addEventListener("addtrack", syncAudioTracks);
    remoteStream.addEventListener("removetrack", syncAudioTracks);

    return () => {
      remoteStream.removeEventListener("addtrack", syncAudioTracks);
      remoteStream.removeEventListener("removetrack", syncAudioTracks);
    };
  }, [remoteStream]);

  useEffect(() => {
    if (status === "paired") {
      return;
    }

    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }

    setIsScreenVisible(false);
    setIsViewerSoftFullscreen(false);
    setRemoteStream(null);
    setAudioTrackCount(0);
    setStreamStatus("Idle");
    setIsKeyboardInputMode(false);
    setInputAckStatus(null);
    setMoveLatencyDiagnostic(null);
    inputDiagnosticsRef.current.clear();
    transportDeferredCountRef.current = 0;
    transportReplacedCountRef.current = 0;
    transportFlushedCountRef.current = 0;
    executedMoveCountRef.current = 0;
    staleSkippedMoveCountRef.current = 0;
    keyboardDraftRef.current = "";
    keyboardSyncedDraftRef.current = "";
    if (keyboardSyncTimerRef.current) {
      window.clearTimeout(keyboardSyncTimerRef.current);
      keyboardSyncTimerRef.current = null;
    }
    webrtc.stop();
    tryUnlockOrientation();
  }, [status, webrtc]);

  useEffect(() => {
    if (!import.meta.env.DEV || !inputAckStatus) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setInputAckStatus((current) => {
        if (!current || current.requestId !== inputAckStatus.requestId) {
          return current;
        }

        return null;
      });
    }, inputAckStatus.state === "failed" ? 2200 : 1200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [inputAckStatus]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const videoElement = videoRef.current as WebkitFullscreenVideoElement | null;
      setIsViewerFullscreen(
        document.fullscreenElement === viewerContainerRef.current ||
          Boolean(videoElement?.webkitDisplayingFullscreen) ||
          isViewerSoftFullscreenRef.current ||
          isFullscreenKeyboardOverlayOpenRef.current
      );
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (document.fullscreenElement === viewerContainerRef.current) {
          void document.exitFullscreen().catch(() => undefined);
        }

        if (isViewerSoftFullscreenRef.current) {
          setIsViewerSoftFullscreen(false);
          setIsViewerFullscreen(false);
          fullscreenKeyboardIntentRef.current = false;
          setIsFullscreenKeyboardOverlayOpen(false);
          tryUnlockOrientation();
        }
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange as EventListener);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange as EventListener);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (isViewerFullscreen) {
      setIsKeyboardInputMode(false);
      return;
    }

    if (fullscreenKeyboardIntentRef.current) {
      return;
    }

    setIsFullscreenKeyboardOverlayOpen(false);
  }, [isViewerFullscreen]);

  const headerStatus = useMemo(() => {
    switch (status) {
      case "paired":
        return "Paired";
      case "connecting":
        return "Connecting";
      case "error":
        return "Attention Needed";
      default:
        return "Offline";
    }
  }, [status]);

  const isPaired = status === "paired";

  useDevRenderDiagnostics("App", {
    status,
    statusMessage,
    isScreenVisible,
    streamStatus,
    remoteStreamActive: Boolean(remoteStream),
    audioTrackCount,
    isViewerFullscreen,
    isViewerSoftFullscreen,
    isKeyboardInputMode,
    isFullscreenKeyboardOverlayOpen,
    logsLength: logs.length,
    inputAckState: inputAckStatus?.state ?? null,
    moveAckState: moveLatencyDiagnostic?.ackState ?? null
  });

  function handleConnect() {
    ws.connect(host, sessionCode);
  }

  function handleDisconnect() {
    setIsScreenVisible(false);
    setIsViewerSoftFullscreen(false);
    setRemoteStream(null);
    setAudioTrackCount(0);
    setStreamStatus("Disconnected");
    setIsKeyboardInputMode(false);
    setInputAckStatus(null);
    setMoveLatencyDiagnostic(null);
    inputDiagnosticsRef.current.clear();
    resetKeyboardDraftSyncState();
    webrtc.stop();
    tryUnlockOrientation();
    ws.disconnect();
  }

  function handleCommand(command: CtrlxCommand) {
    actionLayer.sendLiveCommand(command);
  }

  function handleViewerInput(payload: ViewerInputPayload) {
    const requestId =
      payload.action === "pointer_move"
        ? ws.sendPointerMoveEvent(payload)
        : ws.sendInputEvent(payload);
    if (!requestId) {
      return;
    }

    const shouldTrackMoveDiagnostics = payload.action !== "pointer_move" || DEBUG_INPUT_LATENCY || DEBUG_CURSOR_MOVE;
    if (shouldTrackMoveDiagnostics) {
      inputDiagnosticsRef.current.set(requestId, {
        action: payload.action,
        eventTimestamp: payload.timestamp,
        clientSendAt: Date.now()
      });
    }

    if (!import.meta.env.DEV) {
      return;
    }

    if (payload.action === "pointer_move" && !DEBUG_CURSOR_MOVE) {
      return;
    }

    setInputAckStatus({
      requestId,
      state: "sent",
      message: `Sent ${payload.action} input.`,
      ok: true,
      at: Date.now()
    });
  }

  function resetKeyboardDraftSyncState(): void {
    keyboardDraftRef.current = "";
    keyboardSyncedDraftRef.current = "";
    if (keyboardSyncTimerRef.current) {
      window.clearTimeout(keyboardSyncTimerRef.current);
      keyboardSyncTimerRef.current = null;
    }
  }

  function flushKeyboardDraftSync(): void {
    if (isViewerFullscreen && !isFullscreenKeyboardOverlayOpen) {
      return;
    }

    const targetText = keyboardDraftRef.current;
    const syncedText = keyboardSyncedDraftRef.current;
    if (targetText === syncedText) {
      return;
    }

    let prefixLength = 0;
    const maxPrefixLength = Math.min(targetText.length, syncedText.length);
    while (
      prefixLength < maxPrefixLength &&
      targetText.charCodeAt(prefixLength) === syncedText.charCodeAt(prefixLength)
    ) {
      prefixLength += 1;
    }

    const removeCount = syncedText.length - prefixLength;
    const insertText = targetText.slice(prefixLength);
    let nextSyncedText = syncedText;

    for (let index = 0; index < removeCount; index += 1) {
      const requestId = ws.sendKeyboardInput({
        action: "backspace",
        timestamp: Date.now()
      });

      if (!requestId) {
        return;
      }

      nextSyncedText = nextSyncedText.slice(0, -1);
    }

    if (insertText.length > 0) {
      const requestId = ws.sendKeyboardInput({
        action: "insert_text",
        text: insertText,
        timestamp: Date.now()
      });

      if (!requestId) {
        return;
      }

      nextSyncedText = nextSyncedText.slice(0, prefixLength) + insertText;
    }

    keyboardSyncedDraftRef.current = nextSyncedText;

    if (DEBUG_KEYBOARD_INPUT) {
      console.debug("[CTRLX keyboard live sync]", {
        targetText,
        syncedText,
        nextSyncedText,
        prefixLength,
        removeCount,
        insertText
      });
    }
  }

  function handleKeyboardDraftChange(nextText: string, immediate = false) {
    keyboardDraftRef.current = nextText;

    if (keyboardSyncTimerRef.current) {
      window.clearTimeout(keyboardSyncTimerRef.current);
      keyboardSyncTimerRef.current = null;
    }

    if (immediate) {
      flushKeyboardDraftSync();
      return;
    }

    keyboardSyncTimerRef.current = window.setTimeout(() => {
      keyboardSyncTimerRef.current = null;
      flushKeyboardDraftSync();
    }, KEYBOARD_LIVE_SYNC_MS);
  }

  function handleKeyboardSubmit(text: string) {
    keyboardDraftRef.current = text;
    flushKeyboardDraftSync();
    resetKeyboardDraftSyncState();
  }

  function handleKeyboardEnter() {
    flushKeyboardDraftSync();

    const requestId = ws.sendKeyboardInput({
      action: "enter",
      timestamp: Date.now()
    });

    if (!requestId || !import.meta.env.DEV) {
      return;
    }

    setInputAckStatus({
      requestId,
      state: "sent",
      message: "Sent return.",
      ok: true,
      at: Date.now()
    });
  }

  function handleAssistantSend() {
    appendClientLog(
      "info",
      assistantPrompt.trim()
        ? `Assistant placeholder received: ${assistantPrompt.trim()}`
        : "Assistant placeholder invoked with empty prompt.",
      "client"
    );
    setAssistantPrompt("");
  }

  async function requestHostImportSelection() {
    setIsImportPlanLoading(true);
    setImportExecutionReport(null);
    setImportExecutionProgressUpdates([]);

    try {
      const result = await actionLayer.requestHostImportSelection(true);
      if (result.cancelled) {
        appendClientLog("info", "Host import selection was cancelled.", "import");
        return;
      }
      const plan = normalizeUploadedImportPlan(result.plan);
      const items = plan.items;

      setImportReviewSessionId(result.sessionId);
      setImportReviewPlan(plan);
      setImportPlanItems(items);
      setImportReviewSuggestionOverrides(items.map(() => ({})));
      setImportPlanSourceLabel(
        `${result.sourceName} (${result.acceptedCount} audio file${result.acceptedCount === 1 ? "" : "s"})`
      );
      appendClientLog(
        "info",
        result.acceptedCount > 0
          ? `Host selected ${result.acceptedCount} audio file${result.acceptedCount === 1 ? "" : "s"} from ${result.sourceName}${result.skippedCount > 0 ? ` (${result.skippedCount} skipped)` : ""}.`
          : `No supported audio files were found in ${result.sourceName}.`,
        "import"
      );
    } catch (error) {
      appendClientLog(
        "error",
        error instanceof Error ? error.message : "Failed to request host import selection.",
        "import"
      );
    } finally {
      setIsImportPlanLoading(false);
    }
  }

  function handleUpdateImportPlanItem(
    index: number,
    patch: Partial<Pick<ImportAutomationItem, "cleanTrackName" | "detectedCategory" | "assignedColor">>
  ) {
    setImportExecutionReport(null);
    setImportPlanItems((current) => {
      const nextItems = current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item));
      setImportReviewPlan((currentPlan) =>
        currentPlan
          ? {
              ...currentPlan,
              items: nextItems
            }
          : currentPlan
      );
      return nextItems;
    });
  }

  function handleUpdateImportPlanSuggestion(
    index: number,
    patch: Partial<ImportReviewSuggestionOverride>
  ) {
    setImportExecutionReport(null);
    setImportReviewSuggestionOverrides((current) =>
      current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    );
  }

  async function handleConfirmImportPlan() {
    setIsImportPlanExecuting(true);
    setImportExecutionReport(null);
    setImportExecutionProgressUpdates([]);

    try {
      const outcome = await actionLayer.runReviewedImportWorkflow(
        createReviewedImportWorkflowRequest(
          importReviewPlan?.items ?? importPlanItems,
          importReviewSessionId,
          status === "paired"
        )
      );

      if (!outcome.ok) {
        appendClientLog("error", outcome.userMessage, "import");
        return;
      }

      setImportExecutionReport(outcome.report);
      setLogs((current: ClientLogEntry[]) => [
        ...outcome.logMessages.map((message, index) =>
          createClientLogEntry(
            index === outcome.logMessages.length - 1 && outcome.report.failedActions === 0 ? "success" : "info",
            message,
            "import"
          )
        ),
        ...current
      ].slice(0, 20));
    } finally {
      setIsImportPlanExecuting(false);
    }
  }

  function handleCancelImportPlan() {
    const itemCount = importPlanItems.length;
    setImportPlanItems([]);
    setImportReviewPlan(null);
    setImportReviewSuggestionOverrides([]);
    setImportReviewSessionId(null);
    setImportExecutionReport(null);
    setImportExecutionProgressUpdates([]);
    setImportPlanSourceLabel(null);
    appendClientLog(
      "info",
      itemCount > 0 ? `Import plan review cancelled for ${itemCount} items.` : "Import plan review cleared.",
      "import"
    );
  }

  function handleToggleStream() {
    if (isScreenVisible) {
      if (document.fullscreenElement === viewerContainerRef.current) {
        void document.exitFullscreen().catch(() => undefined);
      }
      fullscreenKeyboardIntentRef.current = false;
      setIsViewerSoftFullscreen(false);
      setIsKeyboardInputMode(false);
      setIsFullscreenKeyboardOverlayOpen(false);
      setIsScreenVisible(false);
      setRemoteStream(null);
      setAudioTrackCount(0);
      setStreamStatus("Disconnected");
      inputDiagnosticsRef.current.clear();
      setMoveLatencyDiagnostic(null);
      resetKeyboardDraftSyncState();
      webrtc.stop();
      tryUnlockOrientation();
      return;
    }

    setIsScreenVisible(true);
    setStreamStatus("Connecting to stream...");
    webrtc.start();
  }

  function handleFullscreen() {
    const viewerElement = viewerContainerRef.current as FullscreenCapableElement | null;
    const videoElement = videoRef.current as WebkitFullscreenVideoElement | null;

    if (!viewerElement && !videoElement) {
      return;
    }

    if (
      document.fullscreenElement === viewerContainerRef.current ||
      videoElement?.webkitDisplayingFullscreen ||
      isViewerSoftFullscreen
    ) {
      void document.exitFullscreen().catch(() => undefined);
      if (videoElement?.webkitDisplayingFullscreen) {
        videoElement.webkitExitFullscreen?.();
      }
      fullscreenKeyboardIntentRef.current = false;
      setIsViewerSoftFullscreen(false);
      setIsKeyboardInputMode(false);
      setIsFullscreenKeyboardOverlayOpen(false);
      tryUnlockOrientation();
      return;
    }

    if (viewerElement?.requestFullscreen) {
      void tryLockLandscapeOrientation();
      void viewerElement.requestFullscreen().catch(() => undefined);
      return;
    }

    if (viewerElement?.webkitRequestFullscreen) {
      void tryLockLandscapeOrientation();
      void Promise.resolve(viewerElement.webkitRequestFullscreen()).catch(() => undefined);
      return;
    }

    setIsViewerSoftFullscreen(true);
    setIsViewerFullscreen(true);
    setIsKeyboardInputMode(false);
    fullscreenKeyboardIntentRef.current = false;
    setIsFullscreenKeyboardOverlayOpen(false);
    void tryLockLandscapeOrientation();
  }

  function handleExitFullscreen() {
    const videoElement = videoRef.current as WebkitFullscreenVideoElement | null;

    if (document.fullscreenElement === viewerContainerRef.current) {
      void document.exitFullscreen().catch(() => undefined);
    }

    if (videoElement?.webkitDisplayingFullscreen) {
      videoElement.webkitExitFullscreen?.();
    }

    fullscreenKeyboardIntentRef.current = false;
    setIsViewerSoftFullscreen(false);
    setIsViewerFullscreen(false);
    setIsFullscreenKeyboardOverlayOpen(false);
    tryUnlockOrientation();
  }

  function handleOpenKeyboardInputMode() {
    if (isViewerFullscreen) {
      if (isFullscreenKeyboardOverlayOpen) {
        flushKeyboardDraftSync();
        fullscreenKeyboardIntentRef.current = false;
        setIsFullscreenKeyboardOverlayOpen(false);
        resetKeyboardDraftSyncState();
        return;
      }

      const videoElement = videoRef.current as WebkitFullscreenVideoElement | null;
      if (document.fullscreenElement === viewerContainerRef.current) {
        void document.exitFullscreen().catch(() => undefined);
      }
      if (videoElement?.webkitDisplayingFullscreen) {
        videoElement.webkitExitFullscreen?.();
      }

      fullscreenKeyboardIntentRef.current = true;
      resetKeyboardDraftSyncState();
      setIsViewerSoftFullscreen(true);
      setIsViewerFullscreen(true);
      setIsFullscreenKeyboardOverlayOpen(true);
      return;
    }

    resetKeyboardDraftSyncState();
    setIsKeyboardInputMode(true);
  }

  function handleCloseKeyboardInputMode() {
    flushKeyboardDraftSync();
    setIsKeyboardInputMode(false);
    fullscreenKeyboardIntentRef.current = false;
    setIsFullscreenKeyboardOverlayOpen(false);
    resetKeyboardDraftSyncState();
  }

  function handleToggleMute() {
    setIsAudioMuted((current) => !current);
  }

  function handleVolumeChange(value: number) {
    setAudioVolume(value);
    if (value > 0 && isAudioMuted) {
      setIsAudioMuted(false);
    }
  }

  const isStreamConnecting =
    isScreenVisible &&
    remoteStream === null &&
    (streamStatus === "Connecting to stream..." ||
      streamStatus.toLowerCase().includes("connecting") ||
      streamStatus.toLowerCase().includes("request"));
  const isStreaming = remoteStream !== null;
  const hasAudioStream = audioTrackCount > 0;
  const audioStatus =
    isStreaming && hasAudioStream
      ? "Audio connected"
      : isStreamConnecting
        ? "Connecting to audio..."
        : "No audio stream";
  const viewerMode: ViewerMode = isViewerFullscreen
    ? "fullscreen_view_mode"
    : isKeyboardInputMode
      ? "keyboard_input_mode"
      : "normal_mode";

  return (
    <div className={shellClassName}>
      <div className="mx-auto flex min-h-screen max-w-[1650px] flex-col px-5 py-5 lg:px-8 lg:py-8">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4 rounded-[32px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))] px-6 py-5 shadow-panel backdrop-blur-xl">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-ctrlx text-ctrlx-muted">CTRLX</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.04em] text-ctrlx-text lg:text-5xl">
              Remote Logic Assistant
            </h1>
          </div>
          <div className="rounded-full border border-ctrlx-accent/20 bg-ctrlx-accentSoft px-5 py-3 text-sm font-semibold text-ctrlx-edge shadow-glow">
            {headerStatus}
          </div>
        </header>

        <main className="grid flex-1 gap-5 xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,1fr)_360px]">
          <ConnectionPanel
            host={host}
            sessionCode={sessionCode}
            status={statusMessage}
            connectionState={status}
            onHostChange={setHost}
            onSessionCodeChange={setSessionCode}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
          />

          <div className="flex min-h-[620px] flex-col gap-5 lg:min-h-[700px] xl:min-h-[760px]">
            <ControlPanel
              onCommand={handleCommand}
              isConnected={isPaired}
              onToggleStream={handleToggleStream}
              onFullscreen={handleFullscreen}
              onExitFullscreen={handleExitFullscreen}
              isScreenVisible={isScreenVisible}
              isStreaming={remoteStream !== null}
              isStreamConnecting={isStreamConnecting}
              isViewerFullscreen={isViewerFullscreen}
              isViewerSoftFullscreen={isViewerSoftFullscreen}
              isFullscreenKeyboardOverlayOpen={isFullscreenKeyboardOverlayOpen}
              viewerMode={viewerMode}
              streamStatus={streamStatus}
              audioStatus={audioStatus}
              hasAudioStream={hasAudioStream}
              isAudioMuted={isAudioMuted}
              audioVolume={audioVolume}
              onToggleMute={handleToggleMute}
              onVolumeChange={handleVolumeChange}
              onViewerInput={handleViewerInput}
              onOpenKeyboardInputMode={handleOpenKeyboardInputMode}
              onCloseKeyboardInputMode={handleCloseKeyboardInputMode}
              onKeyboardDraftChange={handleKeyboardDraftChange}
              onKeyboardSubmit={handleKeyboardSubmit}
              onKeyboardEnter={handleKeyboardEnter}
              inputAckStatus={inputAckStatus}
              moveLatencyDiagnostic={moveLatencyDiagnostic}
              moveDiagnosticsRuntime={moveDiagnosticsRuntime}
              inputHandler={inputHandler}
              viewerContainerRef={viewerContainerRef}
              videoRef={videoRef}
            />
          </div>

          <div className="xl:col-span-2 2xl:col-span-1">
            <AssistantPanel
              prompt={assistantPrompt}
              onPromptChange={setAssistantPrompt}
              onSend={handleAssistantSend}
              importPlanItems={importPlanItems}
              onRequestImportSelection={requestHostImportSelection}
              onUpdateImportPlanItem={handleUpdateImportPlanItem}
              importReviewSuggestionOverrides={importReviewSuggestionOverrides}
              onUpdateImportPlanSuggestion={handleUpdateImportPlanSuggestion}
              onConfirmImportPlan={handleConfirmImportPlan}
              onCancelImportPlan={handleCancelImportPlan}
              importExecutionReport={importExecutionReport}
              importExecutionProgressUpdates={importExecutionProgressUpdates}
              isImportPlanExecuting={isImportPlanExecuting}
              isImportPlanLoading={isImportPlanLoading}
              importPlanSourceLabel={importPlanSourceLabel}
            />
          </div>
        </main>
        <audio ref={audioRef} autoPlay playsInline className="hidden" />
      </div>
    </div>
  );
}
