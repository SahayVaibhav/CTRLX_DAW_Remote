import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { CommandRouter } from "./commandRouter.js";
import { Executor } from "./automation/executor.js";
import {
  InputExecutor,
  mapNormalizedToHostCoordinates,
  type HostScreenCoordinates,
  type PointerMoveTelemetryEvent
} from "./inputExecutor.js";
import { KeyboardExecutor } from "./keyboardExecutor.js";
import { HostLoggingService } from "./logging.js";
import { ImportUploadManager } from "./importUploadManager.js";
import { SessionManager } from "./sessionManager.js";
import { WebRtcHost } from "./stream/webrtcHost.js";
import { CtrlxWsServer, type HostConnectionState } from "./wsServer.js";
import {
  CTRLX_PROTOCOL_VERSION,
  CtrlxMessageType,
  createTimestamp,
  type ImportExecutionProgressUpdate,
  type AckMessage,
  type CommandMessage,
  type CtrlxLogEntry,
  type CtrlxLogLevel,
  type CtrlxLogSource,
  type CtrlxMessage,
  type ErrorMessage,
  type InputMessage,
  type KeyboardInputMessage,
  type StreamAnswerMessage,
  type StreamIceMessage,
  type StreamRequestMessage,
  type StatusMessage
} from "#protocol";

type ElectronApp = {
  whenReady: () => Promise<void>;
  on: (event: "window-all-closed", listener: () => void) => void;
  quit: () => void;
  getPath: (name: "userData") => string;
};

type BrowserWindowConstructor = {
  new (options: {
    show?: boolean;
    width: number;
    height: number;
    title?: string;
    backgroundColor?: string;
    webPreferences: {
      contextIsolation?: boolean;
      nodeIntegration?: boolean;
      backgroundThrottling?: boolean;
    };
  }): {
    isDestroyed: () => boolean;
    loadURL: (url: string) => Promise<void>;
    close: () => void;
    webContents: {
      send: (channel: string, payload?: unknown) => void;
      executeJavaScript: (code: string) => Promise<unknown>;
    };
  };
};

type DesktopCapturerLike = {
  getSources: (options: {
    types: Array<"screen" | "window">;
    thumbnailSize: {
      width: number;
      height: number;
    };
    fetchWindowIcons?: boolean;
  }) => Promise<Array<{
    id: string;
    display_id?: string;
    name: string;
    thumbnail: {
      toPNG: () => Buffer;
      getSize: () => {
        width: number;
        height: number;
      };
      isEmpty?: () => boolean;
    };
  }>>;
};

type ScreenLike = {
  getPrimaryDisplay: () => {
    id: number;
    bounds: {
      width: number;
      height: number;
      x?: number;
      y?: number;
    };
  };
};

type IpcMainLike = {
  on: (channel: string, listener: (_event: unknown, payload?: unknown) => void) => void;
  removeAllListeners: (channel: string) => void;
};

type SessionLike = {
  defaultSession?: {
    setDisplayMediaRequestHandler?: (
      handler: (
        request: unknown,
        callback: (response: {
          video: {
            id: string;
            display_id?: string;
            name: string;
          } | null;
          audio?: "none";
        }) => void
      ) => void,
      options?: {
        useSystemPicker?: boolean;
      }
    ) => void;
  };
};

type DialogLike = {
  showOpenDialog: (
    browserWindow: {
      isDestroyed: () => boolean;
    } | null,
    options: {
      title?: string;
      buttonLabel?: string;
      properties: Array<"openFile" | "openDirectory" | "multiSelections">;
      filters?: Array<{
        name: string;
        extensions: string[];
      }>;
    }
  ) => Promise<{
    canceled: boolean;
    filePaths: string[];
  }>;
};

type HostLogEntry = CtrlxLogEntry;

type HostInputDebugMarker = {
  id: string;
  action: InputMessage["payload"]["action"];
  xNorm: number;
  yNorm: number;
  hostX: number;
  hostY: number;
  displayWidth: number;
  displayHeight: number;
  viewerWidth: number;
  viewerHeight: number;
  timestamp: number;
};

type HostImportPreviewItem = {
  originalFilename: string;
  cleanTrackName: string;
  detectedCategory: string;
  assignedColor: string;
};

type HostImportSessionSummary = {
  sessionId: string;
  sourceName: string;
  acceptedCount: number;
  skippedCount: number;
  items: HostImportPreviewItem[];
  createdAt: string;
};

type HostUiState = {
  sessionCode: string;
  hostAddress: string;
  port: number;
  connectionState: HostConnectionState;
  activeClientName: string | null;
  logs: HostLogEntry[];
  inputDebugMarker: HostInputDebugMarker | null;
  importSession: HostImportSessionSummary | null;
};

const DEFAULT_WS_PORT = 4545;
const HOST_INPUT_DEBUG =
  process.env.NODE_ENV !== "production" && process.env.CTRLX_DEBUG_INPUT !== "0";
const HOST_INPUT_LATENCY_DEBUG =
  process.env.NODE_ENV !== "production" && process.env.CTRLX_DEBUG_LATENCY === "1";
const HOST_KEYBOARD_DEBUG =
  process.env.NODE_ENV !== "production" && process.env.CTRLX_DEBUG_KEYBOARD === "1";
const HOST_GESTURE_DEBUG =
  process.env.NODE_ENV !== "production" && process.env.CTRLX_DEBUG_GESTURES === "1";
const HOST_INPUT_DEBUG_DURATION_MS = 1400;
const sessionManager = new SessionManager();
const importUploadManager = new ImportUploadManager((message) => pushLog("info", message, "import"));
const executor = new Executor(
  (message) => pushLog("info", message, "host"),
  {
    getImportUploadSession: (sessionId) => importUploadManager.getSession(sessionId),
    emitStatus: (message, data) => {
      wsServer.sendToActiveClient(
        createStatusMessage(uiState.connectionState, message, data)
      );
    }
  }
);
const commandRouter = new CommandRouter(executor);
let inputExecutor: InputExecutor | null = null;
let keyboardExecutor: KeyboardExecutor | null = null;

let mainWindow: InstanceType<BrowserWindowConstructor> | null = null;
let webRtcHost: WebRtcHost | null = null;
let windowSyncInFlight = false;
let windowSyncPending = false;
let inputDebugClearTimer: ReturnType<typeof setTimeout> | null = null;

