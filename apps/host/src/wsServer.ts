import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  DEFAULT_WS_PORT,
  isClientMessage,
  type ClientHelloMessage,
  type RemoteInputEvent,
  type RTCSignalPayload,
  type ServerErrorMessage,
  type ServerMessage,
  type ServerReadyMessage,
  type ServerStateMessage
} from "@ctrlx/shared-protocol";
import { WebSocket, WebSocketServer, type RawData } from "ws";

type Logger = (level: "info" | "warn" | "error", message: string) => void;

export type HostSnapshot = {
  sessionCode: string;
  hostAddress: string;
  port: number;
  activeClientId: string | null;
  audioDeviceName: string | null;
  captureStatus: ServerStateMessage["captureStatus"];
  message?: string;
};

type Hooks = {
  onSignalFromClient: (payload: RTCSignalPayload) => void;
  onRemoteInput: (event: RemoteInputEvent) => Promise<void>;
  onClientChanged: (clientId: string | null) => void;
  onServerError?: (error: Error & { code?: string }) => void;
};

export class CtrlxWebSocketServer {
  private readonly httpServer = createServer();
  private readonly wss = new WebSocketServer({ server: this.httpServer });
  private activeSocket: WebSocket | null = null;
  private activeClientId: string | null = null;

  constructor(
    private readonly snapshot: HostSnapshot,
    private readonly hooks: Hooks,
    private readonly logger: Logger
  ) {}

  start(): void {
    this.wss.on("connection", (socket) => this.handleConnection(socket));
    this.httpServer.on("error", (error: Error & { code?: string }) => {
      this.hooks.onServerError?.(error);
    });
    this.httpServer.listen(this.snapshot.port, () => {
      this.logger("info", `CTRLX signaling server on ws://${this.snapshot.hostAddress}:${this.snapshot.port}`);
    });
  }

  stop(): void {
    this.wss.close();
    this.httpServer.close();
  }

  broadcastState(): void {
    if (!this.activeSocket || this.activeSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.send({
      type: "server_state",
      sessionCode: this.snapshot.sessionCode,
      hostAddress: this.snapshot.hostAddress,
      audioDeviceName: this.snapshot.audioDeviceName,
      captureStatus: this.snapshot.captureStatus,
      activeClientId: this.snapshot.activeClientId,
      message: this.snapshot.message
    });
  }

  sendSignal(payload: RTCSignalPayload): void {
    this.send({
      type: "server_signal",
      payload
    });
  }

  private handleConnection(socket: WebSocket): void {
    const candidateId = randomUUID();
    let isAuthorized = false;

    socket.on("message", async (data) => {
      const parsed = this.parseMessage(data);
      if (!parsed) {
        this.sendDirect(socket, {
          type: "server_error",
          code: "INVALID_MESSAGE",
          message: "Incoming message did not match CTRLX protocol."
        });
        return;
      }

      if (!isAuthorized) {
        if (parsed.type !== "client_hello") {
          this.sendDirect(socket, {
            type: "server_error",
            code: "INVALID_SESSION",
            message: "Pairing must begin with a valid session code."
          });
          socket.close();
          return;
        }

        const accepted = this.acceptClient(socket, parsed, candidateId);
        isAuthorized = accepted;
        return;
      }

      if (parsed.type === "client_signal") {
        this.hooks.onSignalFromClient(parsed.payload);
        return;
      }

      if (parsed.type === "client_input") {
        try {
          await this.hooks.onRemoteInput(parsed.event);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Input injection failed.";
          this.send({
            type: "server_error",
            code: "INPUT_FAILED",
            message
          });
          this.logger("error", message);
        }
      }
    });

    socket.on("close", () => {
      if (this.activeSocket === socket) {
        this.activeSocket = null;
        this.activeClientId = null;
        this.snapshot.activeClientId = null;
        this.hooks.onClientChanged(null);
        this.logger("info", "Client disconnected.");
      }
    });
  }

  private acceptClient(socket: WebSocket, hello: ClientHelloMessage, clientId: string): boolean {
    if (hello.sessionCode !== this.snapshot.sessionCode) {
      this.sendDirect(socket, {
        type: "server_error",
        code: "INVALID_SESSION",
        message: "Session code does not match the host."
      });
      socket.close();
      return false;
    }

    if (this.activeSocket) {
      this.sendDirect(socket, {
        type: "server_error",
        code: "CLIENT_ALREADY_CONNECTED",
        message: "Only one active CTRLX viewer is allowed."
      });
      socket.close();
      return false;
    }

    this.activeSocket = socket;
    this.activeClientId = clientId;
    this.snapshot.activeClientId = clientId;
    this.hooks.onClientChanged(clientId);
    this.logger("info", `Paired client ${hello.clientName ?? clientId}`);

    const ready: ServerReadyMessage = {
      type: "server_ready",
      sessionCode: this.snapshot.sessionCode,
      hostName: "CTRLX Host",
      hostAddress: this.snapshot.hostAddress,
      port: this.snapshot.port,
      pairedAt: new Date().toISOString()
    };

    this.send(ready);
    this.broadcastState();
    return true;
  }

  private parseMessage(data: RawData) {
    try {
      const parsed = JSON.parse(data.toString()) as unknown;
      return isClientMessage(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  private send(message: ServerMessage): void {
    if (!this.activeSocket || this.activeSocket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.activeSocket.send(JSON.stringify(message));
  }

  private sendDirect(socket: WebSocket, message: ServerErrorMessage): void {
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    socket.send(JSON.stringify(message));
  }
}
