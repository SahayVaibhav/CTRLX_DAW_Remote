import type { RegisteredMacro } from "./types.js";

export const macroRegistry: Record<string, RegisteredMacro> = {
  "session.quick_export": {
    id: "session.quick_export",
    name: "Quick Export",
    steps: [
      {
        commandId: "session.save"
      },
      {
        commandId: "session.bounce",
        delayMs: 350
      }
    ]
  }
};

export function getRegisteredMacro(macroId: string): RegisteredMacro | null {
  return macroRegistry[macroId] ?? null;
}
