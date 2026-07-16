import { spawn, type ChildProcess } from "child_process";
import { execSync } from "child_process";
import type { WebSocket } from "ws";
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
    fps: null, bitrate: null, droppedFrames: null, totalFrames: null,
    uptimeSeconds: null, cpuUsage: null, memoryMb: null, networkKbps: null,
    errorMessage: null,
  };
  private startTime: number | null = null;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private cpuInterval: ReturnType<typeof setInterval> | null = null;
  private listeners: Set<(stats: StreamStats) => void> = new Set();

  // Pending config waiting for a stream client to connect
  private pendingConfig: { rtmpUrl: string; streamKey: string } | null = null;

  // Session tracking
  private totalSessions = 0;
  private totalUptimeSeconds = 0;
  private lastStreamAt: string | null = null;
  private sessionFpsSamples: number[] = [];
  private sessionBitrateSamples: number[] = [];

  getStats(): StreamStats { return { ...this.stats }; }

  getSummary() {
    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    return {
      totalSessions: this.totalSessions,
      avgFps: Math.round(avg(this.sessionFpsSamples)),
      avgBitrate: Math.round(avg(this.sessionBitrateSamples)),
      totalUptimeSeconds: this.totalUptimeSeconds,
      lastStreamAt: this.lastStreamAt,
    };
  }

  subscribe(fn: (stats: StreamStats) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() { for (const fn of this.listeners) fn(this.stats); }

  private getCpuUsage(): number {
    try {
      const out = execSync("grep 'cpu ' /proc/stat", { timeout: 500 }).toString().trim();
      const parts = out.split(/\s+/).slice(1).map(Number);
      const total = parts.reduce((a, b) => a + b, 0);
      const idle = parts[3] ?? 0;
      return Math.round(((total - idle) / total) * 1000) / 10;
    } catch { return 0; }
  }

  /**
   * Called when user clicks "Start Stream".
   * Stores config and marks state as "connecting".
   * FFmpeg will be spawned when the browser WebSocket stream client connects.
   */
  async start(rtmpUrl: string, streamKey: string): Promise<void> {
    if (this.process) throw new Error("Stream already running");
    if (!rtmpUrl || !streamKey) throw new Error("RTMP URL and stream key are required");

    this.pendingConfig = { rtmpUrl, streamKey };
    this.stats = {
      ...this.stats, state: "connecting", errorMessage: null,
      droppedFrames: 0, totalFrames: 0, fps: null, bitrate: null,
    };
    this.emit();
    logger.info({ rtmpUrl }, "Stream connecting — waiting for browser canvas stream");
  }

  /**
   * Called by the WebSocket server when a browser connects with role=stream.
   * Spawns FFmpeg reading WebM from stdin and writing RTMP output.
   */
  attachStreamClient(ws: WebSocket): void {
    if (this.stats.state !== "connecting" || !this.pendingConfig) {
      logger.warn("Stream client attached but not in connecting state — ignoring");
      ws.close();
      return;
    }

    const { rtmpUrl, streamKey } = this.pendingConfig;
    this.pendingConfig = null;

    const target = `${rtmpUrl.replace(/\/$/, "")}/${streamKey}`;
    logger.info({ target }, "Stream client connected — spawning FFmpeg with canvas input");

    // FFmpeg reads WebM from stdin (browser canvas via MediaRecorder)
    // Adds a silent audio track since the canvas stream is video-only.
    const args = [
      // Video input: WebM from browser via stdin
      "-re",
      "-f", "webm",
      "-i", "pipe:0",
      // Silent audio (canvas has no audio)
      "-f", "lavfi",
      "-i", "aevalsrc=0.05*sin(0):s=44100",
      // Video encoding
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-tune", "zerolatency",
      "-b:v", "4000k",
      "-maxrate", "4500k",
      "-bufsize", "8000k",
      "-pix_fmt", "yuv420p",
      "-g", "60",
      // Audio encoding
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "44100",
      // Map streams explicitly
      "-map", "0:v:0",
      "-map", "1:a:0",
      // Output
      "-f", "flv",
      target,
    ];

    try {
      this.process = spawn("ffmpeg", args, {
        stdio: ["pipe", "ignore", "pipe"],
      });
      this.startTime = Date.now();
      this.sessionFpsSamples = [];
      this.sessionBitrateSamples = [];

      this.process.stderr?.on("data", (data: Buffer) => {
        this.parseFFmpegStats(data.toString());
      });

      this.process.on("close", (code) => {
        const uptime = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;
        this.totalUptimeSeconds += uptime;
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

      // Pipe incoming WebSocket binary data to FFmpeg stdin
      ws.on("message", (data: Buffer) => {
        if (this.process?.stdin?.writable) {
          this.process.stdin.write(data);
        }
      });

      ws.on("close", () => {
        logger.info("Stream WebSocket client disconnected — stopping FFmpeg");
        this.stop();
      });

      ws.on("error", () => {
        this.stop();
      });

      // Transition to "live" after a short buffer period
      setTimeout(() => {
        if (this.stats.state === "connecting" && this.process) {
          this.stats.state = "live";
          this.totalSessions++;
          this.lastStreamAt = new Date().toISOString();
          this.emit();
        }
      }, 3000);

      // Uptime + memory
      this.statsInterval = setInterval(() => {
        if (this.startTime) this.stats.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        this.stats.memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
        this.emit();
      }, 1000);

      // CPU
      this.cpuInterval = setInterval(() => {
        this.stats.cpuUsage = this.getCpuUsage();
      }, 3000);

    } catch (err: any) {
      this.stats.state = "error";
      this.stats.errorMessage = err.message || "Failed to start FFmpeg";
      this.cleanup();
      this.emit();
    }
  }

  private parseFFmpegStats(line: string) {
    const fpsM = line.match(/fps=\s*(\d+(?:\.\d+)?)/);
    if (fpsM) {
      const fps = parseFloat(fpsM[1]);
      this.stats.fps = fps;
      if (this.stats.state === "live") this.sessionFpsSamples.push(fps);
    }
    const bpsM = line.match(/bitrate=\s*(\d+(?:\.\d+)?)kbits\/s/);
    if (bpsM) {
      const bitrate = parseFloat(bpsM[1]);
      this.stats.bitrate = bitrate;
      this.stats.networkKbps = bitrate;
      if (this.stats.state === "live") this.sessionBitrateSamples.push(bitrate);
    }
    const frameM = line.match(/frame=\s*(\d+)/);
    if (frameM) this.stats.totalFrames = parseInt(frameM[1]);
    const dropM = line.match(/drop=\s*(\d+)/);
    if (dropM) this.stats.droppedFrames = parseInt(dropM[1]);
  }

  stop(): void {
    if (!this.process && this.stats.state === "connecting") {
      // Cancelled before FFmpeg started
      this.pendingConfig = null;
      this.stats.state = "idle";
      this.emit();
      return;
    }
    if (!this.process) return;
    this.stats.state = "stopping";
    this.emit();
    this.process.stdin?.end();
    this.process.kill("SIGTERM");
    const proc = this.process;
    setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 3000);
  }

  async reconnect(rtmpUrl: string, streamKey: string): Promise<void> {
    this.stats.state = "reconnecting";
    this.emit();
    this.stop();
    await new Promise((r) => setTimeout(r, 2000));
    await this.start(rtmpUrl, streamKey);
  }

  private cleanup() {
    if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; }
    if (this.cpuInterval) { clearInterval(this.cpuInterval); this.cpuInterval = null; }
    this.process = null;
    this.startTime = null;
  }
}

export const streamManager = new StreamManager();
