import { spawn, type ChildProcess } from "child_process";
import { logger } from "./logger";

export type StreamState = "idle" | "connecting" | "live" | "stopping" | "error" | "reconnecting";

interface StreamStats {
  state: StreamState;
  fps: number | null;
  bitrate: number | null;
  droppedFrames: number | null;
  totalFrames: number | null;
  uptimeSeconds: number | null;
  cpuUsage: number | null;
  memoryMb: number | null;
  networkKbps: number | null;
  errorMessage: string | null;
}

class StreamManager {
  private process: ChildProcess | null = null;
  private stats: StreamStats = {
    state: "idle",
    fps: null,
    bitrate: null,
    droppedFrames: null,
    totalFrames: null,
    uptimeSeconds: null,
    cpuUsage: null,
    memoryMb: null,
    networkKbps: null,
    errorMessage: null,
  };
  private startTime: number | null = null;
  private frameCount = 0;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(stats: StreamStats) => void> = new Set();

  getStats(): StreamStats {
    return { ...this.stats };
  }

  subscribe(fn: (stats: StreamStats) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.stats);
  }

  async start(rtmpUrl: string, streamKey: string): Promise<void> {
    if (this.process) {
      throw new Error("Stream already running");
    }

    this.stats = {
      ...this.stats,
      state: "connecting",
      errorMessage: null,
      droppedFrames: 0,
      totalFrames: 0,
    };
    this.emit();

    const target = `${rtmpUrl}${streamKey}`;
    logger.info({ target: rtmpUrl }, "Starting stream");

    // Use ffmpeg to create a test stream (in production this would read from the canvas)
    // For demonstration we generate a test pattern + tone
    const args = [
      "-re",
      "-f", "lavfi",
      "-i", "testsrc2=size=1280x720:rate=30",
      "-f", "lavfi",
      "-i", "sine=frequency=440:sample_rate=44100",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-b:v", "4000k",
      "-maxrate", "4500k",
      "-bufsize", "8000k",
      "-pix_fmt", "yuv420p",
      "-g", "60",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "44100",
      "-f", "flv",
      target,
    ];

    try {
      this.process = spawn("ffmpeg", args);
      this.startTime = Date.now();

      this.process.stderr?.on("data", (data: Buffer) => {
        const line = data.toString();
        this.parseFFmpegStats(line);
      });

      this.process.on("close", (code) => {
        if (this.stats.state !== "stopping") {
          this.stats.state = "error";
          this.stats.errorMessage = `FFmpeg exited with code ${code}`;
          logger.error({ code }, "FFmpeg process exited unexpectedly");
        } else {
          this.stats.state = "idle";
        }
        this.cleanup();
        this.emit();
      });

      this.process.on("error", (err) => {
        this.stats.state = "error";
        this.stats.errorMessage = err.message;
        logger.error({ err }, "FFmpeg process error");
        this.cleanup();
        this.emit();
      });

      // Transition to live after a short delay
      setTimeout(() => {
        if (this.stats.state === "connecting") {
          this.stats.state = "live";
          this.emit();
        }
      }, 2000);

      // Start stats interval
      this.statsInterval = setInterval(() => {
        if (this.startTime) {
          this.stats.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        }
        const mem = process.memoryUsage();
        this.stats.memoryMb = Math.round(mem.rss / 1024 / 1024);
        this.emit();
      }, 1000);
    } catch (err: any) {
      this.stats.state = "error";
      this.stats.errorMessage = err.message || "Failed to start FFmpeg";
      this.emit();
    }
  }

  private parseFFmpegStats(line: string) {
    // Parse fps from ffmpeg stderr output like "frame= 123 fps= 30 q=28.0 size=  1024kB time=00:00:04.10 bitrate=2048.0kbits/s"
    const fpsMatch = line.match(/fps=\s*(\d+(?:\.\d+)?)/);
    if (fpsMatch) {
      this.stats.fps = parseFloat(fpsMatch[1]);
    }

    const bitrateMatch = line.match(/bitrate=\s*(\d+(?:\.\d+)?)kbits\/s/);
    if (bitrateMatch) {
      this.stats.bitrate = parseFloat(bitrateMatch[1]);
      this.stats.networkKbps = this.stats.bitrate;
    }

    const frameMatch = line.match(/frame=\s*(\d+)/);
    if (frameMatch) {
      this.stats.totalFrames = parseInt(frameMatch[1]);
    }

    const dropMatch = line.match(/drop=\s*(\d+)/);
    if (dropMatch) {
      this.stats.droppedFrames = parseInt(dropMatch[1]);
    }
  }

  stop(): void {
    if (!this.process) return;
    this.stats.state = "stopping";
    this.emit();
    this.process.kill("SIGTERM");
    setTimeout(() => {
      if (this.process) this.process.kill("SIGKILL");
    }, 3000);
  }

  async reconnect(rtmpUrl: string, streamKey: string): Promise<void> {
    this.stats.state = "reconnecting";
    this.emit();
    this.stop();
    await new Promise((r) => setTimeout(r, 2000));
    await this.start(rtmpUrl, streamKey);
  }

  private cleanup() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
    this.process = null;
    this.startTime = null;
  }
}

export const streamManager = new StreamManager();
