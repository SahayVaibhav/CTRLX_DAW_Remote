export const DEFAULT_WS_PORT = 4545;
export function isSignalPayload(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value;
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
export function isRemoteInputEvent(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value;
    switch (candidate.kind) {
        case "mouse_move":
            return typeof candidate.x === "number" && typeof candidate.y === "number";
        case "mouse_button":
            return (typeof candidate.x === "number" &&
                typeof candidate.y === "number" &&
                (candidate.action === "down" || candidate.action === "up" || candidate.action === "click") &&
                (candidate.button === "left" || candidate.button === "middle" || candidate.button === "right"));
        case "wheel":
            return (typeof candidate.x === "number" &&
                typeof candidate.y === "number" &&
                typeof candidate.deltaX === "number" &&
                typeof candidate.deltaY === "number");
        case "key_press":
            return (typeof candidate.key === "string" &&
                typeof candidate.code === "string" &&
                typeof candidate.altKey === "boolean" &&
                typeof candidate.ctrlKey === "boolean" &&
                typeof candidate.metaKey === "boolean" &&
                typeof candidate.shiftKey === "boolean");
        default:
            return false;
    }
}
export function isClientMessage(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value;
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
