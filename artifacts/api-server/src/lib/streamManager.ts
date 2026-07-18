import { spawn, type ChildProcess } from "child_process";
import { execSync } from "child_process";
import type { Readable } from "stream";
import type { WebSocket } from "ws";
import { logger } from "./logger.js";
import { RtmpPublisher } from "./rtmpPublisher.js";

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
  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private listeners: Set<(stats: StreamStats) => void> = new Set();
  private publisher: RtmpPublisher | null = null;

  // Pending config waiting for a stream client to connect
  private pendingConfig: { rtmpUrl: string; streamKey: string; fps: number; videoBitrate: number } | null = null;

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
  async start(rtmpUrl: string, streamKey: string, fps = 30, videoBitrate = 4000): Promise<void> {
    if (this.process) throw new Error("Stream already running");
    if (!rtmpUrl || !streamKey) throw new Error("RTMP URL and stream key are required");

    this.pendingConfig = { rtmpUrl, streamKey, fps, videoBitrate };
    this.stats = {
      ...this.stats, state: "connecting", errorMessage: null,
      droppedFrames: 0, totalFrames: 0, fps: null, bitrate: null,
    };
    this.emit();
    logger.info({ rtmpUrl }, "Stream connecting — waiting for browser canvas stream");

    // Watchdog: if no stream client connects within 10s, auto-fail.
    // Without this, state stays "connecting" forever when the WebSocket
    // never arrives (network failure, proxy drop, etc.).
    this.connectTimeoutId = setTimeout(() => {
      this.connectTimeoutId = null;
      if (this.stats.state !== "connecting") return;
      logger.error("No stream client connected within 10s — aborting");
      this.pendingConfig = null;
      this.stats.state = "error";
      this.stats.errorMessage = "Stream client did not connect in time. Check your network and try again.";
      this.cleanup();
      this.emit();
    }, 10_000);
  }

  /**
   * Called by the WebSocket server when a browser connects with role=stream.
   * Spawns FFmpeg reading WebM from stdin and writing RTMP output.
   */
  attachStreamClient(ws: WebSocket): void {
    this._doAttach(ws).catch((err) => {
      logger.error({ err }, "Failed to attach stream client");
      this.stats.state = "error";
      this.stats.errorMessage = err?.message ?? "Stream setup failed";
      this.cleanup();
      this.emit();
      try { ws.close(); } catch {}
    });
  }

  private async _doAttach(ws: WebSocket): Promise<void> {
    if (this.stats.state !== "connecting" || !this.pendingConfig) {
      logger.warn("Stream client attached but not in connecting state — ignoring");
      ws.close();
      return;
    }

    const { rtmpUrl, streamKey, fps, videoBitrate } = this.pendingConfig;
    this.pendingConfig = null;

    if (this.connectTimeoutId) {
      clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }

    const rawTarget = `${rtmpUrl.replace(/\/$/, "")}/${streamKey}`;
    logger.info({ rawTarget, fps, videoBitrate }, "Stream client connected — connecting RTMP publisher");

    // ── Connect RTMP publisher (Node.js, bypasses librtmp TLS limitation) ────
    // FFmpeg on this system is compiled with librtmp which cannot do RTMPS/TLS.
    // We handle the RTMP protocol in Node.js instead: FFmpeg writes FLV to
    // stdout, and we parse/forward each FLV tag as an RTMP message over TLS.
    const publisher = new RtmpPublisher();
    this.publisher = publisher;
    try {
      await publisher.connect(rawTarget);
    } catch (err: any) {
      this.stats.state = "error";
      this.stats.errorMessage = `RTMP connect failed: ${err?.message ?? String(err)}`;
      logger.error({ err }, "RtmpPublisher failed to connect to server");
      this.cleanup();
      this.emit();
      try { ws.close(); } catch {}
      return;
    }

    publisher.on("error", (err: Error) => {
      logger.error({ err }, "RtmpPublisher error — stopping stream");
      if (this.stats.state === "live" || this.stats.state === "connecting") {
        this.stats.state = "error";
        this.stats.errorMessage = `RTMP error: ${err.message}`;
        this.cleanup();
        this.emit();
      }
    });
    publisher.on("close", () => {
      logger.warn("RtmpPublisher socket closed");
      if (this.stats.state === "live" || this.stats.state === "connecting") {
        this.stats.state = "error";
        this.stats.errorMessage = "RTMP connection closed by server";
        this.cleanup();
        this.emit();
      }
    });

    // ── Spawn FFmpeg — writes FLV to stdout ──────────────────────────────────
    const bitrateK = `${videoBitrate}k`;
    const maxrateK = `${Math.round(videoBitrate * 1.2)}k`;
    const bufsizeK = `${videoBitrate}k`;
    const gop = fps * 2;
    const args = [
      "-use_wallclock_as_timestamps", "1",
      "-framerate", String(fps),
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "-i", "pipe:0",
      "-f", "lavfi",
      "-i", "aevalsrc=0:s=44100",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "zerolatency",
      "-b:v", bitrateK,
      "-maxrate", maxrateK,
      "-bufsize", bufsizeK,
      "-pix_fmt", "yuv420p",
      "-g", String(gop),
      "-r", String(fps),
      "-vsync", "cfr",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "44100",
      "-ac", "2",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-f", "flv",
      "pipe:1",  // FLV → our RTMP publisher (not librtmp)
    ];

    try {
      this.process = spawn("ffmpeg", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.startTime = Date.now();
      this.sessionFpsSamples = [];
      this.sessionBitrateSamples = [];

      // Forward FLV tags from FFmpeg stdout to the RTMP publisher
      if (this.process.stdout) {
        this.pipeFlvToPublisher(this.process.stdout as unknown as Readable, publisher);
      }

      this.process.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        this.parseFFmpegStats(text);
        logger.info({ ffmpeg: text.trim() }, "FFmpeg");
      });

      this.process.on("close", (code) => {
        const uptime = this.startTime ? Math.floor((Date.now() - this.startTime) / 1000) : 0;
        this.totalUptimeSeconds += uptime;
        if (this.stats.state !== "stopping") {
          this.stats.state = "error";
          this.stats.errorMessage = `FFmpeg exited with code ${code}`;
          logger.error({ code }, "FFmpeg exited unexpectedly");
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

      this.process.stdin?.on("error", () => {});

      ws.on("message", (data: Buffer) => {
        if (this.process?.stdin?.writable) {
          try { this.process.stdin.write(data); } catch {}
        }
      });

      ws.on("close", () => {
        logger.info("Stream WebSocket client disconnected — stopping");
        this.stop();
      });
      ws.on("error", () => { this.stop(); });

      // publisher.connect() already confirmed RTMP is accepted by Facebook —
      // transition to "live" as soon as FFmpeg starts sending FLV data
      setTimeout(() => {
        if (this.stats.state === "connecting" && this.process) {
          this.stats.state = "live";
          this.totalSessions++;
          this.lastStreamAt = new Date().toISOString();
          this.emit();
        }
      }, 2000);

      this.statsInterval = setInterval(() => {
        if (this.startTime) this.stats.uptimeSeconds = Math.floor((Date.now() - this.startTime) / 1000);
        this.stats.memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
        this.emit();
      }, 1000);

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

  /** Parse FLV stream from FFmpeg stdout and forward each tag to the RTMP publisher. */
  private pipeFlvToPublisher(stdout: Readable, publisher: RtmpPublisher): void {
    let buf = Buffer.alloc(0);
    let headerSkipped = false;

    stdout.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);

      // Skip FLV file header (DataOffset bytes) + PreviousTagSize0 (4 bytes)
      if (!headerSkipped) {
        if (buf.length < 9) return;
        const dataOffset = buf.readUInt32BE(5); // offset to first tag (typically 9)
        const skipTotal = dataOffset + 4;        // +4 for PreviousTagSize0 = 0
        if (buf.length < skipTotal) return;
        buf = buf.slice(skipTotal);
        headerSkipped = true;
      }

      // Each FLV tag: TagType(1)+DataSize(3)+Timestamp(3)+TimestampExt(1)+StreamID(3)+Data+PrevTagSize(4)
      while (buf.length >= 15) {
        const tagType = buf[0];
        const dataSize = (buf[1] << 16) | (buf[2] << 8) | buf[3];
        if (buf.length < 11 + dataSize + 4) break;
        // Compose 32-bit timestamp: upper 8 bits in byte 7, lower 24 in bytes 4-6
        const ts = ((buf[7] << 24) | (buf[4] << 16) | (buf[5] << 8) | buf[6]) >>> 0;
        const tagData = buf.slice(11, 11 + dataSize);
        publisher.writeFlvTag(tagType, ts, tagData);
        buf = buf.slice(11 + dataSize + 4);
      }
    });

    stdout.on("error", () => {});
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
    // Always clear the watchdog when stopping
    if (this.connectTimeoutId) {
      clearTimeout(this.connectTimeoutId);
      this.connectTimeoutId = null;
    }
    if (!this.process) {
      // No FFmpeg running — reset to idle regardless of current state
      this.pendingConfig = null;
      this.stats.state = "idle";
      this.stats.errorMessage = null;
      this.cleanup();
      this.emit();
      return;
    }
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
    if (this.connectTimeoutId) { clearTimeout(this.connectTimeoutId); this.connectTimeoutId = null; }
    if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; }
    if (this.cpuInterval) { clearInterval(this.cpuInterval); this.cpuInterval = null; }
    if (this.publisher) { try { this.publisher.close(); } catch {} this.publisher = null; }
    this.process = null;
    this.startTime = null;
  }
}

export const streamManager = new StreamManager();
