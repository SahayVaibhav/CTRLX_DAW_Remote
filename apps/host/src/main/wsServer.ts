import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import {
  CtrlxMessageType,
  createTimestamp,
  parseCtrlxMessage,
  type CtrlxMessage,
  type ErrorMessage,
  type HelloMessage,
  type InputMessage,
  type PairRequestMessage,
  type StatusMessage
} from "#protocol";
import { SessionManager } from "./sessionManager.js";

// Session/pairing + control layer:
// This server only accepts JSON CTRLX protocol messages over WebSocket.
// Live media transport remains on the separate WebRTC path and should never
// send browser/native event objects through this parser.

export type HostConnectionState = "waiting" | "paired" | "busy" | "error";

type ServerContext = {
  sessionManager: SessionManager;
  port: () => number;
  hostName: () => string;
};

type ServerHooks = {
  onStateChange: (state: HostConnectionState, clientName?: string | null) => void;
  onError: (message: string) => void;
  onLog: (message: string) => void;
};

type StartHandlers = {
  onClientHello: (message: HelloMessage) => StatusMessage;
  onInvalidMessage: (requestId?: string) => ErrorMessage;
  onClientMessage: (message: CtrlxMessage) => Promise<CtrlxMessage | CtrlxMessage[] | null>;
  onRealtimePointerMove?: (message: InputMessage) => void;
  onImportUpload?: (request: {
    sessionCode: string;
    sourceName: string;
    archiveBuffer: Buffer;
  }) => Promise<{
    sessionId: string;
    sourceName: string;
    acceptedCount: number;
    skippedCount: number;
    errorCount: number;
    items: unknown[];
    plan: unknown;
  }>;
};

const REALTIME_POINTER_HTTP_PATH = "/ctrlx-pointer-move";
const IMPORT_UPLOAD_HTTP_PATH = "/ctrlx-import-upload";

function isRealtimePointerMoveMessage(message: CtrlxMessage): message is InputMessage {
  return message.type === CtrlxMessageType.ScreenInput && message.payload.action === "pointer_move";
}

function describeParsedProtocolContext(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") {
    return "type=unknown requestId=unknown sessionCode=unknown";
  }

  const candidate = parsed as {
    type?: unknown;
    requestId?: unknown;
    sessionCode?: unknown;
  };

  const type = typeof candidate.type === "string" ? candidate.type : "unknown";
  const requestId = typeof candidate.requestId === "string" ? candidate.requestId : "unknown";
  const sessionCode = typeof candidate.sessionCode === "string" ? candidate.sessionCode : "unknown";

  return `type=${type} requestId=${requestId} sessionCode=${sessionCode}`;
}

export class CtrlxWsServer {
  private readonly httpServer = createServer();
  private readonly socketServer = new WebSocketServer({ server: this.httpServer });
  private activeSocket: WebSocket | null = null;
  private activeClientName: string | null = null;
  private activePairToken: string | null = null;

  constructor(
    private readonly context: ServerContext,
    private readonly hooks: ServerHooks
  ) {}

  start(handlers: StartHandlers): void {
    this.httpServer.on("request", (request, response) => {
      void this.handleHttpRequest(request, response, handlers);
    });

    this.socketServer.on("connection", (socket, request) => {
      let isPaired = false;
      const remoteAddress = request.socket.remoteAddress ?? "unknown";
      this.hooks.onLog(`Incoming websocket connection from ${remoteAddress}`);

      socket.on("message", async (raw) => {
        const parsedResult = this.parseMessage(raw, remoteAddress);
        if (!parsedResult.ok) {
          this.sendDirect(socket, handlers.onInvalidMessage());
          return;
        }

        const message = parsedResult.message;

        if (message.type === CtrlxMessageType.Hello) {
          this.hooks.onLog(`Hello received from ${remoteAddress}`);
          this.sendDirect(socket, handlers.onClientHello(message));
          return;
        }

        if (!isPaired) {
          if (message.type !== CtrlxMessageType.PairRequest) {
            this.sendDirect(socket, this.invalidSession("Pair request required before commands.", message.requestId));
            socket.close();
            return;
          }

          if (!this.handlePair(socket, message)) {
            return;
          }

          isPaired = true;
          return;
        }

        if (isRealtimePointerMoveMessage(message) && handlers.onRealtimePointerMove) {
          handlers.onRealtimePointerMove(message);
          return;
        }

        const response = await handlers.onClientMessage(message);
        this.sendReply(socket, response);
      });

      socket.on("close", () => {
        if (socket === this.activeSocket) {
          this.activeSocket = null;
          this.activeClientName = null;
          this.activePairToken = null;
          this.hooks.onStateChange("waiting", null);
        }
      });
    });

    this.httpServer.on("error", (error) => {
      this.hooks.onStateChange("error");
      this.hooks.onError(error.message);
    });

    this.httpServer.listen(this.context.port(), "0.0.0.0", () => {
      this.hooks.onStateChange("waiting");
    });
  }

