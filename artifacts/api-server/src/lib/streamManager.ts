import { spawn, type ChildProcess } from "child_process";
import { execSync } from "child_process";
import type { Readable } from "stream";
import { RtmpPublisher } from "./rtmpPublisher.js";
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
  private connectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private publisher: RtmpPublisher | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
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
   * Connects RtmpPublisher (Node.js TLS) then spawns FFmpeg writing FLV to stdout.
   */
  attachStreamClient(ws: WebSocket): void {
    // Allow re-attach if stream is live (handles Vite HMR page reloads)
    if ((this.stats.state === "live" || this.stats.state === "connecting") && this.process) {
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      logger.info("Re-attaching stream WS to running session");
      this._wireWs(ws);
      return;
    }

    if (this.stats.state !== "connecting" || !this.pendingConfig) {
      logger.warn("Stream client attached but not in connecting state — ignoring");
      ws.close();
      return;
    }

    const { rtmpUrl, streamKey } = this.pendingConfig;
    this.pendingConfig = null;
    if (this.connectTimeoutId) { clearTimeout(this.connectTimeoutId); this.connectTimeoutId = null; }

    // Run async setup inside a non-async method
    this._doAttach(ws, rtmpUrl, streamKey).catch((err: any) => {
      logger.error({ err }, "Stream attach failed");
      this.stats.state = "error";
      this.stats.errorMessage = err?.message ?? "Stream setup failed";
      this.cleanup();
      this.emit();
      try { ws.close(); } catch {}
    });
  }

  private async _doAttach(ws: WebSocket, rtmpUrl: string, streamKey: string): Promise<void> {
    const rawTarget = `${rtmpUrl.replace(/\/$/, "")}/${streamKey}`;
    logger.info({ rawTarget }, "Connecting RTMP publisher (Node.js TLS — bypasses librtmp)");

    // ── Connect RTMP via Node.js (supports RTMPS/TLS, unlike librtmp) ────────
    const publisher = new RtmpPublisher();
    this.publisher = publisher;
    try {
      await publisher.connect(rawTarget);
    } catch (err: any) {
      this.stats.state = "error";
      this.stats.errorMessage = `RTMP connect failed: ${err?.message ?? err}`;
      logger.error({ err }, "RtmpPublisher failed");
      this.cleanup();
      this.emit();
      try { ws.close(); } catch {}
      return;
    }

    // Kill FFmpeg then cleanup when publisher closes/errors
    const killAll = (msg: string) => {
      if (this.stats.state !== "live" && this.stats.state !== "connecting") return;
      this.stats.state = "error";
      this.stats.errorMessage = msg;
      const proc = this.process;
      if (proc) { try { proc.stdin?.end(); proc.kill("SIGTERM"); } catch {} setTimeout(() => { try { proc.kill("SIGKILL"); } catch {} }, 3000); }
      this.cleanup();
      this.emit();
    };
    publisher.on("error", (e: Error) => { logger.error({ err: e }, "RtmpPublisher error"); killAll(`RTMP error: ${e.message}`); });
    publisher.on("close", () => { logger.warn("RtmpPublisher socket closed by server"); killAll("Facebook closed the RTMP connection — check stream key"); });

    // ── Spawn FFmpeg writing FLV → stdout (not directly to RTMP) ─────────────
    const args = [
      "-use_wallclock_as_timestamps", "1",
      "-framerate", "24",
      "-f", "image2pipe", "-vcodec", "mjpeg", "-i", "pipe:0",
      "-f", "lavfi", "-i", "aevalsrc=0:s=44100",
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
      "-b:v", "1500k", "-maxrate", "1800k", "-bufsize", "1500k",
      "-pix_fmt", "yuv420p", "-g", "48", "-r", "24", "-vsync", "cfr",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
      "-map", "0:v:0", "-map", "1:a:0",
      "-f", "flv", "pipe:1",   // FLV → our RTMP publisher
    ];

    this.process = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"] });
    this.startTime = Date.now();
    this.sessionFpsSamples = [];
    this.sessionBitrateSamples = [];

    // Parse FLV from stdout and forward to RTMP publisher
    this._pipeFlv(this.process.stdout as unknown as Readable, publisher);

    this.process.stderr?.on("data", (d: Buffer) => {
      const text = d.toString();
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

    this._wireWs(ws);

    // publisher.connect() already confirmed NetStream.Publish.Start → go live
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

    this.cpuInterval = setInterval(() => { this.stats.cpuUsage = this.getCpuUsage(); }, 3000);
  }

  /** Wire WebSocket message/close/error handlers to running FFmpeg process. */
  private _wireWs(ws: WebSocket): void {
    ws.on("message", (data: Buffer) => {
      if (this.process?.stdin?.writable) { try { this.process.stdin.write(data); } catch {} }
    });
    ws.on("close", () => {
      logger.info("Stream WS disconnected — 8s grace period before stopping");
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => { this.reconnectTimer = null; this.stop(); }, 8000);
    });
    ws.on("error", () => {
      if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
      this.stop();
    });
  }

  /** Parse FLV stream from FFmpeg stdout and forward each tag to the RTMP publisher. */
  private _pipeFlv(stdout: Readable, publisher: RtmpPublisher): void {
    let buf = Buffer.alloc(0);
    let headerSkipped = false;
    let tagCount = 0;

    stdout.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);

      if (!headerSkipped) {
        if (buf.length < 9) return;
        if (buf[0] !== 0x46 || buf[1] !== 0x4c || buf[2] !== 0x56) {
          logger.error({ header: buf.slice(0, 4).toString("hex") }, "FFmpeg stdout is not FLV");
          return;
        }
        const skipTotal = buf.readUInt32BE(5) + 4; // DataOffset + PreviousTagSize0
        if (buf.length < skipTotal) return;
        buf = buf.slice(skipTotal);
        headerSkipped = true;
        logger.info("FLV header OK — forwarding tags to Facebook");
      }

      // TagType(1)+DataSize(3)+Timestamp(3)+TimestampExt(1)+StreamID(3)+Data+PrevTagSize(4)
      while (buf.length >= 11) {
        const tagType = buf[0];
        const dataSize = (buf[1] << 16) | (buf[2] << 8) | buf[3];
        if (buf.length < 11 + dataSize + 4) break;
        const ts = ((buf[7] << 24) | (buf[4] << 16) | (buf[5] << 8) | buf[6]) >>> 0;
        publisher.writeFlvTag(tagType, ts, buf.slice(11, 11 + dataSize));
        tagCount++;
        if (tagCount <= 5) logger.info({ tagType, dataSize, ts }, "FLV tag → RTMP");
        buf = buf.slice(11 + dataSize + 4);
      }
    });

    stdout.on("error", (err) => logger.error({ err }, "FFmpeg stdout error"));
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
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; }
    if (this.cpuInterval) { clearInterval(this.cpuInterval); this.cpuInterval = null; }
    if (this.publisher) { try { this.publisher.close(); } catch {} this.publisher = null; }
    this.process = null;
    this.startTime = null;
  }
}

export const streamManager = new StreamManager();
