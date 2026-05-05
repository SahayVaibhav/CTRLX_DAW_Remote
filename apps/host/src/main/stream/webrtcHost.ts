import {
  CtrlxMessageType,
  createTimestamp,
  type CtrlxMessage,
  type StreamAnswerMessage,
  type StreamIceMessage,
  type StreamOfferMessage,
  type StreamRequestMessage,
  type StreamStatusMessage
} from "#protocol";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type BrowserWindowConstructor = {
  new (options: {
    show: boolean;
    width: number;
    height: number;
    webPreferences: {
      nodeIntegration: boolean;
      contextIsolation: boolean;
      backgroundThrottling: boolean;
    };
  }): {
    loadURL: (url: string) => Promise<void>;
    webContents: {
      send: (channel: string, payload?: unknown) => void;
      executeJavaScript: (code: string) => Promise<unknown>;
    };
    isDestroyed: () => boolean;
    close: () => void;
  };
};

type DesktopCapturerSource = {
  id: string;
  display_id?: string;
  name: string;
};

type DesktopCapturerLike = {
  getSources: (options: {
    types: Array<"screen" | "window">;
    thumbnailSize: {
      width: number;
      height: number;
    };
    fetchWindowIcons?: boolean;
  }) => Promise<DesktopCapturerSource[]>;
};

type ScreenLike = {
  getPrimaryDisplay: () => {
    id: number;
    bounds: {
      width: number;
      height: number;
    };
  };
};

type SessionLike = {
  defaultSession?: {
    setDisplayMediaRequestHandler?: (
      handler: (
        request: unknown,
        callback: (response: {
          video: DesktopCapturerSource | null;
          audio?: "none";
        }) => void
      ) => void,
      options?: {
        useSystemPicker?: boolean;
      }
    ) => void;
  };
};

type IpcMainLike = {
  on: (channel: string, listener: (_event: unknown, payload?: unknown) => void) => void;
  removeAllListeners: (channel: string) => void;
};

type WebRtcHostOptions = {
  BrowserWindow: BrowserWindowConstructor;
  desktopCapturer: DesktopCapturerLike;
  screen: ScreenLike;
  session: SessionLike;
  ipcMain: IpcMainLike;
  logger: (message: string) => void;
  createMessageBase: (requestId?: string) => {
    requestId?: string;
    sessionCode?: string;
    sentAt: string;
  };
  sendSignal: (message: CtrlxMessage | CtrlxMessage[]) => void;
};

type IcePayload = {
  requestId?: string;
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
};

type OfferPayload = {
  requestId?: string;
  sdp: string;
  type: "offer";
};

type StatusPayload = {
  requestId?: string;
  state: "idle" | "requesting" | "signaling" | "streaming" | "stopped" | "error";
  message?: string;
};

const IPC_START = "ctrlx-webrtc-start";
const IPC_STOP = "ctrlx-webrtc-stop";
const IPC_ANSWER = "ctrlx-webrtc-answer";
const IPC_REMOTE_ICE = "ctrlx-webrtc-remote-ice";
const IPC_OFFER = "ctrlx-webrtc-offer";
const IPC_ICE = "ctrlx-webrtc-ice";
const IPC_STATUS = "ctrlx-webrtc-status";
const MAX_STREAM_WIDTH = 1920;
const MAX_STREAM_HEIGHT = 1080;
const STREAM_FPS = 24;
const MAX_VIDEO_BITRATE = 5_500_000;
const BLACKHOLE_DEVICE_PATTERN = /blackhole/i;
const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_BUFFER_LATENCY = 0.02;
const MAX_AUDIO_BITRATE = 128_000;

export class WebRtcHost {
  private readonly BrowserWindow: BrowserWindowConstructor;
  private readonly desktopCapturer: DesktopCapturerLike;
  private readonly screen: ScreenLike;
  private readonly session: SessionLike;
  private readonly ipcMain: IpcMainLike;
  private readonly logger: (message: string) => void;
  private readonly createMessageBase: WebRtcHostOptions["createMessageBase"];
  private readonly sendSignal: WebRtcHostOptions["sendSignal"];

  private hiddenWindow: InstanceType<BrowserWindowConstructor> | null = null;
  private isInitialized = false;

  constructor(options: WebRtcHostOptions) {
    this.BrowserWindow = options.BrowserWindow;
    this.desktopCapturer = options.desktopCapturer;
    this.screen = options.screen;
    this.session = options.session;
    this.ipcMain = options.ipcMain;
    this.logger = options.logger;
    this.createMessageBase = options.createMessageBase;
    this.sendSignal = options.sendSignal;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.ensureWindow();
    this.configureDisplayCapture();
    this.registerIpcHandlers();
    this.isInitialized = true;
    this.logger("WebRTC host initialized.");
  }