  stop(): void {
    this.socketServer.close();
    this.httpServer.close();
  }

  sendToActiveClient(message: CtrlxMessage | CtrlxMessage[]): void {
    if (!this.activeSocket) {
      return;
    }

    this.sendReply(this.activeSocket, message);
  }

  private handlePair(socket: WebSocket, message: PairRequestMessage): boolean {
    if (!this.context.sessionManager.matches(message.payload.sessionCode)) {
      this.hooks.onLog(`Rejected pair attempt for session ${message.payload.sessionCode}`);
      this.sendDirect(socket, this.invalidSession("Session code does not match host.", message.requestId));
      socket.close();
      return false;
    }

    if (this.activeSocket && this.activeSocket !== socket) {
      const previousSocket = this.activeSocket;
      const previousPairToken = this.activePairToken;

      this.sendDirect(previousSocket, {
        type: CtrlxMessageType.Error,
        sessionCode: this.context.sessionManager.getCode(),
        sentAt: createTimestamp(),
        payload: {
          ok: false,
          code: "ALREADY_PAIRED",
          message: "Another device took over this CTRLX session."
        }
      });

      this.activeSocket = null;
      this.activeClientName = null;
      this.activePairToken = null;
      previousSocket.close();

      if (this.activePairToken === previousPairToken) {
        this.hooks.onStateChange("waiting", null);
      }
    }

    this.activeSocket = socket;
    this.activeClientName = message.payload.clientName ?? "CTRLX Client";
    this.activePairToken = randomUUID();
    this.hooks.onLog(`Paired client ${this.activeClientName}`);
    this.hooks.onStateChange("paired", this.activeClientName);

    this.sendDirect(socket, {
      type: CtrlxMessageType.PairSuccess,
      requestId: message.requestId,
      sessionCode: this.context.sessionManager.getCode(),
      sentAt: createTimestamp(),
      payload: {
        sessionCode: this.context.sessionManager.getCode(),
        hostName: this.context.hostName(),
        connectionState: "paired"
      }
    });

    return true;
  }

  private invalidSession(message: string, requestId?: string): ErrorMessage {
    return {
      type: CtrlxMessageType.Error,
      requestId,
      sessionCode: this.context.sessionManager.getCode(),
      sentAt: createTimestamp(),
      payload: {
        ok: false,
        code: "INVALID_SESSION",
        message
      }
    };
  }

  private parseMessage(raw: RawData, remoteAddress: string) {
    const rawMessage = raw.toString();
    const result = parseCtrlxMessage(rawMessage);

    if (!result.ok) {
      this.hooks.onLog(`[protocol] invalid incoming message from ${remoteAddress}`);
      this.hooks.onLog(`[protocol] raw: ${rawMessage}`);
      if (result.parsed !== undefined) {
        this.hooks.onLog(`[protocol] parsed: ${JSON.stringify(result.parsed)}`);
        this.hooks.onLog(`[protocol] context: ${describeParsedProtocolContext(result.parsed)}`);
      }
      this.hooks.onLog(`[protocol] reason: ${result.reason}`);
      return result;
    }

    if (result.legacyType) {
      this.hooks.onLog(`[protocol] normalized legacy message ${result.legacyType} -> ${result.normalizedType}`);
    }

    return result;
  }

