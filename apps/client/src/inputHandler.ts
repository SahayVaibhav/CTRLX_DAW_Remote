export type ViewerInputAction =
  | "tap"
  | "double_tap"
  | "pointer_down"
  | "pointer_move"
  | "pointer_up"
  | "gesture_pan"
  | "gesture_zoom"
  | "gesture_region_move";

export type ViewerGesturePhase = "start" | "move" | "end";
export type ViewerZoomAxis = "horizontal" | "vertical";

export type ViewerInputPayload = {
  action: ViewerInputAction;
  xNorm: number;
  yNorm: number;
  viewerWidth: number;
  viewerHeight: number;
  timestamp: number;
  pointerType: "touch" | "mouse" | "pen";
  gesturePhase?: ViewerGesturePhase;
  zoomAxis?: ViewerZoomAxis;
  deltaX?: number;
  deltaY?: number;
  zoomDelta?: number;
};

export type ViewerDragPhase = "pointer_down" | "pointer_move" | "pointer_up";

type PointerLike = {
  clientX: number;
  clientY: number;
};

type TouchPointLike = PointerLike & {
  identifier: number;
};

type ActivePointerGesture = {
  pointerId: number;
  pointerType: "touch" | "mouse" | "pen";
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  layout: DisplayedMediaLayout | null;
};

type PendingTapGesture = {
  clientX: number;
  clientY: number;
  pointerType: "touch" | "mouse" | "pen";
  timer: number;
};

type ActiveTouchGesture = {
  identifier: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  layout: DisplayedMediaLayout | null;
};

export type NormalizedStreamCoordinates = {
  xNorm: number;
  yNorm: number;
};

export type DisplayedMediaLayout = {
  containerRect: DOMRect;
  mediaRect: DOMRect;
};

type DisplayedMediaLayoutCacheEntry = {
  measuredAt: number;
  videoWidth: number;
  videoHeight: number;
  boundsLeft: number;
  boundsTop: number;
  boundsWidth: number;
  boundsHeight: number;
  layout: DisplayedMediaLayout;
};

const DISPLAYED_MEDIA_LAYOUT_CACHE_TTL_MS = 34;
const displayedMediaLayoutCache = new WeakMap<HTMLVideoElement, DisplayedMediaLayoutCacheEntry>();
const DEBUG_MAPPING =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugMapping") === "1";
const DEBUG_GESTURES =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  window.localStorage.getItem("ctrlx.debugGestures") === "1";

