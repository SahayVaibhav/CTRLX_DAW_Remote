type HostSnapshot = {
  sessionCode: string;
  hostAddress: string;
  port: number;
  activeClientId: string | null;
  audioDeviceName: string | null;
  captureStatus: "idle" | "requesting-permissions" | "capturing" | "streaming" | "error";
  message?: string;
  logs: Array<{ message: string; timestamp: string; level: string }>;
};

type RTCSignalPayload =
  | {
      kind: "offer" | "answer";
      sdp: RTCSessionDescriptionInit;
    }
  | {
      kind: "ice_candidate";
      candidate: RTCIceCandidateInit;
    }
  | {
      kind: "reset";
      reason: string;
    };

const electron = (window as Window & { require?: (name: string) => unknown }).require?.("electron") as
  | { ipcRenderer?: { invoke: (...args: unknown[]) => Promise<unknown>; on: (...args: unknown[]) => void; send: (...args: unknown[]) => void } }
  | undefined;
const ipcRenderer = electron?.ipcRenderer;
const sessionCodeEl = document.querySelector<HTMLElement>("#sessionCode");
const hostAddressEl = document.querySelector<HTMLElement>("#hostAddress");
const captureStatusEl = document.querySelector<HTMLElement>("#captureStatus");
const audioDeviceEl = document.querySelector<HTMLElement>("#audioDevice");
const viewerStatusEl = document.querySelector<HTMLElement>("#viewerStatus");
const messageEl = document.querySelector<HTMLElement>("#message");
const logListEl = document.querySelector<HTMLElement>("#logList");
const startCaptureButton = document.querySelector<HTMLButtonElement>("#startCaptureButton");

let peerConnection: RTCPeerConnection | null = null;
let captureStream: MediaStream | null = null;

function render(state: HostSnapshot): void {
  if (!sessionCodeEl || !hostAddressEl || !captureStatusEl || !audioDeviceEl || !viewerStatusEl || !messageEl || !logListEl) {
    return;
  }

  sessionCodeEl.textContent = state.sessionCode;
  hostAddressEl.textContent = `Host: ${state.hostAddress}:${state.port}`;
  captureStatusEl.textContent = state.captureStatus;
  audioDeviceEl.textContent = `Audio: ${state.audioDeviceName ?? "BlackHole not detected"}`;
  viewerStatusEl.textContent = state.activeClientId ? "Paired" : "Waiting";
  messageEl.textContent = state.message ?? "";
  logListEl.innerHTML = state.logs
    .map((log) => `<div class="log-item"><strong>${log.level.toUpperCase()}</strong> ${log.message}</div>`)
    .join("");
}

async function ensureCapture(): Promise<MediaStream> {
  if (!ipcRenderer) {
    throw new Error("CTRLX host IPC is unavailable.");
  }

  if (captureStream) {
    return captureStream;
  }

  ipcRenderer.send("host:set-media-state", {
    captureStatus: "requesting-permissions",
    message: "Requesting screen recording and audio capture permissions."
  });

  const displayStream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      frameRate: {
        ideal: 30,
        max: 30
      }
    },
    audio: false
  });

  const devices = await navigator.mediaDevices.enumerateDevices();
  const blackHole = devices.find(
    (device) => device.kind === "audioinput" && device.label.toLowerCase().includes("blackhole")
  );

  let audioTracks: MediaStreamTrack[] = [];
  if (blackHole) {
    const audioStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: {
          exact: blackHole.deviceId
        },
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false
      }
    });

    audioTracks = audioStream.getAudioTracks();
    ipcRenderer.send("host:set-media-state", {
      audioDeviceName: blackHole.label || "BlackHole",
      message: "BlackHole audio attached."
    });
  } else {
    ipcRenderer.send("host:log", { level: "warn", message: "BlackHole audio input not found. Video will still stream." });
    ipcRenderer.send("host:set-media-state", {
      audioDeviceName: null,
      message: "BlackHole device not found. Streaming display without remote audio."
    });
  }

  captureStream = new MediaStream([
    ...displayStream.getVideoTracks(),
    ...audioTracks
  ]);

  captureStream.getVideoTracks()[0]?.addEventListener("ended", () => {
    ipcRenderer.send("host:log", { level: "warn", message: "Screen capture stopped on the host." });
    captureStream = null;
    teardownPeer("Host capture ended.");
    ipcRenderer.send("host:set-media-state", {
      captureStatus: "idle",
      message: "Screen capture stopped."
    });
  });

  ipcRenderer.send("host:set-media-state", {
    captureStatus: "capturing",
    message: "Display capture ready."
  });

  return captureStream;
}

