import {
  CtrlxMessageType,
  type StreamIceMessage,
  type StreamOfferMessage,
  type StreamStatusMessage
} from "@ctrlx/protocol";

// Streaming layer:
// This class is dedicated to live media transport only. It owns the WebRTC
// audio/video path and never sends UI/browser interaction objects directly.
// Viewer interactions must stay on the JSON control websocket layer.

type OutboundIceCandidate = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
};

type WebRtcClientOptions = {
  onRemoteStream: (stream: MediaStream | null) => void;
  onStatusChange: (status: string) => void;
  sendStreamRequest: (action: "start" | "stop") => void;
  sendAnswer: (payload: { sdp: string; type: "answer" }) => void;
  sendIceCandidate: (payload: OutboundIceCandidate) => void;
  log: (message: string, level?: "info" | "success" | "error") => void;
};

export class CtrlxWebRtcClient {
  private readonly options: WebRtcClientOptions;
  private peerConnection: RTCPeerConnection | null = null;
  private remoteStream: MediaStream | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = false;
  private isStopping = false;

  private static readonly MAX_RECONNECT_ATTEMPTS = 3;
  private static readonly RECONNECT_DELAY_MS = 1800;

  constructor(options: WebRtcClientOptions) {
    this.options = options;
  }

  start(): void {
    this.clearReconnectTimer();
    this.isStopping = false;
    this.shouldReconnect = true;
    this.reconnectAttempts = 0;
    this.ensurePeerConnection();
    this.options.onStatusChange("Connecting to stream...");
    this.options.sendStreamRequest("start");
  }

  stop(): void {
    this.clearReconnectTimer();
    this.shouldReconnect = false;
    this.isStopping = true;
    this.options.sendStreamRequest("stop");
    this.teardown("Stream stopped.");
  }

  async handleSignal(message: StreamOfferMessage | StreamIceMessage | StreamStatusMessage): Promise<void> {
    if (message.type === CtrlxMessageType.StreamOffer) {
      await this.handleOffer(message);
      return;
    }

    if (message.type === CtrlxMessageType.StreamIce) {
      await this.handleIce(message);
      return;
    }

    this.options.onStatusChange(message.payload.message ?? message.payload.state);
    if (message.payload.state === "streaming") {
      this.reconnectAttempts = 0;
    }

    if (message.payload.state === "signaling" && /reconnect|refresh|interruption/i.test(message.payload.message ?? "")) {
      this.scheduleReconnect(message.payload.message ?? "Reconnecting to stream...");
      return;
    }

    if (message.payload.state === "stopped") {
      this.shouldReconnect = false;
      this.teardown(message.payload.message ?? "Stream ended.");
      return;
    }

    if (message.payload.state === "error") {
      this.teardown(message.payload.message ?? "Stream ended.");
      this.scheduleReconnect("Host stream error. Retrying...");
    }
  }

  private async handleOffer(message: StreamOfferMessage): Promise<void> {
    const peerConnection = this.ensurePeerConnection();

    await peerConnection.setRemoteDescription({
      type: "offer",
      sdp: message.payload.sdp
    });

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    this.options.sendAnswer({
      sdp: answer.sdp ?? "",
      type: "answer"
    });

    this.options.onStatusChange("Negotiating stream");
    this.options.log("Received stream offer from host.");
  }

  private async handleIce(message: StreamIceMessage): Promise<void> {
    const peerConnection = this.ensurePeerConnection();

    await peerConnection.addIceCandidate({
      candidate: message.payload.candidate,
      sdpMid: message.payload.sdpMid,
      sdpMLineIndex: message.payload.sdpMLineIndex,
      usernameFragment: message.payload.usernameFragment ?? undefined
    });
  }

  private ensurePeerConnection(): RTCPeerConnection {
    if (this.peerConnection) {
      return this.peerConnection;
    }

    const peerConnection = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
    });

    const remoteStream = new MediaStream();
    this.remoteStream = remoteStream;
    this.options.onRemoteStream(remoteStream);

    peerConnection.ontrack = (event) => {
      const incomingStream = event.streams[0];
      if (incomingStream) {
        for (const track of incomingStream.getTracks()) {
          const alreadyAdded = remoteStream.getTracks().some((existingTrack) => existingTrack.id === track.id);
          if (!alreadyAdded) {
            remoteStream.addTrack(track);
          }
        }
      } else if (!remoteStream.getTracks().some((existingTrack) => existingTrack.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }

      event.track.onended = () => {
        this.options.log(`${event.track.kind} track ended. Attempting reconnect.`, "error");
        this.scheduleReconnect("Media track ended. Reconnecting...");
      };

      event.track.onmute = () => {
        if (event.track.kind === "audio") {
          this.options.onStatusChange("Audio interrupted. Reconnecting...");
          this.scheduleReconnect("Audio interrupted. Reconnecting...");
        }
      };

      this.options.onStatusChange("Streaming");
    };

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate) {
        return;
      }

      this.options.sendIceCandidate({
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        usernameFragment: event.candidate.usernameFragment ?? null
      });
    };

    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      if (state === "connected") {
        this.reconnectAttempts = 0;
        this.options.onStatusChange("Streaming");
        this.options.log("WebRTC stream connected.", "success");
      } else if (state === "disconnected") {
        this.options.onStatusChange("Network drop detected. Reconnecting...");
        this.options.log("WebRTC stream disconnected. Attempting reconnect.", "error");
        this.teardown("Network drop detected.");
        this.scheduleReconnect("Reconnecting to stream...");
      } else if (state === "failed") {
        this.options.onStatusChange("Stream connection failed. Reconnecting...");
        this.options.log("WebRTC stream failed. Attempting reconnect.", "error");
        this.teardown("WebRTC state: failed");
        this.scheduleReconnect("Reconnecting to stream...");
      } else if (state === "closed") {
        this.teardown(`WebRTC state: ${state}`);
      } else {
        this.options.onStatusChange(`WebRTC ${state}`);
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      const iceState = peerConnection.iceConnectionState;
      if (iceState === "disconnected" || iceState === "failed") {
        this.options.log(`ICE state ${iceState}. Attempting reconnect.`, "error");
        this.scheduleReconnect("Network interruption detected. Reconnecting...");
      }
    };

    this.peerConnection = peerConnection;
    return peerConnection;
  }

  private teardown(message: string): void {
    this.clearReconnectTimer();

    if (this.peerConnection) {
      this.peerConnection.onicecandidate = null;
      this.peerConnection.ontrack = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.oniceconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }

    if (this.remoteStream) {
      for (const track of this.remoteStream.getTracks()) {
        track.stop();
      }
      this.remoteStream = null;
    }

    this.options.onRemoteStream(null);
    this.options.onStatusChange(message);
  }

  private scheduleReconnect(message: string): void {
    if (!this.shouldReconnect || this.isStopping) {
      return;
    }

    if (this.reconnectAttempts >= CtrlxWebRtcClient.MAX_RECONNECT_ATTEMPTS) {
      this.shouldReconnect = false;
      this.options.onStatusChange("Stream reconnect failed.");
      this.options.log("Stream reconnect limit reached.", "error");
      return;
    }

    this.clearReconnectTimer();
    this.reconnectAttempts += 1;
    this.options.onStatusChange(message);

    this.reconnectTimer = setTimeout(() => {
      if (!this.shouldReconnect || this.isStopping) {
        return;
      }

      this.ensurePeerConnection();
      this.options.sendStreamRequest("start");
    }, CtrlxWebRtcClient.RECONNECT_DELAY_MS);
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) {
      return;
    }

    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}
