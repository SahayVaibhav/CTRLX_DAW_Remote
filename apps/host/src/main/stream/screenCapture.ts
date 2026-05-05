type CaptureLogger = (message: string) => void;

type DisplayLike = {
  id: number;
  bounds: {
    width: number;
    height: number;
  };
};

type NativeImageLike = {
  toPNG: () => Buffer;
  getSize: () => {
    width: number;
    height: number;
  };
  isEmpty?: () => boolean;
};

type DesktopCapturerSource = {
  id: string;
  display_id?: string;
  name: string;
  thumbnail: NativeImageLike;
};

type DesktopCapturerLike = {
  getSources: (options: {
    types: Array<"screen" | "window">;
    thumbnailSize: {
      width: number;
      height: number;
    };
    fetchWindowIcons?: boolean;
  }) => Promise<DesktopCapturerSource[]>;
};

type ScreenLike = {
  getPrimaryDisplay: () => DisplayLike;
};

export type ScreenFrame = {
  mimeType: "image/png";
  width: number;
  height: number;
  capturedAt: string;
  byteLength: number;
  data: Buffer;
  sourceId: string;
};

type ScreenCaptureOptions = {
  desktopCapturer: DesktopCapturerLike;
  screen: ScreenLike;
  logger: CaptureLogger;
  maxWidth?: number;
};

type CaptureState = "idle" | "capturing";

export class ScreenCapture {
  private readonly desktopCapturer: DesktopCapturerLike;
  private readonly screen: ScreenLike;
  private readonly logger: CaptureLogger;
  private readonly maxWidth: number;

  private state: CaptureState = "idle";
  private sourceId: string | null = null;
  private displayId: string | null = null;

  constructor(options: ScreenCaptureOptions) {
    this.desktopCapturer = options.desktopCapturer;
    this.screen = options.screen;
    this.logger = options.logger;
    this.maxWidth = options.maxWidth ?? 1600;
  }

  async startCapture(): Promise<void> {
    if (this.state === "capturing" && this.sourceId) {
      this.logger(`Screen capture already active on source ${this.sourceId}.`);
      return;
    }

    const primaryDisplay = this.screen.getPrimaryDisplay();
    this.displayId = String(primaryDisplay.id);

    const source = await this.findPrimarySource();
    if (!source) {
      this.sourceId = null;
      this.state = "idle";
      throw new Error("Unable to find a capturable primary screen source.");
    }

    this.sourceId = source.id;
    this.state = "capturing";
    this.logger(`Screen capture started for ${source.name} (${source.id}).`);
  }

  stopCapture(): void {
    if (this.state === "idle") {
      this.logger("Screen capture already stopped.");
      return;
    }

    this.logger(`Screen capture stopped for ${this.sourceId ?? "unknown source"}.`);
    this.state = "idle";
    this.sourceId = null;
    this.displayId = null;
  }

  async getFrame(): Promise<ScreenFrame | null> {
    if (this.state !== "capturing" || !this.sourceId) {
      this.logger("Screen capture frame requested while capture is inactive.");
      return null;
    }

    const thumbnailSize = this.getThumbnailSize();
    const sources = await this.desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize,
      fetchWindowIcons: false
    });

    const source = sources.find((candidate) => candidate.id === this.sourceId);
    if (!source) {
      this.logger("Active screen source disappeared. Stopping capture.");
      this.stopCapture();
      return null;
    }

    if (typeof source.thumbnail.isEmpty === "function" && source.thumbnail.isEmpty()) {
      this.logger("Screen capture returned an empty frame.");
      return null;
    }

    const png = source.thumbnail.toPNG();
    const { width, height } = source.thumbnail.getSize();

    return {
      mimeType: "image/png",
      width,
      height,
      capturedAt: new Date().toISOString(),
      byteLength: png.byteLength,
      data: png,
      sourceId: source.id
    };
  }

  private async findPrimarySource(): Promise<DesktopCapturerSource | null> {
    const sources = await this.desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: this.getThumbnailSize(),
      fetchWindowIcons: false
    });

    return (
      sources.find((candidate) => candidate.display_id === this.displayId) ??
      sources[0] ??
      null
    );
  }

  private getThumbnailSize(): { width: number; height: number } {
    const primaryDisplay = this.screen.getPrimaryDisplay();
    const displayWidth = primaryDisplay.bounds.width;
    const displayHeight = primaryDisplay.bounds.height;

    if (displayWidth <= this.maxWidth) {
      return {
        width: displayWidth,
        height: displayHeight
      };
    }

    const scale = this.maxWidth / displayWidth;
    return {
      width: Math.round(displayWidth * scale),
      height: Math.round(displayHeight * scale)
    };
  }
}
