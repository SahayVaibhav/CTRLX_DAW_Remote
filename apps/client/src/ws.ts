import {
  CTRLX_PROTOCOL_VERSION,
  CtrlxCommand,
  CtrlxMessageType,
  createTimestamp,
  isCtrlxLogEntryStatusData,
  validateCtrlxMessage,
  type ImportAutomationPlan,
  type AckMessage,
  type CommandMessage,
  type CommandErrorPayload,
  type CommandPayload,
  type CommandResultPayload,
  type CtrlxHostMessage,
  type CtrlxLogEntry,
  type CtrlxLogLevel,
  type CtrlxLogSource,
  type ErrorMessage,
  type HelloMessage,
  type InputMessage,
  type KeyboardInputMessage,
  type PairRequestMessage,
  type ResultMessage,
  type StreamAnswerMessage,
  type StreamIceMessage,
  type StreamRequestMessage
} from "@ctrlx/protocol";
import { createClientId } from "./id";

// Session/pairing + control layer:
// This websocket transport is reserved for JSON CTRLX protocol messages such as
// pairing, commands, acknowledgements, and remote viewer input. Media streaming
// remains on the separate WebRTC path in webrtc.ts.

const DEBUG_CONTROL_MESSAGES =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugControl") === "1";
const DEBUG_KEYBOARD_MESSAGES =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  (window.localStorage.getItem("ctrlx.debugKeyboard") === "1" ||
    window.localStorage.getItem("ctrlx.debugControl") === "1");
const DEBUG_POINTER_MOVE_REQUESTS =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  (window.localStorage.getItem("ctrlx.debugLatency") === "1" ||
    window.localStorage.getItem("ctrlx.debugCursorMove") === "1" ||
    window.localStorage.getItem("ctrlx.debugMoveDiagnostics") === "1");
const USE_POINTER_MOVE_WEBHOOK =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.pointerMoveWebhook") === "1";
const POINTER_MOVE_WEBHOOK_PATH = "/ctrlx-pointer-move";
const IMPORT_UPLOAD_HTTP_PATH = "/ctrlx-import-upload";

export type ConnectionStatus = "disconnected" | "connecting" | "paired" | "error";

export type ClientLogEntry = CtrlxLogEntry;

export function createClientLogEntry(
  level: CtrlxLogLevel,
  message: string,
  source: CtrlxLogSource,
  context?: Record<string, unknown>
): ClientLogEntry {
  return {
    id: createClientId(),
    level,
    message,
    at: new Date().toISOString(),
    source,
    context
  };
}

export type PointerMoveTransportEvent = {
  kind: "sent" | "deferred" | "replaced" | "flushed";
  at: number;
  requestId?: string;
  replacedRequestId?: string;
  bufferedAmount: number;
};

export type WsClientOptions = {
  onStatusChange: (status: ConnectionStatus, message?: string) => void;
  onMessage: (message: CtrlxHostMessage) => void;
  onLog: (entry: ClientLogEntry) => void;
  onAck?: (message: AckMessage) => void;
  onPointerMoveTransportEvent?: (event: PointerMoveTransportEvent) => void;
};

export type ImportUploadResult = {
  sessionId: string;
  sourceName: string;
  acceptedCount: number;
  skippedCount: number;
  errorCount: number;
  items: unknown[];
  plan: ImportAutomationPlan;
};

export type HostImportSelectionResult =
  | ({
      cancelled: false;
    } & ImportUploadResult)
  | {
      cancelled: true;
    };

type PendingCommandRequest = {
  resolve: (payload: CommandResultPayload) => void;
  reject: (payload: CommandErrorPayload | Error) => void;
};