  private sendReply(socket: WebSocket, message: CtrlxMessage | CtrlxMessage[] | null): void {
    if (!message) {
      return;
    }

    if (Array.isArray(message)) {
      for (const entry of message) {
        this.sendDirect(socket, entry);
      }
      return;
    }

    this.sendDirect(socket, message);
  }

  private sendDirect(socket: WebSocket, message: CtrlxMessage): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(JSON.stringify(message));
  }

  private async handleHttpRequest(
    request: IncomingMessage,
    response: ServerResponse,
    handlers: StartHandlers
  ): Promise<void> {
    if (request.url === IMPORT_UPLOAD_HTTP_PATH) {
      await this.handleImportUploadRequest(request, response, handlers);
      return;
    }

    if (request.url !== REALTIME_POINTER_HTTP_PATH) {
      response.statusCode = 404;
      response.end();
      return;
    }

    if (request.method !== "POST") {
      response.statusCode = 405;
      response.setHeader("Allow", "POST");
      response.end();
      return;
    }

    const remoteAddress = request.socket.remoteAddress ?? "unknown";
    const rawBody = await this.readRequestBody(request);
    const parsedResult = this.parseMessage(Buffer.from(rawBody), remoteAddress);

    if (!parsedResult.ok) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: false, reason: parsedResult.reason }));
      return;
    }

    const message = parsedResult.message;
    if (!isRealtimePointerMoveMessage(message) || !handlers.onRealtimePointerMove) {
      response.statusCode = 422;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: false, reason: "Only realtime pointer_move is supported on this endpoint." }));
      return;
    }

    if (!message.sessionCode || !this.context.sessionManager.matches(message.sessionCode)) {
      response.statusCode = 403;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: false, reason: "Session code does not match host." }));
      return;
    }

    handlers.onRealtimePointerMove(message);
    response.statusCode = 202;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true }));
  }

  private async handleImportUploadRequest(
    request: IncomingMessage,
    response: ServerResponse,
    handlers: StartHandlers
  ): Promise<void> {
    if (request.method !== "POST") {
      response.statusCode = 405;
      response.setHeader("Allow", "POST");
      response.end();
      return;
    }

    if (!handlers.onImportUpload) {
      response.statusCode = 501;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: false, reason: "Import upload is not enabled on this host." }));
      return;
    }

    const sessionCodeHeader = request.headers["x-ctrlx-session-code"];
    const sourceNameHeader = request.headers["x-ctrlx-source-name"];
    const sessionCode = Array.isArray(sessionCodeHeader) ? sessionCodeHeader[0] : sessionCodeHeader;
    const sourceName = Array.isArray(sourceNameHeader) ? sourceNameHeader[0] : sourceNameHeader;

    if (typeof sessionCode !== "string" || !this.context.sessionManager.matches(sessionCode)) {
      response.statusCode = 403;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: false, reason: "Session code does not match host." }));
      return;
    }

    if (typeof sourceName !== "string" || sourceName.trim().length === 0) {
      response.statusCode = 400;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: false, reason: "Missing import source name." }));
      return;
    }

    try {
      const archiveBuffer = await this.readRequestBuffer(request, 512 * 1024 * 1024);
      const result = await handlers.onImportUpload({
        sessionCode,
        sourceName: sourceName.trim(),
        archiveBuffer
      });

      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ ok: true, ...result }));
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          ok: false,
          reason: error instanceof Error ? error.message : "Import upload failed."
        })
      );
    }
  }

  private readRequestBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 1024 * 1024) {
          reject(new Error("HTTP request body too large."));
          request.destroy();
        }
      });
      request.on("end", () => resolve(body));
      request.on("error", reject);
    });
  }

  private readRequestBuffer(request: IncomingMessage, maxBytes: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let totalBytes = 0;

      request.on("data", (chunk: Buffer | string) => {
        const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        totalBytes += buffer.byteLength;
        if (totalBytes > maxBytes) {
          reject(new Error("HTTP request body too large."));
          request.destroy();
          return;
        }
        chunks.push(buffer);
      });

      request.on("end", () => resolve(Buffer.concat(chunks)));
      request.on("error", reject);
    });
  }
}
