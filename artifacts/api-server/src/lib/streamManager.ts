import { spawn, type ChildProcess } from "child_process";
import { execSync } from "child_process";
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

  // Session tracking for summary
  private totalSessions = 0;
  private totalUptimeSeconds = 0;
  private lastStreamAt: string | null = null;
  private sessionFpsSamples: number[] = [];
  private sessionBitrateSamples: number[] = [];

  getStats(): StreamStats {
    return { ...this.stats };
  }

  getSummary() {
    const avgFps = this.sessionFpsSamples.length > 0
      ? this.sessionFpsSamples.reduce((a, b) => a + b, 0) / this.sessionFpsSamples.length
      : 0;
    const avgBitrate = this.sessionBitrateSamples.length > 0
      ? this.sessionBitrateSamples.reduce((a, b) => a + b, 0) / this.sessionBitrateSamples.length
      : 0;
    return {
      totalSessions: this.totalSessions,
      avgFps: Math.round(avgFps),
      avgBitrate: Math.round(avgBitrate),
      totalUptimeSeconds: this.totalUptimeSeconds,
      lastStreamAt: this.lastStreamAt,
    };
  }

  subscribe(fn: (stats: StreamStats) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn(this.stats);
  }

  private getCpuUsage(): number {
    try {
      // Read /proc/stat for Linux CPU usage
      const out = execSync("grep 'cpu ' /proc/stat", { timeout: 500 }).toString().trim();
      const parts = out.split(/\s+/).slice(1).map(Number);
      const total = parts.reduce((a, b) => a + b, 0);
      const idle = parts[3] ?? 0;
      // Rough: return usage as percentage of non-idle
      const usage = total > 0 ? ((total - idle) / total) * 100 : 0;
      return Math.round(usage * 10) / 10;
    } catch {
      return 0;
    }
  }

  async start(rtmpUrl: string, streamKey: string): Promise<void> {
    if (this.process) throw new Error("Stream already running");

    if (!rtmpUrl || !streamKey) throw new Error("RTMP URL and stream key are required");

    this.stats = {
      ...this.stats, state: "connecting", errorMessage: null,
      droppedFrames: 0, totalFrames: 0, fps: null, bitrate: null,
    };
    this.emit();

    const target = `${rtmpUrl.replace(/\/$/, "")}/${streamKey}`;
    logger.info({ rtmpUrl }, "Starting stream");

    // FFmpeg: lavfi test source (stable video even without a capture device)
    // In production this input would be replaced with the canvas video stream
    const args = [
      "-re",
      "-f", "lavfi",
      "-i", "testsrc2=size=1280x720:rate=30",
      "-f", "lavfi",
      "-i", "aevalsrc=0.1*sin(2*PI*440*t)|0.1*sin(2*PI*440*t):s=44100",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-tune", "zerolatency",
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
      this.process = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
      this.startTime = Date.now();
      this.sessionFpsSamples = [];
      this.sessionBitrateSamples = [];

      this.process.stderr?.on("data", (data: Buffer) => {
        const line = data.toString();
        this.parseFFmpegStats(line);
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

      // Transition to live after FFmpeg initializes
      setTimeout(() => {
        if (this.stats.state === "connecting" && this.process) {
          this.stats.state = "live";
          this.totalSessions++;
          this.lastStreamAt = new Date().toISOString();
          this.emit();
        }
      }, 2500);

      // Uptime + memory stats
      this.statsInterval = setInterval(() => {
        if (this.startTime) {
          this.stats.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        }
        const mem = process.memoryUsage();
        this.stats.memoryMb = Math.round(mem.rss / 1024 / 1024);
        this.emit();
      }, 1000);

      // CPU usage (sampled every 3s to avoid overhead)
      this.cpuInterval = setInterval(() => {
        this.stats.cpuUsage = this.getCpuUsage();
      }, 3000);

    } catch (err: any) {
      this.stats.state = "error";
      this.stats.errorMessage = err.message || "Failed to start FFmpeg";
      this.emit();
    }
  }

  private parseFFmpegStats(line: string) {
    const fpsMatch = line.match(/fps=\s*(\d+(?:\.\d+)?)/);
    if (fpsMatch) {
      const fps = parseFloat(fpsMatch[1]);
      this.stats.fps = fps;
      if (this.stats.state === "live") this.sessionFpsSamples.push(fps);
    }

    const bitrateMatch = line.match(/bitrate=\s*(\d+(?:\.\d+)?)kbits\/s/);
    if (bitrateMatch) {
      const bitrate = parseFloat(bitrateMatch[1]);
      this.stats.bitrate = bitrate;
      this.stats.networkKbps = bitrate;
      if (this.stats.state === "live") this.sessionBitrateSamples.push(bitrate);
    }

    const frameMatch = line.match(/frame=\s*(\d+)/);
    if (frameMatch) this.stats.totalFrames = parseInt(frameMatch[1]);

    // FFmpeg reports dropped frames as "drop=N" or "dup=N drop=N"
    const dropMatch = line.match(/drop=\s*(\d+)/);
    if (dropMatch) this.stats.droppedFrames = parseInt(dropMatch[1]);
  }

  stop(): void {
    if (!this.process) return;
    this.stats.state = "stopping";
    this.emit();
    this.process.kill("SIGTERM");
    const proc = this.process;
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch {}
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
    if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; }
    if (this.cpuInterval) { clearInterval(this.cpuInterval); this.cpuInterval = null; }
    this.process = null;
    this.startTime = null;
  }
}

export const streamManager = new StreamManager();
