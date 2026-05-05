export const CTRLX_PROTOCOL_VERSION = "1.0.0";
export var CtrlxMessageType;
(function (CtrlxMessageType) {
    CtrlxMessageType["Hello"] = "hello";
    CtrlxMessageType["Pair"] = "pair";
    CtrlxMessageType["Paired"] = "paired";
    CtrlxMessageType["Command"] = "command";
    CtrlxMessageType["Result"] = "result";
    CtrlxMessageType["Error"] = "error";
    CtrlxMessageType["Status"] = "status";
    CtrlxMessageType["Ping"] = "ping";
    CtrlxMessageType["Pong"] = "pong";
})(CtrlxMessageType || (CtrlxMessageType = {}));
export var CtrlxCommand;
(function (CtrlxCommand) {
    CtrlxCommand["Ping"] = "ping";
    CtrlxCommand["OpenLogic"] = "open_logic";
    CtrlxCommand["PlayStop"] = "play_stop";
    CtrlxCommand["SaveProject"] = "save_project";
    CtrlxCommand["Undo"] = "undo";
    CtrlxCommand["MuteSelectedTrack"] = "mute_selected_track";
    CtrlxCommand["SoloSelectedTrack"] = "solo_selected_track";
    CtrlxCommand["ArmSelectedTrack"] = "arm_selected_track";
})(CtrlxCommand || (CtrlxCommand = {}));
export function createTimestamp() {
    return new Date().toISOString();
}
export function isCtrlxCommand(value) {
    return typeof value === "string" && Object.values(CtrlxCommand).includes(value);
}
export function isCtrlxMessageType(value) {
    return typeof value === "string" && Object.values(CtrlxMessageType).includes(value);
}
export function isCommandPayload(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value;
    return isCtrlxCommand(candidate.command);
}
export function isCtrlxMessage(value) {
    if (!value || typeof value !== "object") {
        return false;
    }
    const candidate = value;
    if (!isCtrlxMessageType(candidate.type)) {
        return false;
    }
    if (typeof candidate.sentAt !== "string") {
        return false;
    }
    switch (candidate.type) {
        case CtrlxMessageType.Hello:
            return typeof candidate.payload?.protocolVersion === "string";
        case CtrlxMessageType.Pair:
            return typeof candidate.payload?.sessionCode === "string";
        case CtrlxMessageType.Paired:
            return typeof candidate.payload?.hostName === "string";
        case CtrlxMessageType.Command:
            return isCommandPayload(candidate.payload);
        case CtrlxMessageType.Result:
            return candidate.payload?.ok === true;
        case CtrlxMessageType.Error:
            return candidate.payload?.ok === false;
        case CtrlxMessageType.Status:
            return typeof candidate.payload?.connectionState === "string";
        case CtrlxMessageType.Ping:
        case CtrlxMessageType.Pong:
            return typeof candidate.payload?.nonce === "string";
        default:
            return false;
    }
}
