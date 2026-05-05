import { CtrlxMessageType, createTimestamp, type CommandMessage, type ErrorMessage, type ResultMessage } from "#protocol";
import { Executor } from "./automation/executor.js";

export class CommandRouter {
  constructor(private readonly executor: Executor) {}

  async route(message: CommandMessage): Promise<ResultMessage | ErrorMessage> {
    const { command: commandId } = message.payload;

    if (!this.executor.hasCommand(commandId)) {
      return {
        type: CtrlxMessageType.Error,
        requestId: message.requestId,
        sessionCode: message.sessionCode,
        sentAt: createTimestamp(),
        payload: {
          ok: false,
          code: "UNKNOWN_COMMAND",
          message: `Command ${commandId} is not registered.`
        }
      };
    }

    try {
      const result = await this.executor.execute(message.payload);
      return {
        type: CtrlxMessageType.Result,
        requestId: message.requestId,
        sessionCode: message.sessionCode,
        sentAt: createTimestamp(),
        payload: result
      };
    } catch (error) {
      return {
        type: CtrlxMessageType.Error,
        requestId: message.requestId,
        sessionCode: message.sessionCode,
        sentAt: createTimestamp(),
        payload: {
          ok: false,
          code: "EXECUTION_FAILED",
          message: error instanceof Error ? error.message : "Command execution failed."
        }
      };
    }
  }
}
