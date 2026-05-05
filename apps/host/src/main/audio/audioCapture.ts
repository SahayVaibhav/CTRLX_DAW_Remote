import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

type CaptureLogger = (message: string) => void;

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

type IpcMainLike = {
  on: (channel: string, listener: (_event: unknown, payload?: unknown) => void) => void;
  removeAllListeners: (channel: string) => void;
};

type AudioCaptureOptions = {
  BrowserWindow: BrowserWindowConstructor;
  ipcMain: IpcMainLike;
  logger: CaptureLogger;
};

export type AudioCaptureStream = {
  deviceId: string;
  deviceLabel: string;
  startedAt: string;
  sampleRate?: number;
  channelCount?: number;
};

type AudioCaptureState = "idle" | "capturing" | "unavailable" | "error";

type DeviceInfoPayload = {
  deviceId: string;
  deviceLabel: string;
  startedAt: string;
  sampleRate?: number;
  channelCount?: number;
};

type StatusPayload = {
  state: AudioCaptureState;
  message: string;
};

const IPC_AUDIO_START = "ctrlx-audio-start";
const IPC_AUDIO_STOP = "ctrlx-audio-stop";
const IPC_AUDIO_INFO = "ctrlx-audio-info";
const IPC_AUDIO_STATUS = "ctrlx-audio-status";
const AUDIO_SAMPLE_RATE = 48_000;
const AUDIO_BUFFER_LATENCY = 0.02;

export class AudioCapture {
  private readonly BrowserWindow: BrowserWindowConstructor;
  private readonly ipcMain: IpcMainLike;
  private readonly logger: CaptureLogger;

  private hiddenWindow: InstanceType<BrowserWindowConstructor> | null = null;
  private isInitialized = false;
  private state: AudioCaptureState = "idle";
  private streamInfo: AudioCaptureStream | null = null;

  constructor(options: AudioCaptureOptions) {
    this.BrowserWindow = options.BrowserWindow;
    this.ipcMain = options.ipcMain;
    this.logger = options.logger;
  }

  async startAudioCapture(): Promise<void> {
    await this.initialize();

    if (!this.hiddenWindow || this.hiddenWindow.isDestroyed()) {
      this.state = "error";
      this.logger("Audio capture bridge is unavailable.");
      return;
    }

    if (this.state === "capturing") {
      this.logger(`Audio capture already active on ${this.streamInfo?.deviceLabel ?? "unknown device"}.`);
      return;
    }

    this.hiddenWindow.webContents.send(IPC_AUDIO_START);
  }

  stopAudioCapture(): void {
    if (!this.hiddenWindow || this.hiddenWindow.isDestroyed()) {
      this.state = "idle";
      this.streamInfo = null;
      this.logger("Audio capture already stopped.");
      return;
    }

    this.hiddenWindow.webContents.send(IPC_AUDIO_STOP);
  }

  getAudioStream(): AudioCaptureStream | null {
    return this.streamInfo;
  }

  stop(): void {
    this.stopAudioCapture();
    this.hiddenWindow?.close();
    this.hiddenWindow = null;
    this.state = "idle";
    this.streamInfo = null;
    this.ipcMain.removeAllListeners(IPC_AUDIO_INFO);
    this.ipcMain.removeAllListeners(IPC_AUDIO_STATUS);
  }