  async requestStream(message: StreamRequestMessage): Promise<StreamStatusMessage | null> {
    await this.initialize();

    if (!this.hiddenWindow || this.hiddenWindow.isDestroyed()) {
      return this.createStreamStatus("error", "Hidden WebRTC capture window is unavailable.", message.requestId);
    }

    if (message.payload.action === "stop") {
      this.hiddenWindow.webContents.send(IPC_STOP);
      return this.createStreamStatus("stopped", "Screen stream stopped.", message.requestId);
    }

    this.hiddenWindow.webContents.send(IPC_START, {
      requestId: message.requestId
    });

    return this.createStreamStatus("requesting", "Starting screen stream.", message.requestId);
  }

  async applyAnswer(message: StreamAnswerMessage): Promise<void> {
    await this.initialize();
    this.hiddenWindow?.webContents.send(IPC_ANSWER, {
      requestId: message.requestId,
      ...message.payload
    });
  }

  async addRemoteIce(message: StreamIceMessage): Promise<void> {
    await this.initialize();
    this.hiddenWindow?.webContents.send(IPC_REMOTE_ICE, {
      requestId: message.requestId,
      ...message.payload
    });
  }

  stop(): void {
    this.hiddenWindow?.webContents.send(IPC_STOP);
    this.hiddenWindow?.close();
    this.hiddenWindow = null;

    this.ipcMain.removeAllListeners(IPC_OFFER);
    this.ipcMain.removeAllListeners(IPC_ICE);
    this.ipcMain.removeAllListeners(IPC_STATUS);
  }

  private async ensureWindow(): Promise<void> {
    if (this.hiddenWindow && !this.hiddenWindow.isDestroyed()) {
      return;
    }

    this.hiddenWindow = new this.BrowserWindow({
      show: false,
      width: 1000,
      height: 700,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false
      }
    });