async function startPeerSession(): Promise<void> {
  if (!ipcRenderer) {
    return;
  }

  teardownPeer();

  const stream = await ensureCapture();
  peerConnection = new RTCPeerConnection();

  stream.getTracks().forEach((track) => {
    peerConnection?.addTrack(track, stream);
  });

  peerConnection.onicecandidate = (event) => {
    if (!event.candidate) {
      return;
    }

    ipcRenderer.send("host:send-signal", {
      kind: "ice_candidate",
      candidate: event.candidate.toJSON()
    });
  };

  peerConnection.onconnectionstatechange = () => {
    const state = peerConnection?.connectionState ?? "new";
    ipcRenderer.send("host:log", { level: "info", message: `Peer state ${state}` });
    if (state === "connected") {
      ipcRenderer.send("host:set-media-state", {
        captureStatus: "streaming",
        message: "Viewer connected to live stream."
      });
    }
  };

  const offer = await peerConnection.createOffer({
    offerToReceiveAudio: false,
    offerToReceiveVideo: false
  });
  await peerConnection.setLocalDescription(offer);

  ipcRenderer.send("host:send-signal", {
    kind: "offer",
    sdp: offer
  });
}

function teardownPeer(reason?: string): void {
  if (peerConnection) {
    peerConnection.onicecandidate = null;
    peerConnection.onconnectionstatechange = null;
    peerConnection.close();
    peerConnection = null;
  }

  if (reason && ipcRenderer) {
    ipcRenderer.send("host:log", { level: "warn", message: reason });
  }
}

if (ipcRenderer) {
  ipcRenderer.invoke("host:get-snapshot").then((state) => render(state as HostSnapshot));
  ipcRenderer.on("host:state", (_event: unknown, state: HostSnapshot) => render(state));
  ipcRenderer.on("host:client-status", async (_event: unknown, { activeClientId }: { activeClientId: string | null }) => {
    if (!activeClientId) {
      teardownPeer("Viewer disconnected.");
      ipcRenderer.send("host:set-media-state", {
        captureStatus: "idle",
        message: "Waiting for a paired viewer."
      });
    }
  });

  ipcRenderer.on("host:signal", async (_event: unknown, payload: RTCSignalPayload) => {
    try {
      if (!peerConnection) {
        return;
      }

      if (payload.kind === "answer") {
        await peerConnection.setRemoteDescription(payload.sdp);
        return;
      }

      if (payload.kind === "ice_candidate") {
        await peerConnection.addIceCandidate(payload.candidate);
        return;
      }

      if (payload.kind === "reset") {
        teardownPeer(payload.reason);
        ipcRenderer.send("host:set-media-state", {
          captureStatus: "capturing",
          message: payload.reason
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to process remote signal.";
      ipcRenderer.send("host:log", { level: "error", message });
      ipcRenderer.send("host:set-media-state", {
        captureStatus: "error",
        message
      });
    }
  });

  startCaptureButton?.addEventListener("click", async () => {
    const currentState = await ipcRenderer.invoke("host:get-snapshot") as HostSnapshot;
    if (!currentState.activeClientId) {
      ipcRenderer.send("host:log", { level: "warn", message: "Start Capture clicked before a viewer was fully paired." });
      ipcRenderer.send("host:set-media-state", {
        captureStatus: "idle",
        message: "Pair the viewer first, then click Start Capture again."
      });
      return;
    }

    try {
      await startPeerSession();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to start host stream.";
      ipcRenderer.send("host:log", { level: "error", message });
      ipcRenderer.send("host:set-media-state", {
        captureStatus: "error",
        message
      });
    }
  });
}
