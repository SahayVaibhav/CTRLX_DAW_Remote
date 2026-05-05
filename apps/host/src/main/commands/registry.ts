import { CtrlxCommand, type CommandResultPayload } from "#protocol";
import {
  armSelectedTrack,
  bounceProject,
  createAudioTrack,
  executeImportPlan,
  muteSelectedTrack,
  openSelectedEditor,
  openLogic,
  playStop,
  requestImportSelection,
  renameTrack,
  saveProject,
  setTrackColor,
  soloSelectedTrack,
  undo,
  zoomInHorizontal,
  zoomInVertical,
  zoomOutHorizontal,
  zoomOutVertical
} from "../logic/actions.js";
import { importAudioFilesIntoCurrentProject } from "../logic/importAudioIntoCurrentProject.js";
import type { CommandExecutionContext, RegisteredCommand } from "./types.js";

function pingCommand(context: CommandExecutionContext): Promise<CommandResultPayload> {
  context.logger("Running ping command");

  return Promise.resolve({
    command: CtrlxCommand.Ping,
    ok: true,
    message: "Host ping acknowledged."
  });
}

export const commandRegistry: Record<string, RegisteredCommand> = {
  [CtrlxCommand.Ping]: {
    id: CtrlxCommand.Ping,
    name: "Ping Host",
    category: "system",
    execute: pingCommand
  },
  [CtrlxCommand.OpenLogic]: {
    id: CtrlxCommand.OpenLogic,
    name: "Create Session",
    category: "session",
    execute: openLogic
  },
  [CtrlxCommand.PlayStop]: {
    id: CtrlxCommand.PlayStop,
    name: "Play / Stop",
    category: "transport",
    execute: playStop
  },
  [CtrlxCommand.SaveProject]: {
    id: CtrlxCommand.SaveProject,
    name: "Save Project",
    category: "session",
    execute: saveProject
  },
  [CtrlxCommand.Undo]: {
    id: CtrlxCommand.Undo,
    name: "Undo",
    category: "edit",
    execute: undo
  },
  [CtrlxCommand.CreateAudioTrack]: {
    id: CtrlxCommand.CreateAudioTrack,
    name: "Create Audio Track",
    category: "track",
    inputSchema: {
      type: "object",
      description: "Create one or more Logic audio tracks through the real Create New Track dialog.",
      properties: {
        count: "Optional number of audio tracks to create. Defaults to 1."
      }
    },
    execute: createAudioTrack
  },
  [CtrlxCommand.ImportAudioFilesIntoCurrentProject]: {
    id: CtrlxCommand.ImportAudioFilesIntoCurrentProject,
    name: "Import Audio Files Into Current Project",
    category: "import",
    inputSchema: {
      type: "object",
      description: "Import one or more local audio files into the currently open Logic project.",
      properties: {
        filePaths: "Required array of absolute local file paths to import into the active Logic project."
      }
    },
    execute: importAudioFilesIntoCurrentProject
  },
  [CtrlxCommand.ZoomInHorizontal]: {
    id: CtrlxCommand.ZoomInHorizontal,
    name: "Zoom In Horizontal",
    category: "edit",
    execute: zoomInHorizontal
  },
  [CtrlxCommand.ZoomOutHorizontal]: {
    id: CtrlxCommand.ZoomOutHorizontal,
    name: "Zoom Out Horizontal",
    category: "edit",
    execute: zoomOutHorizontal
  },
  [CtrlxCommand.ZoomInVertical]: {
    id: CtrlxCommand.ZoomInVertical,
    name: "Zoom In Vertical",
    category: "edit",
    execute: zoomInVertical
  },
  [CtrlxCommand.ZoomOutVertical]: {
    id: CtrlxCommand.ZoomOutVertical,
    name: "Zoom Out Vertical",
    category: "edit",
    execute: zoomOutVertical
  },
  [CtrlxCommand.OpenSelectedEditor]: {
    id: CtrlxCommand.OpenSelectedEditor,
    name: "Open Selected Editor",
    category: "edit",
    execute: openSelectedEditor
  },
  [CtrlxCommand.ExecuteImportPlan]: {
    id: CtrlxCommand.ExecuteImportPlan,
    name: "Execute Import Plan",
    category: "import",
    inputSchema: {
      type: "object",
      description: "Execute a reviewed import plan on the host using reusable track commands.",
      properties: {
        plan: "Reviewed import plan. The host validates plan.items and rebuilds executable actions before execution."
      }
    },
    execute: executeImportPlan
  },
  [CtrlxCommand.RequestImportSelection]: {
    id: CtrlxCommand.RequestImportSelection,
    name: "Request Import Selection",
    category: "import",
    inputSchema: {
      type: "object",
      description: "Open the native host file picker so the Mac host can discover local files for import.",
      properties: {
        allowFolders: "Optional boolean. Defaults to true and allows folder selection when supported by the host OS picker."
      }
    },
    execute: requestImportSelection
  },
  [CtrlxCommand.RenameTrack]: {
    id: CtrlxCommand.RenameTrack,
    name: "Rename Selected Track",
    category: "track",
    inputSchema: {
      type: "object",
      description: "Rename the currently selected Logic track.",
      properties: {
        target: "Must be { kind: 'selected' } for the currently selected Logic track.",
        newName: "The desired new track name.",
        previousName: "Optional previous track name for reporting."
      }
    },
    execute: renameTrack
  },
  [CtrlxCommand.SetTrackColor]: {
    id: CtrlxCommand.SetTrackColor,
    name: "Set Selected Track Color",
    category: "track",
    inputSchema: {
      type: "object",
      description: "Assign a normalized planner color to the currently selected Logic track.",
      properties: {
        target: "Must be { kind: 'selected' } for the currently selected Logic track.",
        color: "Normalized planner color such as red, orange, blue, gray, or neutral.",
        previousColor: "Optional previous planner color for reporting."
      }
    },
    execute: setTrackColor
  },
  [CtrlxCommand.MuteSelectedTrack]: {
    id: CtrlxCommand.MuteSelectedTrack,
    name: "Mute Selected Track",
    category: "track",
    execute: muteSelectedTrack
  },
  [CtrlxCommand.SoloSelectedTrack]: {
    id: CtrlxCommand.SoloSelectedTrack,
    name: "Solo Selected Track",
    category: "track",
    execute: soloSelectedTrack
  },
  [CtrlxCommand.ArmSelectedTrack]: {
    id: CtrlxCommand.ArmSelectedTrack,
    name: "Arm Selected Track",
    category: "track",
    execute: armSelectedTrack
  },
  "session.bounce": {
    id: "session.bounce",
    name: "Bounce Project",
    category: "session",
    execute: bounceProject
  }
};

export function getRegisteredCommand(commandId: string): RegisteredCommand | null {
  return commandRegistry[commandId] ?? null;
}