const uiState: HostUiState = {
  sessionCode: sessionManager.getCode(),
  hostAddress: detectHostAddress(),
  port: DEFAULT_WS_PORT,
  connectionState: "waiting",
  activeClientName: null,
  logs: [],
  inputDebugMarker: null,
  importSession: null
};
let hostLogger: HostLoggingService | null = null;

function detectHostAddress(): string {
  const entries = Object.values(networkInterfaces()).flat().filter(Boolean);
  const ipv4 = entries.find((entry) => entry?.family === "IPv4" && !entry.internal);
  return ipv4?.address ?? "localhost";
}

function appendHostUiLog(entry: HostLogEntry): void {
  uiState.logs = [
    entry,
    ...uiState.logs
  ].slice(0, 24);

  syncWindow();
}

function pushLog(
  level: CtrlxLogLevel,
  message: string,
  source: CtrlxLogSource = "host",
  options?: {
    context?: Record<string, unknown>;
    forwardToClient?: boolean;
  }
): void {
  if (hostLogger) {
    hostLogger.log({
      level,
      message,
      source,
      context: options?.context,
      forwardToClient: options?.forwardToClient
    });
    return;
  }

  appendHostUiLog({
    id: randomUUID(),
    level,
    message,
    at: createTimestamp(),
    source,
    context: options?.context
  });
}

function setImportSessionSummaryFromResult(result: {
  sessionId: string;
  sourceName: string;
  acceptedCount: number;
  skippedCount: number;
  items: Array<{
    originalFilename: string;
    cleanTrackName: string;
    detectedCategory: string;
    assignedColor: string;
  }>;
}): void {
  setImportSessionSummary({
    sessionId: result.sessionId,
    sourceName: result.sourceName,
    acceptedCount: result.acceptedCount,
    skippedCount: result.skippedCount,
    items: result.items.map((item) => ({
      originalFilename: item.originalFilename,
      cleanTrackName: item.cleanTrackName,
      detectedCategory: item.detectedCategory,
      assignedColor: item.assignedColor
    })),
    createdAt: new Date().toISOString()
  });
}

function setConnectionState(nextState: HostConnectionState, activeClientName: string | null = uiState.activeClientName): void {
  uiState.connectionState = nextState;
  uiState.activeClientName = activeClientName;
  syncWindow();
}