    await this.hiddenWindow.loadURL(this.resolveCaptureBridgeUrl());
    await this.hiddenWindow.webContents.executeJavaScript(this.renderCaptureScript());
  }

  private resolveCaptureBridgeUrl(): string {
    const candidates = [
      path.resolve(process.cwd(), "src/main/stream/captureBridge.html"),
      path.resolve(process.cwd(), "../src/main/stream/captureBridge.html")
    ];

    const match = candidates.find((candidate) => {
      return existsSync(candidate);
    });

    const htmlPath = match ?? candidates[0];
    return pathToFileURL(htmlPath).toString();
  }

  private configureDisplayCapture(): void {
    this.session.defaultSession?.setDisplayMediaRequestHandler?.(
      async (_request, callback) => {
        const primaryDisplay = this.screen.getPrimaryDisplay();
        const sources = await this.desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: {
            width: primaryDisplay.bounds.width,
            height: primaryDisplay.bounds.height
          },
          fetchWindowIcons: false
        });

        const source =
          sources.find((candidate) => candidate.display_id === String(primaryDisplay.id)) ??
          sources[0] ??
          null;

        callback({
          video: source,
          audio: "none"
        });
      },
      {
        useSystemPicker: false
      }
    );
  }

  private registerIpcHandlers(): void {
    this.ipcMain.removeAllListeners(IPC_OFFER);
    this.ipcMain.removeAllListeners(IPC_ICE);
    this.ipcMain.removeAllListeners(IPC_STATUS);

    this.ipcMain.on(IPC_OFFER, (_event, payload?: unknown) => {
      const offer = payload as OfferPayload | undefined;
      if (!offer) {
        return;
      }

      const message: StreamOfferMessage = {
        ...this.createMessageBase(offer.requestId),
        type: CtrlxMessageType.StreamOffer,
        payload: {
          sdp: offer.sdp,
          type: "offer"
        }
      };

      this.sendSignal(message);
      this.logger("WebRTC offer sent to client.");
    });

    this.ipcMain.on(IPC_ICE, (_event, payload?: unknown) => {
      const candidate = payload as IcePayload | undefined;
      if (!candidate) {
        return;
      }

      const message: StreamIceMessage = {
        ...this.createMessageBase(candidate.requestId),
        type: CtrlxMessageType.StreamIce,
        payload: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          usernameFragment: candidate.usernameFragment ?? null
        }
      };

      this.sendSignal(message);
    });

    this.ipcMain.on(IPC_STATUS, (_event, payload?: unknown) => {
      const status = payload as StatusPayload | undefined;
      if (!status) {
        return;
      }

      this.sendSignal(this.createStreamStatus(status.state, status.message ?? status.state, status.requestId));
      this.logger(`WebRTC host status: ${status.state}${status.message ? ` - ${status.message}` : ""}`);
    });
  }

  private createStreamStatus(
    state: StreamStatusMessage["payload"]["state"],
    message: string,
    requestId?: string
  ): StreamStatusMessage {
    return {
      ...this.createMessageBase(requestId),
      type: CtrlxMessageType.StreamStatus,
      payload: {
        state,
        message
      }
    };
  }

  private renderCaptureScript(): string {
    return `
      const { ipcRenderer } = require("electron");

      let peerConnection = null;
      let mediaStream = null;
      let audioStream = null;
      let activeRequestId = null;
      let restartTimer = null;
      let restartAttempts = 0;

      const MAX_RESTART_ATTEMPTS = 3;
      const RESTART_DELAY_MS = 1200;

      function sendStatus(state, message, requestId) {
        ipcRenderer.send("${IPC_STATUS}", { state, message, requestId });
      }

      function getMediaDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Media devices API is unavailable in the host capture bridge.");
        }

        return navigator.mediaDevices;
      }

      async function getDisplayStream() {
        const mediaDevices = getMediaDevices();
        if (!mediaDevices.getDisplayMedia) {
          throw new Error("Display capture API is unavailable in the host capture bridge.");
        }

        return mediaDevices.getDisplayMedia({
          audio: false,
          video: {
            width: { ideal: ${MAX_STREAM_WIDTH}, max: ${MAX_STREAM_WIDTH} },
            height: { ideal: ${MAX_STREAM_HEIGHT}, max: ${MAX_STREAM_HEIGHT} },
            frameRate: { ideal: ${STREAM_FPS}, max: ${STREAM_FPS} }
          }
        });
      }

      async function getBlackHoleAudioStream() {
        const mediaDevices = getMediaDevices();
        const devices = await mediaDevices.enumerateDevices();
        const blackHoleDevice = devices.find((device) => {
          return device.kind === "audioinput" && ${BLACKHOLE_DEVICE_PATTERN}.test(device.label || "");
        });

        if (!blackHoleDevice) {
          return null;
        }

        return mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: blackHoleDevice.deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
            sampleRate: { ideal: ${AUDIO_SAMPLE_RATE} },
            latency: { ideal: ${AUDIO_BUFFER_LATENCY} }
          },
          video: false
        });
      }

      function scheduleRestart(message) {
        if (!activeRequestId) {
          return;
        }

        if (restartAttempts >= MAX_RESTART_ATTEMPTS) {
          sendStatus("error", "Audio/video stream could not recover automatically.", activeRequestId);
          return;
        }

        if (restartTimer) {
          clearTimeout(restartTimer);
        }

        restartAttempts += 1;
        sendStatus("signaling", message, activeRequestId);
        restartTimer = setTimeout(() => {
          restartTimer = null;
          ipcRenderer.emit("${IPC_START}", null, { requestId: activeRequestId });
        }, RESTART_DELAY_MS);
      }

      async function ensureStream() {
        if (mediaStream) {
          return {
            videoStream: mediaStream,
            audioCaptureStream: audioStream
          };
        }

        mediaStream = await getDisplayStream();

        const [videoTrack] = mediaStream.getVideoTracks();
        if (videoTrack && videoTrack.applyConstraints) {
          await videoTrack.applyConstraints({
            width: { ideal: ${MAX_STREAM_WIDTH}, max: ${MAX_STREAM_WIDTH} },
            height: { ideal: ${MAX_STREAM_HEIGHT}, max: ${MAX_STREAM_HEIGHT} },
            frameRate: { ideal: ${STREAM_FPS}, max: ${STREAM_FPS} }
          }).catch(() => undefined);
        }

        audioStream = await getBlackHoleAudioStream().catch(() => null);
        const [audioTrack] = audioStream ? audioStream.getAudioTracks() : [];
        if (audioTrack) {
          audioTrack.contentHint = "music";
          audioTrack.onended = () => {
            scheduleRestart("Audio device changed. Reconnecting stream...");
          };
        }

        return {
          videoStream: mediaStream,
          audioCaptureStream: audioStream
        };
      }

      async function stopCurrent(reason = "Stream stopped.") {
        if (restartTimer) {
          clearTimeout(restartTimer);
          restartTimer = null;
        }

        if (peerConnection) {
          peerConnection.onicecandidate = null;
          peerConnection.onconnectionstatechange = null;
          peerConnection.oniceconnectionstatechange = null;
          peerConnection.close();
          peerConnection = null;
        }

        if (mediaStream) {
          for (const track of mediaStream.getTracks()) {
            track.stop();
          }
          mediaStream = null;
        }

        if (audioStream) {
          for (const track of audioStream.getTracks()) {
            track.stop();
          }
          audioStream = null;
        }

        if (/restart|reconnect|refresh/i.test(reason)) {
          sendStatus("signaling", reason);
        } else {
          sendStatus("stopped", reason);
        }
      }

      ipcRenderer.on("${IPC_START}", async (_event, payload) => {
        const requestId = payload && payload.requestId ? payload.requestId : undefined;
        activeRequestId = requestId || activeRequestId;

        try {
          await stopCurrent("Restarting stream.");
          sendStatus("requesting", "Requesting screen capture permissions.", requestId);

          const { videoStream, audioCaptureStream } = await ensureStream();
          peerConnection = new RTCPeerConnection({
            iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
          });

          for (const track of videoStream.getTracks()) {
            const sender = peerConnection.addTrack(track, videoStream);
            if (track.kind === "video" && sender.getParameters && sender.setParameters) {
              const parameters = sender.getParameters();
              parameters.encodings = [
                {
                  maxBitrate: ${MAX_VIDEO_BITRATE},
                  maxFramerate: ${STREAM_FPS},
                  scaleResolutionDownBy: 1
                }
              ];
              await sender.setParameters(parameters).catch(() => undefined);
            }
          }

          for (const track of audioCaptureStream ? audioCaptureStream.getTracks() : []) {
            const sender = peerConnection.addTrack(track, audioCaptureStream);
            if (sender.getParameters && sender.setParameters) {
              const parameters = sender.getParameters();
              parameters.encodings = [
                {
                  maxBitrate: ${MAX_AUDIO_BITRATE}
                }
              ];
              await sender.setParameters(parameters).catch(() => undefined);
            }
          }

          peerConnection.onicecandidate = (event) => {
            if (!event.candidate) {
              return;
            }

            ipcRenderer.send("${IPC_ICE}", {
              requestId,
              candidate: event.candidate.candidate,
              sdpMid: event.candidate.sdpMid,
              sdpMLineIndex: event.candidate.sdpMLineIndex,
              usernameFragment: event.candidate.usernameFragment || null
            });
          };

          peerConnection.onconnectionstatechange = () => {
            const state = peerConnection ? peerConnection.connectionState : "closed";
            if (state === "connected") {
              restartAttempts = 0;
              sendStatus(
                "streaming",
                audioCaptureStream
                  ? "Screen and BlackHole audio streaming connected."
                  : "Screen stream connected. BlackHole audio unavailable.",
                requestId
              );
            } else if (state === "disconnected") {
              sendStatus("signaling", "Network drop detected. Waiting for reconnect.", requestId);
            } else if (state === "failed") {
              sendStatus("error", "Peer connection lost. Restart the stream.", requestId);
            } else if (state === "closed") {
              sendStatus("stopped", "Screen stream closed.", requestId);
            } else {
              sendStatus("signaling", "WebRTC state: " + state, requestId);
            }
          };

          peerConnection.oniceconnectionstatechange = () => {
            const iceState = peerConnection ? peerConnection.iceConnectionState : "closed";
            if (iceState === "failed" || iceState === "disconnected") {
              scheduleRestart("Network interruption detected. Reconnecting media stream...");
            }
          };

          const offer = await peerConnection.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false
          });

          await peerConnection.setLocalDescription(offer);

          ipcRenderer.send("${IPC_OFFER}", {
            requestId,
            sdp: offer.sdp,
            type: offer.type
          });
        } catch (error) {
          sendStatus("error", error && error.message ? error.message : "Failed to start screen stream.", requestId);
        }
      });

      ipcRenderer.on("${IPC_ANSWER}", async (_event, payload) => {
        if (!peerConnection) {
          return;
        }

        try {
          await peerConnection.setRemoteDescription(payload);
        } catch (error) {
          sendStatus("error", error && error.message ? error.message : "Failed to apply WebRTC answer.", payload && payload.requestId);
        }
      });

      ipcRenderer.on("${IPC_REMOTE_ICE}", async (_event, payload) => {
        if (!peerConnection) {
          return;
        }

        try {
          await peerConnection.addIceCandidate(payload);
        } catch (error) {
          sendStatus("error", error && error.message ? error.message : "Failed to add remote ICE candidate.", payload && payload.requestId);
        }
      });

      ipcRenderer.on("${IPC_STOP}", async () => {
        activeRequestId = null;
        restartAttempts = 0;
        await stopCurrent("Stream stopped by host.");
      });

      navigator.mediaDevices.addEventListener("devicechange", () => {
        scheduleRestart("Capture device change detected. Refreshing stream...");
      });

      sendStatus("idle", "WebRTC capture bridge ready.");
    `;
  }
}