  private async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    await this.ensureWindow();
    this.registerIpcHandlers();
    this.isInitialized = true;
    this.logger("Audio capture bridge ready.");
  }

  private async ensureWindow(): Promise<void> {
    if (this.hiddenWindow && !this.hiddenWindow.isDestroyed()) {
      return;
    }

    this.hiddenWindow = new this.BrowserWindow({
      show: false,
      width: 600,
      height: 400,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        backgroundThrottling: false
      }
    });

    await this.hiddenWindow.loadURL(this.resolveAudioBridgeUrl());
    await this.hiddenWindow.webContents.executeJavaScript(this.renderCaptureScript());
  }

  private resolveAudioBridgeUrl(): string {
    const candidates = [
      path.resolve(process.cwd(), "src/main/audio/audioBridge.html"),
      path.resolve(process.cwd(), "../src/main/audio/audioBridge.html")
    ];

    const match = candidates.find((candidate) => existsSync(candidate));
    const htmlPath = match ?? candidates[0];
    return pathToFileURL(htmlPath).toString();
  }

  private registerIpcHandlers(): void {
    this.ipcMain.removeAllListeners(IPC_AUDIO_INFO);
    this.ipcMain.removeAllListeners(IPC_AUDIO_STATUS);

    this.ipcMain.on(IPC_AUDIO_INFO, (_event, payload?: unknown) => {
      const info = payload as DeviceInfoPayload | undefined;
      if (!info) {
        return;
      }

      this.streamInfo = {
        deviceId: info.deviceId,
        deviceLabel: info.deviceLabel,
        startedAt: info.startedAt,
        sampleRate: info.sampleRate,
        channelCount: info.channelCount
      };
    });

    this.ipcMain.on(IPC_AUDIO_STATUS, (_event, payload?: unknown) => {
      const status = payload as StatusPayload | undefined;
      if (!status) {
        return;
      }

      this.state = status.state;
      if (status.state !== "capturing") {
        this.streamInfo = null;
      }

      this.logger(`Audio capture ${status.state}: ${status.message}`);
    });
  }

  private renderCaptureScript(): string {
    return `
      const { ipcRenderer } = require("electron");

      const BLACKHOLE_NAME_PATTERN = /blackhole/i;
      let audioStream = null;
      let shouldKeepAlive = false;
      let restartTimer = null;

      function sendStatus(state, message) {
        ipcRenderer.send("${IPC_AUDIO_STATUS}", { state, message });
      }

      function sendInfo(info) {
        ipcRenderer.send("${IPC_AUDIO_INFO}", info);
      }

      function getMediaDevices() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error("Media devices API is unavailable in the audio capture bridge.");
        }

        return navigator.mediaDevices;
      }

      async function findBlackHoleDevice() {
        const devices = await getMediaDevices().enumerateDevices();
        return devices.find((device) => {
          return device.kind === "audioinput" && BLACKHOLE_NAME_PATTERN.test(device.label || "");
        }) || null;
      }

      function scheduleRestart(reason) {
        if (!shouldKeepAlive) {
          return;
        }

        if (restartTimer) {
          clearTimeout(restartTimer);
        }

        restartTimer = setTimeout(() => {
          restartTimer = null;
          ipcRenderer.emit("${IPC_AUDIO_START}");
          sendStatus("idle", reason);
        }, 900);
      }

      async function stopCurrent(reason = "Audio capture stopped.") {
        shouldKeepAlive = false;

        if (restartTimer) {
          clearTimeout(restartTimer);
          restartTimer = null;
        }

        if (audioStream) {
          for (const track of audioStream.getTracks()) {
            track.stop();
          }
          audioStream = null;
        }

        sendStatus("idle", reason);
      }

      ipcRenderer.on("${IPC_AUDIO_START}", async () => {
        try {
          shouldKeepAlive = true;
          await stopCurrent("Restarting audio capture.");
          shouldKeepAlive = true;

          const blackHoleDevice = await findBlackHoleDevice();
          if (!blackHoleDevice) {
            sendStatus(
              "unavailable",
              "BlackHole audio device not found. Route Logic Pro output to a BlackHole device and try again."
            );
            return;
          }

          audioStream = await getMediaDevices().getUserMedia({
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

          const [track] = audioStream.getAudioTracks();
          const settings = track && track.getSettings ? track.getSettings() : {};
          if (track) {
            track.onended = () => {
              scheduleRestart("BlackHole audio stream ended. Reconnecting...");
            };
          }

          sendInfo({
            deviceId: blackHoleDevice.deviceId,
            deviceLabel: blackHoleDevice.label || "BlackHole",
            startedAt: new Date().toISOString(),
            sampleRate: settings.sampleRate,
            channelCount: settings.channelCount
          });

          sendStatus("capturing", "Audio capture started from " + (blackHoleDevice.label || "BlackHole") + ".");
        } catch (error) {
          sendStatus(
            "error",
            error && error.message ? error.message : "Failed to start BlackHole audio capture."
          );
        }
      });

      ipcRenderer.on("${IPC_AUDIO_STOP}", async () => {
        await stopCurrent("Audio capture stopped.");
      });

      if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        navigator.mediaDevices.addEventListener("devicechange", () => {
          scheduleRestart("Audio device change detected. Refreshing BlackHole capture...");
        });
      }

      sendStatus("idle", "Awaiting BlackHole audio capture.");
    `;
  }
}
