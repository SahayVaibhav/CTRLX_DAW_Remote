export const DEFAULT_WS_PORT = 4545;

export type RTCSignalPayload =
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

export type MouseMoveInputEvent = {
  kind: "mouse_move";
  x: number;
  y: number;
};

export type MouseMoveRelativeInputEvent = {
  kind: "mouse_move_relative";
  deltaX: number;
  deltaY: number;
};

export type MouseButtonInputEvent = {
  kind: "mouse_button";
  action: "down" | "up" | "click";
  button: "left" | "middle" | "right";
  x: number;
  y: number;
};

export type WheelInputEvent = {
  kind: "wheel";
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
};

export type KeyPressInputEvent = {
  kind: "key_press";
  key: string;
  code: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export type RemoteInputEvent =
  | MouseMoveInputEvent
  | MouseMoveRelativeInputEvent
  | MouseButtonInputEvent
  | WheelInputEvent
  | KeyPressInputEvent;

export type ClientHelloMessage = {
  type: "client_hello";
  sessionCode: string;
  clientName?: string;
};

export type ClientSignalMessage = {
  type: "client_signal";
  payload: RTCSignalPayload;
};

export type ClientInputMessage = {
  type: "client_input";
  event: RemoteInputEvent;
};

export type ServerReadyMessage = {
  type: "server_ready";
  sessionCode: string;
  hostName: string;
  hostAddress: string;
  port: number;
  pairedAt: string;
};

export type ServerSignalMessage = {
  type: "server_signal";
  payload: RTCSignalPayload;
};

export type ServerStateMessage = {
  type: "server_state";
  sessionCode: string;
  hostAddress: string;
  audioDeviceName: string | null;
  captureStatus: "idle" | "requesting-permissions" | "capturing" | "streaming" | "error";
  activeClientId: string | null;
  message?: string;
};

export type ServerLogMessage = {
  type: "server_log";
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
};

export type ServerErrorMessage = {
  type: "server_error";
  code:
    | "INVALID_SESSION"
    | "CLIENT_ALREADY_CONNECTED"
    | "INVALID_MESSAGE"
    | "SIGNAL_FAILED"
    | "INPUT_FAILED";
  message: string;
};

export type ClientMessage = ClientHelloMessage | ClientSignalMessage | ClientInputMessage;

export type ServerMessage =
  | ServerReadyMessage
  | ServerSignalMessage
  | ServerStateMessage
  | ServerLogMessage
  | ServerErrorMessage;

export function isSignalPayload(value: unknown): value is RTCSignalPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RTCSignalPayload>;
  if (candidate.kind === "offer" || candidate.kind === "answer") {
    return !!candidate.sdp && typeof candidate.sdp === "object";
  }

  if (candidate.kind === "ice_candidate") {
    return !!candidate.candidate && typeof candidate.candidate === "object";
  }

  if (candidate.kind === "reset") {
    return typeof candidate.reason === "string";
  }

  return false;
}

export function isRemoteInputEvent(value: unknown): value is RemoteInputEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<RemoteInputEvent>;
  switch (candidate.kind) {
    case "mouse_move":
      return typeof candidate.x === "number" && typeof candidate.y === "number";
    case "mouse_move_relative":
      return typeof candidate.deltaX === "number" && typeof candidate.deltaY === "number";
    case "mouse_button":
      return (
        typeof candidate.x === "number" &&
        typeof candidate.y === "number" &&
        (candidate.action === "down" || candidate.action === "up" || candidate.action === "click") &&
        (candidate.button === "left" || candidate.button === "middle" || candidate.button === "right")
      );
    case "wheel":
      return (
        typeof candidate.x === "number" &&
        typeof candidate.y === "number" &&
        typeof candidate.deltaX === "number" &&
        typeof candidate.deltaY === "number"
      );
    case "key_press":
      return (
        typeof candidate.key === "string" &&
        typeof candidate.code === "string" &&
        typeof candidate.altKey === "boolean" &&
        typeof candidate.ctrlKey === "boolean" &&
        typeof candidate.metaKey === "boolean" &&
        typeof candidate.shiftKey === "boolean"
      );
    default:
      return false;
  }
}

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<ClientMessage>;
  if (candidate.type === "client_hello") {
    return typeof candidate.sessionCode === "string" && candidate.sessionCode.length > 0;
  }

  if (candidate.type === "client_signal") {
    return isSignalPayload(candidate.payload);
  }

  if (candidate.type === "client_input") {
    return isRemoteInputEvent(candidate.event);
  }

  return false;
}