function clampNormalized(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function serializeRect(rect: DOMRect) {
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function logMappedPoint(
  layout: DisplayedMediaLayout,
  point: PointerLike,
  normalized: NormalizedStreamCoordinates,
  options?: {
    fullscreenActive?: boolean;
  }
): void {
  if (!DEBUG_MAPPING) {
    return;
  }

  console.debug("[CTRLX mapping]", {
    fullscreenActive: Boolean(options?.fullscreenActive),
    containerRect: serializeRect(layout.containerRect),
    displayedMediaRect: serializeRect(layout.mediaRect),
    localTouchPoint: {
      x: Number((point.clientX - layout.containerRect.left).toFixed(2)),
      y: Number((point.clientY - layout.containerRect.top).toFixed(2))
    },
    normalizedPoint: {
      xNorm: Number(normalized.xNorm.toFixed(4)),
      yNorm: Number(normalized.yNorm.toFixed(4))
    }
  });
}

function logGestureDebug(event: string, data?: Record<string, unknown>): void {
  if (!DEBUG_GESTURES) {
    return;
  }

  console.debug(`[CTRLX gesture] ${event}`, data ?? {});
}

function mapPointWithLayout(
  layout: DisplayedMediaLayout,
  point: PointerLike,
  options?: {
    fullscreenActive?: boolean;
  }
): (NormalizedStreamCoordinates & DisplayedMediaLayout) | null {
  const { containerRect, mediaRect } = layout;
  const withinX = point.clientX >= mediaRect.left && point.clientX <= mediaRect.right;
  const withinY = point.clientY >= mediaRect.top && point.clientY <= mediaRect.bottom;

  if (!withinX || !withinY) {
    if (DEBUG_MAPPING) {
      console.debug("[CTRLX mapping]", {
        fullscreenActive: Boolean(options?.fullscreenActive),
        ignored: true,
        containerRect: serializeRect(containerRect),
        displayedMediaRect: serializeRect(mediaRect),
        localTouchPoint: {
          x: Number((point.clientX - containerRect.left).toFixed(2)),
          y: Number((point.clientY - containerRect.top).toFixed(2))
        }
      });
    }

    return null;
  }

  const normalized = {
    xNorm: clampNormalized((point.clientX - mediaRect.left) / mediaRect.width),
    yNorm: clampNormalized((point.clientY - mediaRect.top) / mediaRect.height)
  };

  logMappedPoint(layout, point, normalized, options);

  return {
    ...normalized,
    containerRect,
    mediaRect
  };
}

// Returns both the outer media element rect and the actual visible stream rect
// inside it when the video is rendered with `object-contain`. This excludes
// letterboxing and pillarboxing space while keeping layout unchanged.
export function getDisplayedMediaRect(video: HTMLVideoElement): DisplayedMediaLayout | null {
  const bounds = video.getBoundingClientRect();
  const intrinsicWidth = video.videoWidth;
  const intrinsicHeight = video.videoHeight;

  if (!intrinsicWidth || !intrinsicHeight || !bounds.width || !bounds.height) {
    return null;
  }

  const now = performance.now();
  const cached = displayedMediaLayoutCache.get(video);
  if (
    cached &&
    now - cached.measuredAt <= DISPLAYED_MEDIA_LAYOUT_CACHE_TTL_MS &&
    cached.videoWidth === intrinsicWidth &&
    cached.videoHeight === intrinsicHeight &&
    cached.boundsLeft === bounds.left &&
    cached.boundsTop === bounds.top &&
    cached.boundsWidth === bounds.width &&
    cached.boundsHeight === bounds.height
  ) {
    return cached.layout;
  }

  const videoAspect = intrinsicWidth / intrinsicHeight;
  const containerAspect = bounds.width / bounds.height;

  if (videoAspect > containerAspect) {
    const renderedHeight = bounds.width / videoAspect;
    const offsetY = (bounds.height - renderedHeight) / 2;
    const layout = {
      containerRect: bounds,
      mediaRect: new DOMRect(bounds.left, bounds.top + offsetY, bounds.width, renderedHeight)
    };
    displayedMediaLayoutCache.set(video, {
      measuredAt: now,
      videoWidth: intrinsicWidth,
      videoHeight: intrinsicHeight,
      boundsLeft: bounds.left,
      boundsTop: bounds.top,
      boundsWidth: bounds.width,
      boundsHeight: bounds.height,
      layout
    });
    return layout;
  }

  const renderedWidth = bounds.height * videoAspect;
  const offsetX = (bounds.width - renderedWidth) / 2;
  const layout = {
    containerRect: bounds,
    mediaRect: new DOMRect(bounds.left + offsetX, bounds.top, renderedWidth, bounds.height)
  };
  displayedMediaLayoutCache.set(video, {
    measuredAt: now,
    videoWidth: intrinsicWidth,
    videoHeight: intrinsicHeight,
    boundsLeft: bounds.left,
    boundsTop: bounds.top,
    boundsWidth: bounds.width,
    boundsHeight: bounds.height,
    layout
  });
  return layout;
}

// Maps a viewer point to normalized coordinates relative to the visible stream
// area only. Touches in black bars or padded regions are ignored.
export function mapViewerPointToNormalizedCoordinates(
  video: HTMLVideoElement,
  point: PointerLike,
  options?: {
    fullscreenActive?: boolean;
  }
): (NormalizedStreamCoordinates & DisplayedMediaLayout) | null {
  const layout = getDisplayedMediaRect(video);
  if (!layout) {
    return null;
  }
  return mapPointWithLayout(layout, point, options);
}

function normalizePointerType(pointerType: string | undefined): "touch" | "mouse" | "pen" {
  if (pointerType === "touch" || pointerType === "mouse" || pointerType === "pen") {
    return pointerType;
  }

  return "mouse";
}

export class ViewerInputHandler {
  // Control input layer:
  // This class translates browser interactions into normalized protocol data.
  // It must only output plain JSON-safe values, never DOM events or Touch objects.
  private readonly activePointers = new Map<number, ActivePointerGesture>();
  private activeTouchGesture: ActiveTouchGesture | null = null;
  private pendingTapGesture: PendingTapGesture | null = null;
  private suppressTouchPointerUntil = 0;
  private static readonly DOUBLE_TAP_WINDOW_MS = 260;
  private static readonly DOUBLE_TAP_DISTANCE_PX = 28;
  private static readonly TAP_MOVE_THRESHOLD_PX = 18;
  private static readonly TOUCH_POINTER_SUPPRESSION_MS = 700;

  private createPayload(
    video: HTMLVideoElement,
    action: ViewerInputAction,
    point: PointerLike,
    pointerType: string | undefined,
    options?: {
      fullscreenActive?: boolean;
      layout?: DisplayedMediaLayout | null;
    }
  ): ViewerInputPayload | null {
    const normalizedPoint = options?.layout
      ? mapPointWithLayout(options.layout, point, options)
      : mapViewerPointToNormalizedCoordinates(video, point, options);
    if (!normalizedPoint) {
      return null;
    }

    return {
      action,
      xNorm: normalizedPoint.xNorm,
      yNorm: normalizedPoint.yNorm,
      viewerWidth: Math.round(normalizedPoint.mediaRect.width),
      viewerHeight: Math.round(normalizedPoint.mediaRect.height),
      timestamp: Date.now(),
      pointerType: normalizePointerType(pointerType)
    };
  }

  mapPointerDown(video: HTMLVideoElement, event: PointerEvent, fullscreenActive = false): ViewerInputPayload | null {
    const layout = getDisplayedMediaRect(video);
    this.activePointers.set(event.pointerId, {
      pointerId: event.pointerId,
      pointerType: normalizePointerType(event.pointerType),
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      layout
    });

    return this.createPayload(video, "pointer_down", event, event.pointerType, { fullscreenActive, layout });
  }

  shouldIgnorePointerEvent(event: PointerEvent): boolean {
    return event.pointerType === "touch" && Date.now() < this.suppressTouchPointerUntil;
  }

  mapPointerMove(video: HTMLVideoElement, event: PointerEvent, fullscreenActive = false): ViewerInputPayload | null {
    this.handlePointerMoveEvent(event);
    return this.buildPointerMovePayload(video, event.pointerId, fullscreenActive);
  }

  handlePointerMoveEvent(event: PointerEvent): void {
    const activePointer = this.activePointers.get(event.pointerId);
    if (activePointer) {
      activePointer.lastX = event.clientX;
      activePointer.lastY = event.clientY;

      const deltaX = event.clientX - activePointer.startX;
      const deltaY = event.clientY - activePointer.startY;
      const movement = Math.hypot(deltaX, deltaY);
      if (movement > ViewerInputHandler.TAP_MOVE_THRESHOLD_PX) {
        activePointer.moved = true;
      }
    }
  }

  buildPointerMovePayload(
    video: HTMLVideoElement,
    pointerId: number,
    fullscreenActive = false
  ): ViewerInputPayload | null {
    const activePointer = this.activePointers.get(pointerId);
    if (!activePointer) {
      return null;
    }

    return this.createPayload(
      video,
      "pointer_move",
      {
        clientX: activePointer.lastX,
        clientY: activePointer.lastY
      },
      activePointer.pointerType,
      {
      fullscreenActive,
        layout: activePointer.layout
      }
    );
  }

  mapPointerUp(video: HTMLVideoElement, event: PointerEvent, fullscreenActive = false): ViewerInputPayload | null {
    const activePointer = this.activePointers.get(event.pointerId);
    this.activePointers.delete(event.pointerId);
    return this.createPayload(video, "pointer_up", event, event.pointerType, {
      fullscreenActive,
      layout: activePointer?.layout ?? null
    });
  }

  handlePointerTapGesture(
    video: HTMLVideoElement,
    event: PointerEvent,
    emit: (payload: ViewerInputPayload) => void,
    fullscreenActive = false
  ): void {
    const activePointer = this.activePointers.get(event.pointerId);
    if (!activePointer) {
      return;
    }

    if (activePointer.moved) {
      return;
    }

    const tapPayload = this.createPayload(video, "tap", event, event.pointerType, {
      fullscreenActive,
      layout: activePointer.layout
    });
    if (!tapPayload) {
      return;
    }

    const pendingTap = this.pendingTapGesture;
    if (
      pendingTap &&
      pendingTap.pointerType === tapPayload.pointerType &&
      Math.hypot(event.clientX - pendingTap.clientX, event.clientY - pendingTap.clientY) <= ViewerInputHandler.DOUBLE_TAP_DISTANCE_PX
    ) {
      clearTimeout(pendingTap.timer);
      this.pendingTapGesture = null;
      emit({
        ...tapPayload,
        action: "double_tap",
        timestamp: Date.now()
      });
      logGestureDebug("double_tap_detected", {
        pointerType: tapPayload.pointerType,
        windowMs: ViewerInputHandler.DOUBLE_TAP_WINDOW_MS,
        distancePx: Number(
          Math.hypot(event.clientX - pendingTap.clientX, event.clientY - pendingTap.clientY).toFixed(2)
        ),
        activeTouches: 1
      });
      return;
    }

    logGestureDebug("single_tap_pending", {
      pointerType: tapPayload.pointerType,
      windowMs: ViewerInputHandler.DOUBLE_TAP_WINDOW_MS,
      maxDistancePx: ViewerInputHandler.DOUBLE_TAP_DISTANCE_PX,
      activeTouches: 1
    });
    const timer = window.setTimeout(() => {
      emit(tapPayload);
      logGestureDebug("single_tap_emitted", {
        pointerType: tapPayload.pointerType
      });

      if (this.pendingTapGesture?.timer === timer) {
        this.pendingTapGesture = null;
      }
    }, ViewerInputHandler.DOUBLE_TAP_WINDOW_MS);

    this.pendingTapGesture = {
      clientX: event.clientX,
      clientY: event.clientY,
      pointerType: tapPayload.pointerType,
      timer
    };
  }

  clearPointerGesture(pointerId: number): void {
    this.activePointers.delete(pointerId);
  }

  clearPendingTapGesture(pointerType?: "touch" | "mouse" | "pen"): void {
    const pendingTap = this.pendingTapGesture;
    if (!pendingTap) {
      return;
    }

    if (pointerType && pendingTap.pointerType !== pointerType) {
      return;
    }

    clearTimeout(pendingTap.timer);
    logGestureDebug("pending_tap_cancelled", {
      pointerType: pendingTap.pointerType,
      reason: "gesture_conflict"
    });
    this.pendingTapGesture = null;
  }

  handleTouchStart(touch: TouchPointLike): void {
    this.suppressTouchPointerUntil = Date.now() + ViewerInputHandler.TOUCH_POINTER_SUPPRESSION_MS;
    this.activeTouchGesture = {
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      moved: false,
      layout: null
    };
  }

  primeTouchLayout(video: HTMLVideoElement): void {
    if (!this.activeTouchGesture) {
      return;
    }

    this.activeTouchGesture.layout = getDisplayedMediaRect(video);
  }

  handleTouchMove(touch: TouchPointLike): void {
    if (!this.activeTouchGesture || this.activeTouchGesture.identifier !== touch.identifier) {
      return;
    }

    this.activeTouchGesture.lastX = touch.clientX;
    this.activeTouchGesture.lastY = touch.clientY;
    const movement = Math.hypot(
      touch.clientX - this.activeTouchGesture.startX,
      touch.clientY - this.activeTouchGesture.startY
    );

    if (movement > ViewerInputHandler.TAP_MOVE_THRESHOLD_PX) {
      this.activeTouchGesture.moved = true;
    }
  }

  buildTouchMovePayload(
    video: HTMLVideoElement,
    identifier: number,
    fullscreenActive = false
  ): ViewerInputPayload | null {
    if (!this.activeTouchGesture || this.activeTouchGesture.identifier !== identifier) {
      return null;
    }

    return this.createPayload(
      video,
      "pointer_move",
      {
        clientX: this.activeTouchGesture.lastX,
        clientY: this.activeTouchGesture.lastY
      },
      "touch",
      {
        fullscreenActive,
        layout: this.activeTouchGesture.layout
      }
    );
  }

  handleTouchEnd(
    video: HTMLVideoElement,
    touch: TouchPointLike,
    emit: (payload: ViewerInputPayload) => void,
    fullscreenActive = false
  ): void {
    this.suppressTouchPointerUntil = Date.now() + ViewerInputHandler.TOUCH_POINTER_SUPPRESSION_MS;

    if (!this.activeTouchGesture || this.activeTouchGesture.identifier !== touch.identifier) {
      return;
    }

    const wasMoved = this.activeTouchGesture.moved;
    const layout = this.activeTouchGesture.layout;
    this.activeTouchGesture = null;

    if (wasMoved) {
      return;
    }

    const tapPayload = this.createPayload(video, "tap", touch, "touch", { fullscreenActive, layout });
    if (!tapPayload) {
      return;
    }

    const pendingTap = this.pendingTapGesture;
    if (
      pendingTap &&
      pendingTap.pointerType === "touch" &&
      Math.hypot(touch.clientX - pendingTap.clientX, touch.clientY - pendingTap.clientY) <= ViewerInputHandler.DOUBLE_TAP_DISTANCE_PX
    ) {
      clearTimeout(pendingTap.timer);
      this.pendingTapGesture = null;
      emit({
        ...tapPayload,
        action: "double_tap",
        timestamp: Date.now()
      });
      logGestureDebug("double_tap_detected", {
        pointerType: "touch",
        windowMs: ViewerInputHandler.DOUBLE_TAP_WINDOW_MS,
        distancePx: Number(
          Math.hypot(touch.clientX - pendingTap.clientX, touch.clientY - pendingTap.clientY).toFixed(2)
        ),
        activeTouches: 1
      });
      return;
    }

    logGestureDebug("single_tap_pending", {
      pointerType: "touch",
      windowMs: ViewerInputHandler.DOUBLE_TAP_WINDOW_MS,
      maxDistancePx: ViewerInputHandler.DOUBLE_TAP_DISTANCE_PX,
      activeTouches: 1
    });
    const timer = window.setTimeout(() => {
      emit(tapPayload);
      logGestureDebug("single_tap_emitted", {
        pointerType: "touch"
      });

      if (this.pendingTapGesture?.timer === timer) {
        this.pendingTapGesture = null;
      }
    }, ViewerInputHandler.DOUBLE_TAP_WINDOW_MS);

    this.pendingTapGesture = {
      clientX: touch.clientX,
      clientY: touch.clientY,
      pointerType: "touch",
      timer
    };
  }

  cancelTouchGesture(identifier?: number): void {
    if (identifier === undefined) {
      this.activeTouchGesture = null;
      return;
    }

    if (this.activeTouchGesture?.identifier === identifier) {
      this.activeTouchGesture = null;
    }
  }

  mapPointerDragPhase(
    video: HTMLVideoElement,
    event: PointerEvent,
    phase: ViewerDragPhase,
    fullscreenActive = false
  ): ViewerInputPayload | null {
    if (phase === "pointer_down") {
      return this.mapPointerDown(video, event, fullscreenActive);
    }

    if (phase === "pointer_move") {
      return this.mapPointerMove(video, event, fullscreenActive);
    }

    return this.mapPointerUp(video, event, fullscreenActive);
  }

  mapTouchPointerPhase(
    video: HTMLVideoElement,
    touch: TouchPointLike,
    phase: ViewerDragPhase,
    fullscreenActive = false
  ): ViewerInputPayload | null {
    return this.createPayload(video, phase, touch, "touch", {
      fullscreenActive,
      layout: this.activeTouchGesture?.identifier === touch.identifier ? this.activeTouchGesture.layout : null
    });
  }

  getDebugState(): {
    pointerModeActive: boolean;
    touchModeActive: boolean;
    mediaRectCached: boolean;
  } {
    const pointerModeActive = this.activePointers.size > 0;
    const touchModeActive = Boolean(this.activeTouchGesture);
    const mediaRectCached =
      Array.from(this.activePointers.values()).some((gesture) => Boolean(gesture.layout)) ||
      Boolean(this.activeTouchGesture?.layout);

    return {
      pointerModeActive,
      touchModeActive,
      mediaRectCached
    };
  }
}
