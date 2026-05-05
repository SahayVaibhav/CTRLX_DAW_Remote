import type { CommandResultPayload } from "#protocol";
import type { CommandExecutionContext, RegisteredMacro } from "./types.js";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function runMacro(
  macro: RegisteredMacro,
  context: CommandExecutionContext
): Promise<CommandResultPayload> {
  const stepResults: Array<Record<string, unknown>> = [];

  for (const step of macro.steps) {
    if (step.delayMs && step.delayMs > 0) {
      await delay(step.delayMs);
    }

    const result = await context.runCommandById(step.commandId, step.input);
    stepResults.push({
      commandId: step.commandId,
      message: result.message
    });
  }

  return {
    command: `macro:${macro.id}`,
    ok: true,
    message: `Macro ${macro.id} completed.`,
    data: {
      macroId: macro.id,
      steps: stepResults
    }
  };
}