function showInputDebugMarker(message: InputMessage, coordinates: HostScreenCoordinates): void {
  if (!HOST_INPUT_DEBUG) {
    return;
  }

  if (message.payload.action === "pointer_move" && !inputExecutor?.isDebugCursorMoveEnabled()) {
    return;
  }

  const marker: HostInputDebugMarker = {
    id: randomUUID(),
    action: message.payload.action,
    xNorm: message.payload.xNorm,
    yNorm: message.payload.yNorm,
    hostX: coordinates.x,
    hostY: coordinates.y,
    displayWidth: coordinates.displayWidth,
    displayHeight: coordinates.displayHeight,
    viewerWidth: message.payload.viewerWidth,
    viewerHeight: message.payload.viewerHeight,
    timestamp: message.payload.timestamp
  };

  uiState.inputDebugMarker = marker;
  syncWindow();

  if (inputDebugClearTimer) {
    clearTimeout(inputDebugClearTimer);
  }

  inputDebugClearTimer = setTimeout(() => {
    if (uiState.inputDebugMarker?.id === marker.id) {
      uiState.inputDebugMarker = null;
      syncWindow();
    }
  }, HOST_INPUT_DEBUG_DURATION_MS);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderHostHtml(): string {
  const statusCopy =
    uiState.connectionState === "paired"
      ? `Paired with ${uiState.activeClientName ?? "client"}`
      : uiState.connectionState === "busy"
        ? "Busy"
        : uiState.connectionState === "error"
          ? "Error"
          : "Waiting for client";

  const logs = uiState.logs.length
    ? uiState.logs
        .map((entry) => {
          return `<div class="log-entry"><strong>${escapeHtml(`${entry.source} · ${entry.level}`.toUpperCase())}</strong><span>${escapeHtml(entry.message)}</span><span>${escapeHtml(new Date(entry.at).toLocaleTimeString())}</span></div>`;
        })
        .join("")
    : `<div class="log-entry empty"><span>No host activity yet.</span></div>`;

  const importSession = uiState.importSession;
  const importSessionPanel = importSession
    ? `
        <section class="logs">
          <span class="label">Import Session</span>
          <div class="meta" style="margin-top:12px">
            ${escapeHtml(importSession.sourceName)} · ${importSession.acceptedCount} audio file${
              importSession.acceptedCount === 1 ? "" : "s"
            }${importSession.skippedCount > 0 ? ` · ${importSession.skippedCount} skipped` : ""}
          </div>
          <div class="log-list">
            ${importSession.items.length > 0
              ? importSession.items
                  .slice(0, 24)
                  .map(
                    (item) => `
                      <div class="log-entry">
                        <strong>${escapeHtml(item.cleanTrackName)}</strong>
                        <span>${escapeHtml(item.originalFilename)}</span>
                        <span>${escapeHtml(`${item.detectedCategory} · ${item.assignedColor}`)}</span>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="log-entry empty"><span>No supported audio files found in this upload.</span></div>`}
          </div>
        </section>
      `
    : "";

  const debugMarker = uiState.inputDebugMarker;
  const debugPanel = HOST_INPUT_DEBUG
    ? (() => {
        const leftPercent = debugMarker ? Math.max(0, Math.min(100, debugMarker.xNorm * 100)) : 0;
        const topPercent = debugMarker ? Math.max(0, Math.min(100, debugMarker.yNorm * 100)) : 0;
        const overlay = debugMarker
          ? `<div class="debug-hit" style="left:${leftPercent}%; top:${topPercent}%;">
              <div class="debug-ring"></div>
              <div class="debug-crosshair"></div>
              <div class="debug-label">${escapeHtml(
                `${debugMarker.action} · ${Math.round(debugMarker.hostX)},${Math.round(debugMarker.hostY)}`
              )}</div>
            </div>`
          : "";

        const meta = debugMarker
          ? `
            <div class="debug-meta-grid">
              <div class="debug-meta-item"><span>Action</span><strong>${escapeHtml(debugMarker.action)}</strong></div>
              <div class="debug-meta-item"><span>Host</span><strong>${escapeHtml(
                `${Math.round(debugMarker.hostX)}, ${Math.round(debugMarker.hostY)}`
              )}</strong></div>
              <div class="debug-meta-item"><span>Normalized</span><strong>${escapeHtml(
                `${debugMarker.xNorm.toFixed(4)}, ${debugMarker.yNorm.toFixed(4)}`
              )}</strong></div>
              <div class="debug-meta-item"><span>Viewer Rect</span><strong>${escapeHtml(
                `${Math.round(debugMarker.viewerWidth)} × ${Math.round(debugMarker.viewerHeight)}`
              )}</strong></div>
              <div class="debug-meta-item"><span>Host Display</span><strong>${escapeHtml(
                `${Math.round(debugMarker.displayWidth)} × ${Math.round(debugMarker.displayHeight)}`
              )}</strong></div>
              <div class="debug-meta-item"><span>Timestamp</span><strong>${escapeHtml(
                new Date(debugMarker.timestamp).toLocaleTimeString()
              )}</strong></div>
            </div>
          `
          : `<div class="debug-empty">Tap the live viewer from your phone or tablet to see the mapped point here.</div>`;

        return `
          <section class="debug-panel">
            <div class="debug-header">
              <span class="label">Input Debug</span>
              <span class="debug-badge">DEV ONLY</span>
            </div>
            <div class="debug-stage">
              <div class="debug-stage-frame">
                ${overlay}
              </div>
            </div>
            ${meta}
          </section>
        `;
      })()
    : "";

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>CTRLX Host</title>
      <style>
        :root {
          color-scheme: dark;
          --bg: #081017;
          --panel: rgba(18, 23, 30, 0.92);
          --line: rgba(255,255,255,0.08);
          --text: #f5fbff;
          --muted: #8fa1ac;
          --accent: #99f7ff;
        }
        * { box-sizing: border-box; }
        body {
          margin: 0;
          font-family: Inter, system-ui, sans-serif;
          background:
            radial-gradient(circle at top right, rgba(153,247,255,0.08), transparent 28%),
            linear-gradient(180deg, #06090d 0%, var(--bg) 58%, #05070a 100%);
          color: var(--text);
        }
        .shell {
          max-width: 980px;
          margin: 0 auto;
          padding: 36px 24px;
        }
        .eyebrow {
          margin: 0 0 12px;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
        }
        h1 {
          margin: 0 0 10px;
          font-size: 56px;
          line-height: 1;
          letter-spacing: -0.05em;
        }
        .subcopy {
          margin: 0;
          color: var(--muted);
          max-width: 720px;
          font-size: 22px;
          line-height: 1.45;
        }
        .grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 18px;
          margin-top: 32px;
        }
        .card {
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 28px;
          padding: 24px;
          min-height: 196px;
          box-shadow: 0 24px 64px rgba(0,0,0,0.32);
        }
        .label {
          display: block;
          text-transform: uppercase;
          letter-spacing: 0.18em;
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
        }
        .value {
          display: block;
          margin-top: 18px;
          color: var(--accent);
          font-size: 48px;
          font-weight: 800;
          letter-spacing: -0.05em;
        }
        .meta {
          margin-top: 18px;
          color: var(--muted);
          font-size: 18px;
        }
        .logs {
          margin-top: 18px;
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 28px;
          padding: 24px;
        }
        .debug-panel {
          margin-top: 18px;
          background: var(--panel);
          border: 1px solid var(--line);
          border-radius: 28px;
          padding: 24px;
        }
        .debug-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .debug-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-height: 32px;
          padding: 0 12px;
          border-radius: 999px;
          border: 1px solid rgba(153,247,255,0.16);
          background: rgba(153,247,255,0.08);
          color: var(--accent);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.16em;
        }
        .debug-stage {
          margin-top: 18px;
          padding: 18px;
          border-radius: 22px;
          background: rgba(255,255,255,0.02);
          border: 1px solid rgba(255,255,255,0.04);
        }
        .debug-stage-frame {
          position: relative;
          width: 100%;
          aspect-ratio: 16 / 10;
          overflow: hidden;
          border-radius: 18px;
          border: 1px solid rgba(153,247,255,0.12);
          background:
            linear-gradient(rgba(153,247,255,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(153,247,255,0.06) 1px, transparent 1px),
            radial-gradient(circle at center, rgba(153,247,255,0.08), transparent 58%),
            rgba(8,16,23,0.92);
          background-size: 48px 48px, 48px 48px, auto, auto;
        }
        .debug-stage-frame::before,
        .debug-stage-frame::after {
          content: "";
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .debug-stage-frame::before {
          left: 50%;
          top: 0;
          width: 1px;
          height: 100%;
          background: rgba(255,255,255,0.05);
          transform: translateX(-0.5px);
        }
        .debug-stage-frame::after {
          left: 0;
          top: 50%;
          width: 100%;
          height: 1px;
          background: rgba(255,255,255,0.05);
          transform: translateY(-0.5px);
        }
        .debug-hit {
          position: absolute;
          width: 0;
          height: 0;
          transform: translate(-50%, -50%);
          pointer-events: none;
        }
        .debug-ring {
          position: absolute;
          left: 0;
          top: 0;
          width: 24px;
          height: 24px;
          border-radius: 999px;
          border: 2px solid rgba(153,247,255,0.92);
          box-shadow: 0 0 0 6px rgba(153,247,255,0.08);
          transform: translate(-50%, -50%);
          animation: debug-fade ${HOST_INPUT_DEBUG_DURATION_MS}ms ease-out forwards;
        }
        .debug-crosshair::before,
        .debug-crosshair::after {
          content: "";
          position: absolute;
          background: rgba(153,247,255,0.88);
          transform: translate(-50%, -50%);
          animation: debug-fade ${HOST_INPUT_DEBUG_DURATION_MS}ms ease-out forwards;
        }
        .debug-crosshair::before {
          left: 0;
          top: 0;
          width: 40px;
          height: 1px;
        }
        .debug-crosshair::after {
          left: 0;
          top: 0;
          width: 1px;
          height: 40px;
        }
        .debug-label {
          position: absolute;
          left: 18px;
          top: -18px;
          padding: 8px 10px;
          border-radius: 12px;
          background: rgba(6,9,13,0.88);
          border: 1px solid rgba(153,247,255,0.14);
          color: var(--text);
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
          box-shadow: 0 10px 24px rgba(0,0,0,0.28);
          animation: debug-fade ${HOST_INPUT_DEBUG_DURATION_MS}ms ease-out forwards;
        }
        .debug-meta-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          margin-top: 18px;
        }
        .debug-meta-item {
          display: grid;
          gap: 6px;
          padding: 14px 16px;
          border-radius: 18px;
          background: rgba(255,255,255,0.03);
        }
        .debug-meta-item span {
          color: var(--muted);
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.14em;
          text-transform: uppercase;
        }
        .debug-meta-item strong {
          color: #d7e4ec;
          font-size: 14px;
        }
        .debug-empty {
          margin-top: 18px;
          padding: 16px;
          border-radius: 18px;
          background: rgba(255,255,255,0.03);
          color: var(--muted);
        }
        @keyframes debug-fade {
          0% { opacity: 1; }
          75% { opacity: 1; }
          100% { opacity: 0; }
        }
        .log-list {
          display: grid;
          gap: 12px;
          margin-top: 18px;
        }
        .log-entry {
          display: grid;
          gap: 6px;
          padding: 14px 16px;
          border-radius: 18px;
          background: rgba(255,255,255,0.03);
        }
        .log-entry strong {
          color: var(--accent);
          font-size: 12px;
          letter-spacing: 0.12em;
        }
        .log-entry span {
          color: #d7e4ec;
        }
      </style>
    </head>
    <body>
      <main class="shell">
        <p class="eyebrow">CTRLX Remote Host</p>
        <h1>Phase 1 Host</h1>
        <p class="subcopy">Local-first Electron host for Logic Pro pairing, whitelisted command routing, and safe automation execution.</p>

        <section class="grid">
          <article class="card">
            <span class="label">Session Code</span>
            <strong class="value">${escapeHtml(uiState.sessionCode)}</strong>
            <div class="meta">Host: ${escapeHtml(uiState.hostAddress)}:${uiState.port}</div>
          </article>
          <article class="card">
            <span class="label">Connection</span>
            <strong class="value" style="font-size:42px">${escapeHtml(uiState.connectionState)}</strong>
            <div class="meta">${escapeHtml(statusCopy)}</div>
          </article>
          <article class="card">
            <span class="label">Protocol</span>
            <strong class="value" style="font-size:42px">${escapeHtml(CTRLX_PROTOCOL_VERSION)}</strong>
            <div class="meta">One active client only</div>
          </article>
        </section>

        ${debugPanel}

        ${importSessionPanel}

        <section class="logs">
          <span class="label">Host Activity</span>
          <div class="log-list">${logs}</div>
        </section>
      </main>
    </body>
  </html>`;
}

function setImportSessionSummary(summary: HostImportSessionSummary | null): void {
  uiState.importSession = summary;
  syncWindow();
}

function emitImportProgress(update: ImportExecutionProgressUpdate): void {
  wsServer.sendToActiveClient(createStatusMessage(uiState.connectionState, update.message, update as unknown as Record<string, unknown>));
}

async function syncWindow(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (windowSyncInFlight) {
    windowSyncPending = true;
    return;
  }

  windowSyncInFlight = true;

  try {
    await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderHostHtml())}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("ERR_ABORTED")) {
      throw error;
    }
  } finally {
    windowSyncInFlight = false;

    if (windowSyncPending) {
      windowSyncPending = false;
      await syncWindow();
    }
  }
}

const wsServer = new CtrlxWsServer(
  {
    sessionManager,
    port: () => uiState.port,
    hostName: () => "CTRLX Host"
  },
  {
    onStateChange: (state, clientName) => {
      setConnectionState(state, clientName ?? null);
      pushLog("info", `Connection state changed to ${state}${clientName ? ` for ${clientName}` : ""}`, "ws");
    },
    onLog: (message) => {
      pushLog("info", message, "ws");
    },
    onError: (message) => {
      pushLog("error", message, "ws");
      setConnectionState("error");
    }
  }
);

async function createWindow(BrowserWindow: BrowserWindowConstructor): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 820,
    title: "CTRLX Host",
    backgroundColor: "#081017",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await syncWindow();
}

function createStatusMessage(
  state: HostConnectionState,
  message: string,
  data?: StatusMessage["payload"]["data"]
): StatusMessage {
  return {
    type: CtrlxMessageType.Status,
    sentAt: createTimestamp(),
    sessionCode: uiState.sessionCode,
    payload: {
      connectionState: state,
      hostName: "CTRLX Host",
      message,
      data
    }
  };
}

function forwardHostLogEntry(entry: CtrlxLogEntry): void {
  wsServer.sendToActiveClient(
    createStatusMessage(uiState.connectionState, entry.message, {
      kind: "log_entry",
      entry
    })
  );
}

function createProtocolError(message: string, requestId?: string): ErrorMessage {
  return {
    type: CtrlxMessageType.Error,
    requestId,
    sessionCode: uiState.sessionCode,
    sentAt: createTimestamp(),
    payload: {
      ok: false,
      code: "INVALID_MESSAGE",
      message
    }
  };
}

function createAckMessage(
  state: AckMessage["payload"]["state"],
  options: {
    requestId?: string;
    ok?: boolean;
    message?: string;
    reason?: string;
    data?: Record<string, unknown>;
  } = {}
): AckMessage {
  return {
    type: CtrlxMessageType.Ack,
    requestId: options.requestId,
    sessionCode: uiState.sessionCode,
    sentAt: createTimestamp(),
    payload: {
      ok: options.ok ?? true,
      state,
      ackFor: options.requestId,
      message: options.message,
      reason: options.reason,
      data: options.data
    }
  };
}

function isCommandMessage(message: CtrlxMessage): message is CommandMessage {
  return message.type === CtrlxMessageType.Command;
}

function isStreamRequestMessage(message: CtrlxMessage): message is StreamRequestMessage {
  return message.type === CtrlxMessageType.StreamRequest;
}

function isStreamAnswerMessage(message: CtrlxMessage): message is StreamAnswerMessage {
  return message.type === CtrlxMessageType.StreamAnswer;
}

function isStreamIceMessage(message: CtrlxMessage): message is StreamIceMessage {
  return message.type === CtrlxMessageType.StreamIce;
}

function isInputMessage(message: CtrlxMessage): message is InputMessage {
  return message.type === CtrlxMessageType.ScreenInput;
}

function isKeyboardInputMessage(message: CtrlxMessage): message is KeyboardInputMessage {
  return message.type === CtrlxMessageType.KeyboardInput;
}

type IncomingMessageContext = {
  activeWebRtcHost: WebRtcHost;
  screen: ScreenLike;
};

function validateScreenInputBounds(message: InputMessage): { ok: true } | { ok: false; reason: string } {
  const { action, xNorm, yNorm, viewerWidth, viewerHeight, timestamp } = message.payload;

  if (!Number.isFinite(xNorm) || !Number.isFinite(yNorm)) {
    return { ok: false, reason: "screen_input xNorm/yNorm must be finite numbers." };
  }

  if (xNorm < 0 || xNorm > 1 || yNorm < 0 || yNorm > 1) {
    return { ok: false, reason: "screen_input xNorm/yNorm must be within 0..1." };
  }

  if (!Number.isFinite(viewerWidth) || viewerWidth <= 0 || !Number.isFinite(viewerHeight) || viewerHeight <= 0) {
    return { ok: false, reason: "screen_input viewerWidth/viewerHeight must be positive numbers." };
  }

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { ok: false, reason: "screen_input timestamp must be a positive number." };
  }

  if (action === "gesture_pan") {
    if (!Number.isFinite(message.payload.deltaX) || !Number.isFinite(message.payload.deltaY)) {
      return { ok: false, reason: "screen_input gesture_pan requires finite deltaX/deltaY values." };
    }
  }

  if (action === "gesture_zoom") {
    if (
      !Number.isFinite(message.payload.zoomDelta) ||
      (message.payload.zoomAxis !== "horizontal" && message.payload.zoomAxis !== "vertical")
    ) {
      return { ok: false, reason: "screen_input gesture_zoom requires a finite zoomDelta value and valid zoomAxis." };
    }
  }

  if (action === "gesture_region_move") {
    if (
      message.payload.gesturePhase !== "start" &&
      message.payload.gesturePhase !== "move" &&
      message.payload.gesturePhase !== "end"
    ) {
      return { ok: false, reason: "screen_input gesture_region_move requires a valid gesturePhase." };
    }
  }

  return { ok: true };
}

async function handleScreenInputMessage(
  message: InputMessage,
  context: Pick<IncomingMessageContext, "screen">
): Promise<CtrlxMessage[]> {
  const hostReceivedAt = Date.now();
  const isHighFrequencyGesture =
    message.payload.action === "gesture_pan" ||
    message.payload.action === "gesture_zoom" ||
    (message.payload.action === "gesture_region_move" && message.payload.gesturePhase === "move");
  const shouldAckPointerMove =
    (!isHighFrequencyGesture &&
      (message.payload.action !== "pointer_move" || inputExecutor?.isDebugCursorMoveEnabled() || HOST_INPUT_LATENCY_DEBUG));
  const acknowledgements: CtrlxMessage[] = [
    ...(shouldAckPointerMove
      ? [
          createAckMessage("received", {
            requestId: message.requestId,
            message: `Received ${message.payload.action} input.`
          })
        ]
      : [])
  ];

  const validation = validateScreenInputBounds(message);
  if (!validation.ok) {
    pushLog("warn", `Rejected screen input: ${validation.reason}`, "input");
    acknowledgements.push(
      createAckMessage("failed", {
        requestId: message.requestId,
        ok: false,
        reason: validation.reason,
        message: "Rejected malformed screen input."
      })
    );
    return acknowledgements;
  }

  const shouldSkipCoordinateMapping =
    message.payload.action === "gesture_pan" || message.payload.action === "gesture_zoom";
  const coordinates = shouldSkipCoordinateMapping ? null : mapNormalizedToHostCoordinates(message, context.screen);
  if (!shouldSkipCoordinateMapping && !coordinates) {
    const reason = "screen_input normalized coordinates could not be mapped to the host display.";
    pushLog("warn", `Rejected screen input: ${reason}`, "input");
    acknowledgements.push(
      createAckMessage("failed", {
        requestId: message.requestId,
        ok: false,
        reason,
        message: "Rejected unmappable screen input."
      })
    );
    return acknowledgements;
  }

  if (shouldAckPointerMove) {
    acknowledgements.push(
      createAckMessage("mapped", {
        requestId: message.requestId,
        message: `Mapped ${message.payload.action} to host coordinates.`,
        data: {
                x: Math.round(coordinates!.x),
                y: Math.round(coordinates!.y),
                displayWidth: Math.round(coordinates!.displayWidth),
                displayHeight: Math.round(coordinates!.displayHeight),
          ...(HOST_INPUT_LATENCY_DEBUG
            ? {
                hostReceivedAt
              }
            : {})
        }
      })
    );
  }

  if (
    !isHighFrequencyGesture &&
    (message.payload.action !== "pointer_move" || inputExecutor?.isDebugCursorMoveEnabled())
  ) {
    pushLog(
      "info",
      `Mapped ${message.payload.action} request=${message.requestId ?? "none"} pointer=${message.payload.pointerType ?? "unknown"} ${message.payload.xNorm.toFixed(4)},${message.payload.yNorm.toFixed(4)} -> ${Math.round(coordinates!.x)},${Math.round(coordinates!.y)}`,
      "input"
    );
  }
  if (coordinates && !isHighFrequencyGesture) {
    showInputDebugMarker(message, coordinates);
  }
  if (
    HOST_GESTURE_DEBUG &&
    (isHighFrequencyGesture ||
      message.payload.action === "double_tap" ||
      message.payload.action === "gesture_region_move" ||
      (message.payload.pointerType === "touch" &&
        (message.payload.action === "pointer_down" || message.payload.action === "pointer_up")))
  ) {
    pushLog(
      "info",
      `[gesture] action=${message.payload.action} phase=${message.payload.gesturePhase ?? "n/a"} xNorm=${message.payload.xNorm.toFixed(4)} yNorm=${message.payload.yNorm.toFixed(4)} deltaX=${message.payload.deltaX ?? "n/a"} deltaY=${message.payload.deltaY ?? "n/a"} zoomDelta=${message.payload.zoomDelta ?? "n/a"}`,
      "input"
    );
  }

  if (message.payload.action !== "tap" && message.payload.action !== "double_tap") {
    if (
      message.payload.action === "pointer_move" ||
      message.payload.action === "pointer_down" ||
      message.payload.action === "pointer_up" ||
      message.payload.action === "gesture_pan" ||
      message.payload.action === "gesture_zoom" ||
      message.payload.action === "gesture_region_move"
    ) {
      try {
        if (!inputExecutor) {
          throw new Error("Input executor is not initialized.");
        }

        await inputExecutor.execute(message, coordinates ?? undefined);
        const hostExecutedAt = Date.now();
        if (HOST_GESTURE_DEBUG && (isHighFrequencyGesture || message.payload.action === "gesture_region_move")) {
          pushLog(
            "info",
            `[gesture] executed action=${message.payload.action} phase=${message.payload.gesturePhase ?? "n/a"}`,
            "input"
          );
        }
        if (shouldAckPointerMove) {
          acknowledgements.push(
            createAckMessage("executed", {
              requestId: message.requestId,
              message:
                message.payload.action === "pointer_move"
                  ? "Moved host cursor."
                  : `Processed ${message.payload.action} cursor event.`,
              data: {
                x: Math.round(coordinates!.x),
                y: Math.round(coordinates!.y),
                action: message.payload.action,
                ...(HOST_INPUT_LATENCY_DEBUG
                  ? {
                      hostReceivedAt,
                      hostExecutedAt
                    }
                  : {})
              }
            })
          );
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : `Host ${message.payload.action} failed.`;
        pushLog("error", `Failed to process host cursor input ${message.payload.action}: ${reason}`, "input");
        acknowledgements.push(
          createAckMessage("failed", {
            requestId: message.requestId,
            ok: false,
            reason,
            message: `Host ${message.payload.action} failed.`
          })
        );
      }

      return acknowledgements;
    }

    const reason = `${message.payload.action} is not enabled in the screen-input host path. Live screen-input actions currently include tap, double_tap, pointer_down, pointer_move, pointer_up, and gesture_region_move. Zoom now runs through reusable host commands instead of screen_input gesture_zoom.`;
    pushLog("warn", reason, "input");
    acknowledgements.push(
      createAckMessage("failed", {
        requestId: message.requestId,
        ok: false,
        reason,
        message: "Screen input action is not enabled yet."
      })
    );
    return acknowledgements;
  }

  try {
    if (!inputExecutor) {
      throw new Error("Input executor is not initialized.");
    }

    await inputExecutor.execute(message, coordinates ?? undefined);
    const hostExecutedAt = Date.now();
    if (HOST_GESTURE_DEBUG && message.payload.action === "double_tap") {
      pushLog("info", "[gesture] executed action=double_tap", "input");
    }
    acknowledgements.push(
      createAckMessage("executed", {
        requestId: message.requestId,
        message: `Executed host ${message.payload.action}.`,
        data: {
          x: Math.round(coordinates!.x),
          y: Math.round(coordinates!.y),
          action: message.payload.action,
          ...(HOST_INPUT_LATENCY_DEBUG
            ? {
                hostReceivedAt,
                hostExecutedAt
              }
            : {})
        }
      })
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Host tap execution failed.";
    pushLog("error", `Failed to execute host tap: ${reason}`, "input");
    acknowledgements.push(
      createAckMessage("failed", {
        requestId: message.requestId,
        ok: false,
        reason,
        message: "Host tap execution failed."
      })
    );
  }

  return acknowledgements;
}

function handleRealtimePointerMoveMessage(
  message: InputMessage,
  context: Pick<IncomingMessageContext, "screen">
): void {
  const hostReceivedAt = Date.now();
  const shouldDebugRealtimeMove = inputExecutor?.isDebugCursorMoveEnabled() || HOST_INPUT_LATENCY_DEBUG;
  const validation = validateScreenInputBounds(message);
  if (!validation.ok) {
    if (shouldDebugRealtimeMove) {
      pushLog("warn", `Rejected realtime pointer move: ${validation.reason}`, "input");
      wsServer.sendToActiveClient(
        createAckMessage("failed", {
          requestId: message.requestId,
          ok: false,
          reason: validation.reason,
          message: "Rejected malformed realtime pointer_move."
        })
      );
    }
    return;
  }

  const coordinates = mapNormalizedToHostCoordinates(message, context.screen);
  if (!coordinates) {
    const reason = "Realtime pointer_move could not be mapped to the host display.";
    if (shouldDebugRealtimeMove) {
      pushLog("warn", reason, "input");
      wsServer.sendToActiveClient(
        createAckMessage("failed", {
          requestId: message.requestId,
          ok: false,
          reason,
          message: "Rejected unmappable realtime pointer_move."
        })
      );
    }
    return;
  }

  if (!inputExecutor) {
    if (shouldDebugRealtimeMove) {
      pushLog("error", "Pointer move executor is not initialized.", "input");
      wsServer.sendToActiveClient(
        createAckMessage("failed", {
          requestId: message.requestId,
          ok: false,
          reason: "Input executor is not initialized.",
          message: "Host pointer_move failed."
        })
      );
    }
    return;
  }

  try {
    inputExecutor.queuePointerMove(coordinates, {
      requestId: message.requestId,
      hostReceivedAt
    });

    if (inputExecutor.isDebugCursorMoveEnabled()) {
      pushLog(
        "info",
        `Realtime pointer_move request=${message.requestId ?? "none"} ${message.payload.xNorm.toFixed(4)},${message.payload.yNorm.toFixed(4)} -> ${Math.round(coordinates.x)},${Math.round(coordinates.y)}`,
        "input"
      );
      showInputDebugMarker(message, coordinates);
    }

    if (HOST_INPUT_LATENCY_DEBUG) {
      wsServer.sendToActiveClient(
        createAckMessage("received", {
          requestId: message.requestId,
          message: "Queued realtime pointer_move.",
          data: {
            action: message.payload.action,
            x: Math.round(coordinates.x),
            y: Math.round(coordinates.y),
            hostReceivedAt
          }
        })
      );
    }
  } catch (error) {
    if (shouldDebugRealtimeMove) {
      const reason = error instanceof Error ? error.message : "Realtime pointer_move failed.";
      pushLog("error", `Failed realtime pointer_move: ${reason}`, "input");
      wsServer.sendToActiveClient(
        createAckMessage("failed", {
          requestId: message.requestId,
          ok: false,
          reason,
          message: "Host pointer_move failed."
        })
      );
    }
  }
}

function handlePointerMoveTelemetry(event: PointerMoveTelemetryEvent): void {
  if (!HOST_INPUT_LATENCY_DEBUG) {
    return;
  }

  if (event.kind === "replaced") {
    if (!event.replacedRequestId) {
      return;
    }

    wsServer.sendToActiveClient(
      createAckMessage("failed", {
        requestId: event.replacedRequestId,
        ok: false,
        reason: "Superseded by a newer pointer_move before execution.",
        message: "Skipped stale pointer_move.",
        data: {
          action: "pointer_move",
          replacedByRequestId: event.requestId,
          hostTelemetryAt: event.at
        }
      })
    );
    return;
  }

  if (event.kind === "skipped_no_delta") {
    if (!event.requestId) {
      return;
    }

    wsServer.sendToActiveClient(
      createAckMessage("failed", {
        requestId: event.requestId,
        ok: false,
        reason: "Skipped negligible pointer_move delta.",
        message: "Skipped negligible pointer_move.",
        data: {
          action: "pointer_move",
          hostTelemetryAt: event.at
        }
      })
    );
    return;
  }

  if (event.kind === "execute_end") {
    if (!event.requestId) {
      return;
    }

    wsServer.sendToActiveClient(
      createAckMessage("executed", {
        requestId: event.requestId,
        message: "Executed realtime pointer_move.",
        data: {
          action: "pointer_move",
          x: Math.round(event.x),
          y: Math.round(event.y),
          hostReceivedAt: event.hostReceivedAt,
          hostExecuteStartAt: event.executeStartAt,
          hostExecutedAt: event.at
        }
      })
    );
  }
}

function validateKeyboardInputMessage(
  message: KeyboardInputMessage
): { ok: true } | { ok: false; reason: string } {
  const { action, text, timestamp } = message.payload;

  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { ok: false, reason: "keyboard_input timestamp must be a positive number." };
  }

  if (action === "insert_text") {
    if (typeof text !== "string" || text.length === 0) {
      return { ok: false, reason: "keyboard_input insert_text requires non-empty text." };
    }

    if (text.length > 500) {
      return { ok: false, reason: "keyboard_input text is too long." };
    }
  }

  return { ok: true };
}

function logKeyboardDebug(message: string): void {
  if (!HOST_KEYBOARD_DEBUG) {
    return;
  }

  pushLog("info", `[keyboard] ${message}`, "keyboard");
}

async function handleKeyboardInputMessage(message: KeyboardInputMessage): Promise<CtrlxMessage[]> {
  logKeyboardDebug(
    `parsed request=${message.requestId ?? "none"} action=${message.payload.action} textLength=${message.payload.text?.length ?? 0}`
  );
  const acknowledgements: CtrlxMessage[] = [
    createAckMessage("received", {
      requestId: message.requestId,
      message: `Received ${message.payload.action} keyboard input.`
    })
  ];

  const validation = validateKeyboardInputMessage(message);
  if (!validation.ok) {
    logKeyboardDebug(`validation failed request=${message.requestId ?? "none"} reason=${validation.reason}`);
    pushLog("warn", `Rejected keyboard input: ${validation.reason}`, "keyboard");
    acknowledgements.push(
      createAckMessage("failed", {
        requestId: message.requestId,
        ok: false,
        reason: validation.reason,
        message: "Rejected malformed keyboard input."
      })
    );
    return acknowledgements;
  }

  try {
    if (!keyboardExecutor) {
      throw new Error("Keyboard executor is not initialized.");
    }

    logKeyboardDebug(`validation passed request=${message.requestId ?? "none"} action=${message.payload.action}`);
    await keyboardExecutor.execute(message);
    logKeyboardDebug(`executed request=${message.requestId ?? "none"} action=${message.payload.action}`);
    acknowledgements.push(
      createAckMessage("executed", {
        requestId: message.requestId,
        message:
          message.payload.action === "insert_text"
            ? "Typed text on host."
            : message.payload.action === "backspace"
              ? "Sent backspace to host."
              : message.payload.action === "enter"
                ? "Sent return to host."
                : "Sent escape to host.",
        data: {
          action: message.payload.action,
          textLength: message.payload.text?.length ?? 0
        }
      })
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Host keyboard input failed.";
    logKeyboardDebug(`execution failed request=${message.requestId ?? "none"} reason=${reason}`);
    pushLog("error", `Failed to execute keyboard input: ${reason}`, "keyboard");
    acknowledgements.push(
      createAckMessage("failed", {
        requestId: message.requestId,
        ok: false,
        reason,
        message: "Host keyboard input failed."
      })
    );
  }

  return acknowledgements;
}

async function handleIncomingCtrlxMessage(
  message: CtrlxMessage,
  context: IncomingMessageContext
): Promise<CtrlxMessage | CtrlxMessage[] | null> {
  // Control input layer:
  // Viewer interaction events arrive here only as validated CTRLX JSON
  // messages over the control websocket, never as raw browser event data.
  if (isCommandMessage(message)) {
    pushLog("info", `Command received: ${message.payload.command}`, "host");
    return commandRouter.route(message);
  }

  if (isStreamRequestMessage(message)) {
    pushLog("info", `Stream request received: ${message.payload.action}`, "webrtc");
    return context.activeWebRtcHost.requestStream(message);
  }

  if (isStreamAnswerMessage(message)) {
    await context.activeWebRtcHost.applyAnswer(message);
    return null;
  }

  if (isStreamIceMessage(message)) {
    await context.activeWebRtcHost.addRemoteIce(message);
    return null;
  }

  if (isInputMessage(message)) {
    return handleScreenInputMessage(message, context);
  }

  if (isKeyboardInputMessage(message)) {
    return handleKeyboardInputMessage(message);
  }

  return createProtocolError(`Unsupported message type: ${message.type}`, message.requestId);
}

function createMessageBase(requestId?: string) {
  return {
    requestId,
    sessionCode: uiState.sessionCode,
    sentAt: createTimestamp()
  };
}

export async function startHost(runtime: {
  app: ElectronApp;
  BrowserWindow: BrowserWindowConstructor;
  desktopCapturer: DesktopCapturerLike;
  screen: ScreenLike;
  ipcMain: IpcMainLike;
  session: SessionLike;
  dialog: DialogLike;
}): Promise<void> {
  const { app, BrowserWindow, desktopCapturer, screen, ipcMain, session, dialog } = runtime;

  await app.whenReady();
  hostLogger = new HostLoggingService({
    sessionCode: () => uiState.sessionCode,
    appendToUi: appendHostUiLog,
    forwardToClient: forwardHostLogEntry
  });
  const logFilePath = await hostLogger.initialize(app.getPath("userData"));
  await createWindow(BrowserWindow);
  if (logFilePath) {
    pushLog("info", `Persistent host logs writing to ${logFilePath}`, "host", {
      forwardToClient: false,
      context: { logFilePath }
    });
  }
  executor.updateDependencies({
    requestImportSelection: async (options) => {
    const response = await dialog.showOpenDialog(mainWindow, {
      title: "Select audio files, zip, or folder for CTRLX import",
      buttonLabel: "Use Selection",
      properties: options?.allowFolders === false
        ? ["openFile", "multiSelections"]
        : ["openFile", "openDirectory", "multiSelections"],
      filters: [
        {
          name: "Audio or Zip",
          extensions: ["zip", "wav", "wave", "aif", "aiff", "caf", "mp3", "m4a", "flac"]
        }
      ]
    });

    if (response.canceled || response.filePaths.length === 0) {
      emitImportProgress({
        kind: "import_execution",
        phase: "files_selected",
        status: "cancelled",
        message: "Host import selection was cancelled."
      });
      return null;
    }

    const sourceName =
      response.filePaths.length === 1
        ? response.filePaths[0].split("/").pop() ?? "Host Selection"
        : `Host Selection (${response.filePaths.length} items)`;
    emitImportProgress({
      kind: "import_execution",
      phase: "files_selected",
      status: "running",
      message: `Host is reading ${sourceName}.`
    });

    const result = await importUploadManager.ingestSelectedPaths(response.filePaths);
    setImportSessionSummaryFromResult(result);
    emitImportProgress({
      kind: "import_execution",
      phase: "files_discovered",
      status: result.acceptedCount > 0 ? "succeeded" : "failed",
      message:
        result.acceptedCount > 0
          ? `Discovered ${result.acceptedCount} supported audio file${result.acceptedCount === 1 ? "" : "s"} from ${result.sourceName}.`
          : `No supported audio files were discovered in ${result.sourceName}.`,
      totalItems: result.acceptedCount,
      processedItems: 0,
      reason: result.acceptedCount > 0 ? null : "empty_or_unsupported_selection"
    });
    emitImportProgress({
      kind: "import_execution",
      phase: "plan_generated",
      status: result.acceptedCount > 0 ? "succeeded" : "failed",
      message:
        result.acceptedCount > 0
          ? `Import plan generated for ${result.acceptedCount} supported file${result.acceptedCount === 1 ? "" : "s"} from ${result.sourceName}.`
          : `No supported audio files were found in ${result.sourceName}.`,
      totalItems: result.acceptedCount,
      processedItems: 0,
      reason: result.acceptedCount > 0 ? null : "empty_or_unsupported_selection"
    });
    return result;
    }
  });
  inputExecutor = new InputExecutor(
    screen,
    (message) => pushLog("info", message, "input"),
    HOST_INPUT_LATENCY_DEBUG ? handlePointerMoveTelemetry : undefined
  );
  keyboardExecutor = new KeyboardExecutor((message) => pushLog("info", message, "keyboard"));
  void inputExecutor.prewarmRealtimeCursorPath().catch((error) => {
    const reason = error instanceof Error ? error.message : "Unknown cursor helper startup failure.";
    if (HOST_INPUT_LATENCY_DEBUG || inputExecutor?.isDebugCursorMoveEnabled()) {
      pushLog("warn", `Cursor helper prewarm failed: ${reason}`, "input");
    }
  });

  // Streaming layer:
  // WebRtcHost owns live screen/audio transport and signaling messages.
  // It should not receive raw control gestures directly from the viewer UI.
  webRtcHost = new WebRtcHost({
    BrowserWindow,
    desktopCapturer,
    screen,
    session,
    ipcMain,
    logger: (message) => pushLog("info", message, "webrtc"),
    createMessageBase,
    sendSignal: (message) => {
      wsServer.sendToActiveClient(message);
    }
  });

  await webRtcHost.initialize();
  const activeWebRtcHost = webRtcHost;

  wsServer.start({
    onClientHello: () => {
      pushLog("info", "Received hello from client.", "ws");
      return createStatusMessage("waiting", "Hello received. Awaiting pair request.");
    },
    onInvalidMessage: (requestId) => {
      return createProtocolError("Message did not match CTRLX protocol.", requestId);
    },
    onClientMessage: async (message) => {
      return handleIncomingCtrlxMessage(message, {
        activeWebRtcHost,
        screen
      });
    },
    onRealtimePointerMove: (message) => {
      handleRealtimePointerMoveMessage(message, {
        screen
      });
    },
    onImportUpload: async ({ sourceName, archiveBuffer }) => {
      emitImportProgress({
        kind: "import_execution",
        phase: "files_selected",
        status: "running",
        message: `Host is reading ${sourceName}.`
      });
      const result = await importUploadManager.ingestArchiveUpload(sourceName, archiveBuffer);
      setImportSessionSummaryFromResult(result);
      emitImportProgress({
        kind: "import_execution",
        phase: "files_discovered",
        status: result.acceptedCount > 0 ? "succeeded" : "failed",
        message:
          result.acceptedCount > 0
            ? `Discovered ${result.acceptedCount} supported audio file${result.acceptedCount === 1 ? "" : "s"} from ${result.sourceName}.`
            : `No supported audio files were discovered in ${result.sourceName}.`,
        totalItems: result.acceptedCount,
        processedItems: 0,
        reason: result.acceptedCount > 0 ? null : "empty_or_unsupported_selection"
      });
      emitImportProgress({
        kind: "import_execution",
        phase: "plan_generated",
        status: result.acceptedCount > 0 ? "succeeded" : "failed",
        message:
          result.acceptedCount > 0
            ? `Import plan generated for ${result.acceptedCount} supported file${result.acceptedCount === 1 ? "" : "s"} from ${result.sourceName}.`
            : `No supported audio files were found in ${result.sourceName}.`,
        totalItems: result.acceptedCount,
        processedItems: 0,
        reason: result.acceptedCount > 0 ? null : "empty_or_unsupported_selection"
      });
      return result;
    }
  });

  pushLog("info", `Session code ${uiState.sessionCode}`, "host");
  pushLog("info", `Host listening on ws://${uiState.hostAddress}:${uiState.port}`, "ws");
  pushLog("info", "Host capture subsystems are now initialized lazily through the active WebRTC stream path.", "webrtc");
  app.on("window-all-closed", () => {
    webRtcHost?.stop();
    wsServer.stop();
    app.quit();
  });
}