function parseHostInput(rawHost: string): { normalizedHost: string; port: string } {
  const trimmed = rawHost.trim();
  if (!trimmed) {
    return {
      normalizedHost: "localhost",
      port: "4545"
    };
  }

  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`);
    return {
      normalizedHost: url.hostname || "localhost",
      port: url.port || "4545"
    };
  } catch {
    const withoutPath = trimmed.replace(/\/.*$/, "");
    const match = withoutPath.match(/^(.*?)(?::(\d+))?$/);

    return {
      normalizedHost: match?.[1] || "localhost",
      port: match?.[2] || "4545"
    };
  }
}

function shouldUseDevProxy(normalizedHost: string): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const currentHost = window.location.hostname;
  const currentPort = window.location.port;
  const isDevServerPort = currentPort === "5173" || currentPort === "5174" || currentPort === "5175" || currentPort === "5176";

  return Boolean(currentHost && isDevServerPort && currentHost === normalizedHost);
}

function sanitizeKeyboardPayload(
  payload: KeyboardInputMessage["payload"]
): KeyboardInputMessage["payload"] | null {
  if (!Number.isFinite(payload.timestamp) || payload.timestamp <= 0) {
    return null;
  }

  if (payload.action === "insert_text") {
    const text = typeof payload.text === "string" ? payload.text : "";
    if (text.length === 0) {
      return null;
    }

    return {
      action: "insert_text",
      text,
      timestamp: payload.timestamp
    };
  }

  if (payload.action === "backspace" || payload.action === "enter" || payload.action === "escape") {
    return {
      action: payload.action,
      timestamp: payload.timestamp
    };
  }

  return null;
}

export class CtrlxWsClient {
  private static readonly CONNECT_TIMEOUT_MS = 5000;
  private static readonly POINTER_MOVE_BUFFER_HIGH_WATERMARK = 32 * 1024;
  private static readonly POINTER_MOVE_RETRY_MS = 8;

  private socket: WebSocket | null = null;
  private sessionCode: string | null = null;
  private activeAttempt = 0;
  private lastTerminalStatus: ConnectionStatus | null = null;
  private connectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pendingPointerMoveMessage: InputMessage | null = null;
  private pointerMoveFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pointerMoveHttpEndpoint: string | null = null;
  private importUploadHttpEndpoint: string | null = null;
  private pendingCommandRequests = new Map<string, PendingCommandRequest>();

  constructor(private readonly options: WsClientOptions) {}

  connect(host: string, sessionCode: string): void {
    const { normalizedHost, port } = parseHostInput(host);
    const useDevProxy = shouldUseDevProxy(normalizedHost);
    const url = useDevProxy
      ? `ws://${window.location.host}/ctrlx-ws`
      : `ws://${normalizedHost}:${port}`;
    this.pointerMoveHttpEndpoint = useDevProxy
      ? `${window.location.origin}${POINTER_MOVE_WEBHOOK_PATH}`
      : `http://${normalizedHost}:${port}${POINTER_MOVE_WEBHOOK_PATH}`;
    this.importUploadHttpEndpoint = useDevProxy
      ? `${window.location.origin}${IMPORT_UPLOAD_HTTP_PATH}`
      : `http://${normalizedHost}:${port}${IMPORT_UPLOAD_HTTP_PATH}`;
    this.sessionCode = sessionCode.trim().toUpperCase();

    if (!this.sessionCode) {
      this.pushLog("error", "Enter a session code before connecting.", "ws");
      this.options.onStatusChange("error", "Missing session code");
      return;
    }

    this.activeAttempt += 1;
    const attemptId = this.activeAttempt;
    const previousSocket = this.socket;
    this.lastTerminalStatus = null;
    this.options.onStatusChange("connecting", "Connecting to host");
    this.socket = new WebSocket(url);
    previousSocket?.close();
    this.clearConnectTimeout();

    const socket = this.socket;

    this.connectTimeout = setTimeout(() => {
      if (this.socket !== socket || this.activeAttempt !== attemptId) {
        return;
      }

      this.lastTerminalStatus = "error";
      this.options.onStatusChange("error", "Host connection timed out. Check Wi-Fi, firewall, and host app.");
      this.pushLog("error", `Timed out trying to reach ${url}.`, "ws");
      socket.close();
    }, CtrlxWsClient.CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (this.socket !== socket || this.activeAttempt !== attemptId) {
        return;
      }

      this.clearConnectTimeout();
      this.pushLog("info", `Connected to ${url}`, "ws");
      this.options.onStatusChange("connecting", "Pairing with host");
      this.sendHello();
      this.sendPair();
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket || this.activeAttempt !== attemptId) {
        return;
      }

      this.clearConnectTimeout();

      let parsed: unknown;

      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        this.pushLog("error", "Received invalid JSON from host.", "ws");
        return;
      }

      const validation = validateCtrlxMessage(parsed);
      if (!validation.ok) {
        this.pushLog("error", `Received message that does not match CTRLX protocol: ${validation.reason}`, "ws");
        return;
      }

      const message = validation.message as CtrlxHostMessage;
      this.options.onMessage(message);

      if (message.type === CtrlxMessageType.PairSuccess) {
        this.options.onStatusChange("paired", `Paired with ${message.payload.hostName}`);
        this.pushLog("success", `Paired with ${message.payload.hostName}`, "ws");
        return;
      }

      if (message.type === CtrlxMessageType.Error) {
        this.rejectPendingCommandRequest(message);
        this.lastTerminalStatus = "error";
        this.options.onStatusChange("error", message.payload.message);
        this.pushLog("error", message.payload.message, "ws");
        return;
      }

      if (message.type === CtrlxMessageType.Result) {
        this.resolvePendingCommandRequest(message);
        this.pushLog("success", message.payload.message, "ws");
        return;
      }

      if (message.type === CtrlxMessageType.Ack) {
        this.options.onAck?.(message);
        const ackMessage =
          message.payload.state === "failed"
            ? message.payload.reason ?? message.payload.message ?? "Host input failed."
            : message.payload.message ?? `Host ack: ${message.payload.state}`;

        this.pushLog(message.payload.ok ? "info" : "error", ackMessage, "ws");
        return;
      }

      if (message.type === CtrlxMessageType.Status && message.payload.message) {
        if (isCtrlxLogEntryStatusData(message.payload.data)) {
          this.options.onLog(message.payload.data.entry);
          return;
        }

        const isImportProgress =
          message.payload.data &&
          typeof message.payload.data === "object" &&
          "kind" in message.payload.data &&
          message.payload.data.kind === "import_execution";
        const importProgressData =
          isImportProgress && message.payload.data && typeof message.payload.data === "object"
            ? message.payload.data
            : null;
        const isKeepAlive =
          importProgressData !== null &&
          "keepAlive" in importProgressData &&
          importProgressData.keepAlive === true;
        if (!isImportProgress) {
          this.options.onStatusChange(
            message.payload.connectionState === "paired" ? "paired" : message.payload.connectionState === "error" ? "error" : "connecting",
            message.payload.message
          );
        }
        if (!isKeepAlive) {
          this.pushLog("info", message.payload.message, "ws");
        }
      }
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket || this.activeAttempt !== attemptId) {
        return;
      }

      this.clearConnectTimeout();
      this.clearPendingPointerMove();
      this.rejectAllPendingCommandRequests(new Error("Disconnected from host before command completed."));
      this.socket = null;
      if (this.lastTerminalStatus === "error") {
        return;
      }

      this.options.onStatusChange("disconnected", "Disconnected");
      this.pushLog("info", "Disconnected from host.", "ws");
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket || this.activeAttempt !== attemptId) {
        return;
      }

      this.clearConnectTimeout();
      this.rejectAllPendingCommandRequests(new Error("WebSocket connection failed before command completed."));
      this.lastTerminalStatus = "error";
      this.options.onStatusChange("error", "Unable to reach host");
      this.pushLog("error", "WebSocket connection failed.", "ws");
    });
  }

  disconnect(): void {
    const socket = this.socket;
    this.socket = null;
    this.activeAttempt += 1;
    this.lastTerminalStatus = "disconnected";
    this.clearConnectTimeout();
    this.clearPendingPointerMove();
    this.rejectAllPendingCommandRequests(new Error("Disconnected from host before command completed."));
    this.pointerMoveHttpEndpoint = null;
    this.importUploadHttpEndpoint = null;
    socket?.close();
    this.options.onStatusChange("disconnected", "Disconnected");
    this.pushLog("info", "Disconnected from host.", "ws");
  }

  sendCommand(command: CtrlxCommand): void {
    if (command === CtrlxCommand.RenameTrack || command === CtrlxCommand.SetTrackColor) {
      this.pushLog("error", `${command} requires a structured input payload.`, "ws");
      return;
    }

    this.sendCommandMessage({ command } as CommandPayload);
  }

  sendCommandMessage(payload: CommandPayload): void {
    this.sendCommandMessageInternal(payload);
  }

  sendCommandMessageForResult(payload: CommandPayload): Promise<CommandResultPayload> {
    return new Promise<CommandResultPayload>((resolve, reject) => {
      const requestId = this.sendCommandMessageInternal(payload);
      if (!requestId) {
        reject(new Error(`Cannot send ${payload.command}. Host is not connected.`));
        return;
      }

      this.pendingCommandRequests.set(requestId, {
        resolve,
        reject
      });
    });
  }

  async uploadImportArchive(sourceName: string, archive: Blob): Promise<ImportUploadResult> {
    if (!this.importUploadHttpEndpoint || !this.sessionCode) {
      throw new Error("Host import upload is unavailable until CTRLX is connected and paired.");
    }

    const response = await fetch(this.importUploadHttpEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/zip",
        "x-ctrlx-session-code": this.sessionCode,
        "x-ctrlx-source-name": sourceName
      },
      body: archive
    });

    const payload = (await response.json()) as
      | ({ ok: true } & ImportUploadResult)
      | { ok: false; reason?: string };

    if (!response.ok || !payload.ok) {
      const failureReason = "reason" in payload ? payload.reason : undefined;
      throw new Error(failureReason || "Host import upload failed.");
    }

    return {
      sessionId: payload.sessionId,
      sourceName: payload.sourceName,
      acceptedCount: payload.acceptedCount,
      skippedCount: payload.skippedCount,
      errorCount: payload.errorCount,
      items: payload.items,
      plan: payload.plan
    };
  }

  async requestHostImportSelection(allowFolders = true): Promise<HostImportSelectionResult> {
    const result = await this.sendCommandMessageForResult({
      command: CtrlxCommand.RequestImportSelection,
      input: {
        allowFolders
      }
    });

    const data = result.data ?? {};
    if (data.cancelled === true) {
      return {
        cancelled: true
      };
    }

    return {
      cancelled: false,
      sessionId: typeof data.sessionId === "string" ? data.sessionId : "",
      sourceName: typeof data.sourceName === "string" ? data.sourceName : "Host Selection",
      acceptedCount: typeof data.acceptedCount === "number" ? data.acceptedCount : 0,
      skippedCount: typeof data.skippedCount === "number" ? data.skippedCount : 0,
      errorCount: typeof data.errorCount === "number" ? data.errorCount : 0,
      items: Array.isArray(data.items) ? data.items : [],
      plan: (data.plan as ImportAutomationPlan) ?? {
        source: "import_automation",
        items: [],
        executableItems: [],
        suggestionActions: []
      }
    };
  }

  private sendCommandMessageInternal(payload: CommandPayload): string | null {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.sessionCode) {
      this.pushLog("error", `Cannot send ${payload.command}. Host is not connected.`, "ws");
      return null;
    }

    const requestId = createClientId();

    const message: CommandMessage = {
      type: CtrlxMessageType.Command,
      requestId,
      sessionCode: this.sessionCode,
      sentAt: createTimestamp(),
      payload
    };

    this.socket.send(JSON.stringify(message));
    this.pushLog("info", `Sent command ${payload.command}`, "ws");
    return requestId;
  }

  sendStreamRequest(action: "start" | "stop"): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.sessionCode) {
      this.pushLog("error", `Cannot ${action} stream. Host is not connected.`, "ws");
      return;
    }

    const message: StreamRequestMessage = {
      type: CtrlxMessageType.StreamRequest,
      requestId: createClientId(),
      sessionCode: this.sessionCode,
      sentAt: createTimestamp(),
      payload: {
        action
      }
    };

    this.socket.send(JSON.stringify(message));
    this.pushLog("info", `${action === "start" ? "Requested" : "Stopped"} video stream.`, "ws");
  }

  sendStreamAnswer(payload: { sdp: string; type: "answer" }): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.sessionCode) {
      this.pushLog("error", "Cannot send WebRTC answer. Host is not connected.", "ws");
      return;
    }

    const message: StreamAnswerMessage = {
      type: CtrlxMessageType.StreamAnswer,
      requestId: createClientId(),
      sessionCode: this.sessionCode,
      sentAt: createTimestamp(),
      payload
    };

    this.socket.send(JSON.stringify(message));
  }

  sendStreamIceCandidate(payload: {
    candidate: string;
    sdpMid: string | null;
    sdpMLineIndex: number | null;
    usernameFragment?: string | null;
  }): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.sessionCode) {
      return;
    }

    const message: StreamIceMessage = {
      type: CtrlxMessageType.StreamIce,
      requestId: createClientId(),
      sessionCode: this.sessionCode,
      sentAt: createTimestamp(),
      payload
    };

    this.socket.send(JSON.stringify(message));
  }

  // Control input layer:
  // Viewer gestures are converted into sanitized protocol payloads before they
  // reach this method. Raw browser/touch event objects must never be sent.
  sendInputEvent(payload: InputMessage["payload"]): string | null {
    if (payload.action === "pointer_move") {
      return this.sendPointerMoveEvent(payload);
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.sessionCode) {
      return null;
    }

    const requestId = createClientId();
    const message: InputMessage = {
      type: CtrlxMessageType.ScreenInput,
      requestId,
      sessionCode: this.sessionCode,
      sentAt: createTimestamp(),
      payload
    };

    this.debugControlMessage(message);
    this.socket.send(JSON.stringify(message));
    return requestId;
  }

  sendPointerMoveEvent(payload: InputMessage["payload"], message?: InputMessage): string | null {
    if (payload.action !== "pointer_move") {
      return this.sendInputEvent(payload);
    }

    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.sessionCode) {
      return null;
    }

    const pointerMoveMessage =
      message ??
      ({
        type: CtrlxMessageType.ScreenInput,
        requestId: DEBUG_POINTER_MOVE_REQUESTS ? createClientId() : undefined,
        sessionCode: this.sessionCode,
        sentAt: createTimestamp(),
        payload
      } satisfies InputMessage);

    if (USE_POINTER_MOVE_WEBHOOK && this.pointerMoveHttpEndpoint) {
      void this.postPointerMoveWebhook(pointerMoveMessage);
      return pointerMoveMessage.requestId ?? null;
    }

    return this.sendLatestPointerMove(pointerMoveMessage);
  }

  sendKeyboardInput(payload: KeyboardInputMessage["payload"]): string | null {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.sessionCode) {
      return null;
    }

    const sanitizedPayload = sanitizeKeyboardPayload(payload);
    if (!sanitizedPayload) {
      return null;
    }

    const requestId = createClientId();
    const message: KeyboardInputMessage = {
      type: CtrlxMessageType.KeyboardInput,
      requestId,
      sessionCode: this.sessionCode,
      sentAt: createTimestamp(),
      payload: sanitizedPayload
    };

    if (DEBUG_KEYBOARD_MESSAGES) {
      console.debug("[CTRLX keyboard input]", {
        type: message.type,
        requestId,
        sessionCode: message.sessionCode,
        action: sanitizedPayload.action,
        sentAt: message.sentAt,
        payload: {
          action: sanitizedPayload.action,
          text: sanitizedPayload.text,
          timestamp: sanitizedPayload.timestamp
        }
      });
    }

    this.socket.send(JSON.stringify(message));
    return requestId;
  }

  private sendHello(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: HelloMessage = {
      type: CtrlxMessageType.Hello,
      requestId: createClientId(),
      sentAt: createTimestamp(),
      payload: {
        protocolVersion: CTRLX_PROTOCOL_VERSION,
        role: "client",
        clientName: "CTRLX Web Client"
      }
    };

    this.socket.send(JSON.stringify(message));
  }

  private sendPair(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.sessionCode) {
      return;
    }

    const message: PairRequestMessage = {
      type: CtrlxMessageType.PairRequest,
      requestId: createClientId(),
      sessionCode: this.sessionCode,
      sentAt: createTimestamp(),
      payload: {
        sessionCode: this.sessionCode,
        clientName: "CTRLX Web Client"
      }
    };

    this.socket.send(JSON.stringify(message));
  }

  private clearConnectTimeout(): void {
    if (!this.connectTimeout) {
      return;
    }

    clearTimeout(this.connectTimeout);
    this.connectTimeout = null;
  }

  private sendLatestPointerMove(message: InputMessage): string | null {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return null;
    }

    if (
      this.socket.bufferedAmount > CtrlxWsClient.POINTER_MOVE_BUFFER_HIGH_WATERMARK ||
      this.pointerMoveFlushTimer !== null
    ) {
      const previousPendingRequestId = this.pendingPointerMoveMessage?.requestId;
      if (DEBUG_CONTROL_MESSAGES && this.pendingPointerMoveMessage) {
        console.debug("[CTRLX control input]", {
          type: message.type,
          action: message.payload.action,
          droppedPendingRequestId: this.pendingPointerMoveMessage.requestId,
          replacedByRequestId: message.requestId,
          bufferedAmount: this.socket.bufferedAmount
        });
      }

      if (previousPendingRequestId) {
        this.options.onPointerMoveTransportEvent?.({
          kind: "replaced",
          at: Date.now(),
          requestId: message.requestId,
          replacedRequestId: previousPendingRequestId,
          bufferedAmount: this.socket.bufferedAmount
        });
      }

      this.options.onPointerMoveTransportEvent?.({
        kind: "deferred",
        at: Date.now(),
        requestId: message.requestId,
        bufferedAmount: this.socket.bufferedAmount
      });
      this.pendingPointerMoveMessage = message;
      this.schedulePointerMoveFlush();
      return null;
    }

    this.debugControlMessage(message);
    this.socket.send(JSON.stringify(message));
    this.options.onPointerMoveTransportEvent?.({
      kind: "sent",
      at: Date.now(),
      requestId: message.requestId,
      bufferedAmount: this.socket.bufferedAmount
    });
    return message.requestId ?? null;
  }

  private schedulePointerMoveFlush(): void {
    if (this.pointerMoveFlushTimer !== null) {
      return;
    }

    this.pointerMoveFlushTimer = setTimeout(() => {
      this.pointerMoveFlushTimer = null;
      this.flushPendingPointerMove();
    }, CtrlxWsClient.POINTER_MOVE_RETRY_MS);
  }

  private flushPendingPointerMove(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN || !this.pendingPointerMoveMessage) {
      this.clearPendingPointerMove();
      return;
    }

    if (this.socket.bufferedAmount > CtrlxWsClient.POINTER_MOVE_BUFFER_HIGH_WATERMARK) {
      this.schedulePointerMoveFlush();
      return;
    }

    const message = this.pendingPointerMoveMessage;
    this.pendingPointerMoveMessage = null;
    this.debugControlMessage(message);
    this.socket.send(JSON.stringify(message));
    this.options.onPointerMoveTransportEvent?.({
      kind: "flushed",
      at: Date.now(),
      requestId: message.requestId,
      bufferedAmount: this.socket.bufferedAmount
    });

    if (this.pendingPointerMoveMessage) {
      this.schedulePointerMoveFlush();
    }
  }

  private clearPendingPointerMove(): void {
    this.pendingPointerMoveMessage = null;
    if (!this.pointerMoveFlushTimer) {
      return;
    }

    clearTimeout(this.pointerMoveFlushTimer);
    this.pointerMoveFlushTimer = null;
  }

  private resolvePendingCommandRequest(message: ResultMessage): void {
    if (!message.requestId) {
      return;
    }

    const pending = this.pendingCommandRequests.get(message.requestId);
    if (!pending) {
      return;
    }

    this.pendingCommandRequests.delete(message.requestId);
    pending.resolve(message.payload);
  }

  private rejectPendingCommandRequest(message: ErrorMessage): void {
    if (!message.requestId) {
      return;
    }

    const pending = this.pendingCommandRequests.get(message.requestId);
    if (!pending) {
      return;
    }

    this.pendingCommandRequests.delete(message.requestId);
    pending.reject(message.payload);
  }

  private rejectAllPendingCommandRequests(error: Error): void {
    if (this.pendingCommandRequests.size === 0) {
      return;
    }

    for (const pending of this.pendingCommandRequests.values()) {
      pending.reject(error);
    }

    this.pendingCommandRequests.clear();
  }

  private async postPointerMoveWebhook(message: InputMessage): Promise<void> {
    const endpoint = this.pointerMoveHttpEndpoint;
    if (!endpoint) {
      return;
    }

    try {
      await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(message),
        keepalive: true
      });

      this.options.onPointerMoveTransportEvent?.({
        kind: "sent",
        at: Date.now(),
        requestId: message.requestId,
        bufferedAmount: this.socket?.bufferedAmount ?? 0
      });
    } catch {
      if (DEBUG_CONTROL_MESSAGES) {
        console.debug("[CTRLX pointer webhook] fallback to websocket transport");
      }

      this.sendLatestPointerMove(message);
    }
  }

  private debugControlMessage(message: InputMessage): void {
    if (
      !DEBUG_CONTROL_MESSAGES ||
      (message.payload.action === "pointer_move" && window.localStorage.getItem("ctrlx.debugCursorMove") !== "1")
    ) {
      return;
    }

    console.debug("[CTRLX control input]", {
      type: message.type,
      requestId: message.requestId,
      action: message.payload.action,
      sentAt: message.sentAt,
      timestamp: message.payload.timestamp,
      xNorm: message.payload.xNorm,
      yNorm: message.payload.yNorm
    });
  }

  private pushLog(level: ClientLogEntry["level"], message: string, source: CtrlxLogSource): void {
    this.options.onLog(createClientLogEntry(level, message, source));
  }
}
