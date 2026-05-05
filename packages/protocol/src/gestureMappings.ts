import type { CtrlxCommand, CtrlxScreenInputAction } from "./index.js";

export type CtrlxGestureBindingId =
  | "one_finger_drag"
  | "double_tap"
  | "pinch_out"
  | "pinch_in"
  | "pinch_out_vertical"
  | "pinch_in_vertical"
  | "two_finger_pan"
  | "two_finger_region_move"
  | "two_finger_tap";

export type CtrlxGestureTargetKind = "screen_input" | "command" | "unassigned";

export type CtrlxGestureBinding = {
  gesture: CtrlxGestureBindingId;
  targetKind: CtrlxGestureTargetKind;
  commandId: CtrlxScreenInputAction | CtrlxCommand | null;
  logicCatalogId: string | null;
  params?: Record<string, string | number | boolean>;
  notes?: string;
};

const ZOOM_IN_HORIZONTAL_COMMAND = "view.zoom_in_horizontal" as CtrlxCommand;
const ZOOM_OUT_HORIZONTAL_COMMAND = "view.zoom_out_horizontal" as CtrlxCommand;
const ZOOM_IN_VERTICAL_COMMAND = "view.zoom_in_vertical" as CtrlxCommand;
const ZOOM_OUT_VERTICAL_COMMAND = "view.zoom_out_vertical" as CtrlxCommand;

export const CTRLX_GESTURE_BINDINGS: readonly CtrlxGestureBinding[] = [
  {
    gesture: "one_finger_drag",
    targetKind: "screen_input",
    commandId: "pointer_move",
    logicCatalogId: null,
    notes: "Preserves the existing cursor movement baseline."
  },
  {
    gesture: "double_tap",
    targetKind: "screen_input",
    commandId: "double_tap",
    logicCatalogId: null,
    notes: "Mapped to real host double click at the viewer coordinates."
  },
  {
    gesture: "pinch_out",
    targetKind: "command",
    commandId: ZOOM_IN_HORIZONTAL_COMMAND,
    logicCatalogId: null,
    params: {
      axis: "horizontal",
      direction: "outward"
    },
    notes: "Horizontal outward pinch triggers the reusable host zoom-in-horizontal command."
  },
  {
    gesture: "pinch_in",
    targetKind: "command",
    commandId: ZOOM_OUT_HORIZONTAL_COMMAND,
    logicCatalogId: null,
    params: {
      axis: "horizontal",
      direction: "inward"
    },
    notes: "Horizontal inward pinch triggers the reusable host zoom-out-horizontal command."
  },
  {
    gesture: "pinch_out_vertical",
    targetKind: "command",
    commandId: ZOOM_IN_VERTICAL_COMMAND,
    logicCatalogId: null,
    params: {
      axis: "vertical",
      direction: "outward"
    },
    notes: "Vertical outward pinch triggers the reusable host zoom-in-vertical command."
  },
  {
    gesture: "pinch_in_vertical",
    targetKind: "command",
    commandId: ZOOM_OUT_VERTICAL_COMMAND,
    logicCatalogId: null,
    params: {
      axis: "vertical",
      direction: "inward"
    },
    notes: "Vertical inward pinch triggers the reusable host zoom-out-vertical command."
  },
  {
    gesture: "two_finger_pan",
    targetKind: "screen_input",
    commandId: "gesture_pan",
    logicCatalogId: null,
    notes: "Two-finger centroid movement pans the Logic view."
  },
  {
    gesture: "two_finger_region_move",
    targetKind: "screen_input",
    commandId: "gesture_region_move",
    logicCatalogId: null,
    params: {
      phases: "start,move,end"
    },
    notes: "Two-finger hold and move emulates click-hold-drag-release on the host."
  },
  {
    gesture: "two_finger_tap",
    targetKind: "unassigned",
    commandId: null,
    logicCatalogId: null,
    notes: "Reserved for a future action once a safe executable target exists."
  }
] as const;

export function getCtrlxGestureBindings(): CtrlxGestureBinding[] {
  return [...CTRLX_GESTURE_BINDINGS];
}
