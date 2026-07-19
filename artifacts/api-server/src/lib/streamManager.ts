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

/**
 * INPUT_FPS must match the browser's TARGET_FPS constant in useCanvasStream.ts.
 * FFmpeg uses this as the input framerate for timestamp assignment.
 * Kept at 15 to match the browser capture rate and minimise WebSocket bandwidth.
 */
const INPUT_FPS = 15;

/** Maximum auto-reconnect attempts before giving up */
const MAX_RECONNECT = 5;

/** Delay between reconnect attempts: 3s, 6s, 12s, 24s, 48s (capped) */
function reconnectDelayMs(attempt: number): number {
  return Math.min(3000 * Math.pow(2, attempt - 1), 48_000);
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

  // Saved config for auto-reconnect — set once we successfully start
  private activeConfig: { rtmpUrl: string; streamKey: string; fps: number; videoBitrate: number } | null = null;

  // Session tracking
  private totalSessions = 0;
  private totalUptimeSeconds = 0;
  private lastStreamAt: string | null = null;
  private sessionFpsSamples: number[] = [];
  private sessionBitrateSamples: number[] = [];

  // Auto-reconnect state
  private reconnectAttempts = 0;
  private reconnectTimerId: ReturnType<typeof setTimeout> | null = null;
  private liveStartedAt: number | null = null; // wall clock when we went "live"

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

    // User explicitly started — reset reconnect counter
    this.reconnectAttempts = 0;
    this.activeConfig = { rtmpUrl, streamKey, fps, videoBitrate };

    this.pendingConfig = { rtmpUrl, streamKey, fps, videoBitrate };
    this.stats = {
      ...this.stats, state: "connecting", errorMessage: null,
      droppedFrames: 0, totalFrames: 0, fps: null, bitrate: null,
    };
    this.emit();
    logger.info({ rtmpUrl }, "Stream connecting — waiting for browser canvas stream");

    // Watchdog: if no stream client connects within 15s, auto-fail.
    this.connectTimeoutId = setTimeout(() => {
      this.connectTimeoutId = null;
      if (this.stats.state !== "connecting") return;
      logger.error("No stream client connected within 15s — aborting");
      this.pendingConfig = null;
      this.stats.state = "error";
      this.stats.errorMessage = "Stream client did not connect in time. Check your network and try again.";
      this.cleanup();
      this.emit();
    }, 15_000);
  }

  /**
   * Called by the WebSocket server when a browser connects with role=stream.
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
    logger.info({ rawTarget, fps, videoBitrate }, "Stream client connected — buffering frames while connecting RTMP");

    // ── STEP 1: Register message handler IMMEDIATELY ───────────────────────────
    // Critical: browser starts sending JPEG frames as soon as WebSocket opens.
    // We must register the handler NOW (before the async RTMP connect below)
    // or we lose all frames sent during the 2–5s Facebook handshake window.
    const frameBuffer: Buffer[] = [];
    const MAX_BUFFER_FRAMES = 150; // ~6 seconds at 24fps

    const messageHandler = (rawData: unknown, isBinary: boolean) => {
      if (!isBinary) return;
      // ws v8 delivers binary data as Buffer, Buffer[], or ArrayBuffer
      let buf: Buffer;
      if (Array.isArray(rawData)) {
        buf = Buffer.concat(rawData as Buffer[]);
      } else if (Buffer.isBuffer(rawData)) {
        buf = rawData;
      } else {
        buf = Buffer.from(rawData as ArrayBuffer);
      }

      if (this.process?.stdin?.writable) {
        try { this.process.stdin.write(buf); } catch {}
      } else if (frameBuffer.length < MAX_BUFFER_FRAMES) {
        frameBuffer.push(buf);
      }
    };
    (ws as any).on("message", messageHandler);

    // ── STEP 2: Connect RTMP publisher ─────────────────────────────────────────
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
      logger.error({ err }, "RtmpPublisher error");
      if (this.stats.state === "live" || this.stats.state === "connecting") {
        this._scheduleReconnect(`RTMP error: ${err.message}`);
      }
    });

    publisher.on("close", () => {
      logger.warn("RtmpPublisher socket closed");
      if (this.stats.state === "live" || this.stats.state === "connecting") {
        this._scheduleReconnect("RTMP connection lost");
      }
    });

    // ── STEP 3: Spawn FFmpeg ────────────────────────────────────────────────────
    const bitrateK = `${videoBitrate}k`;
    const maxrateK = `${Math.round(videoBitrate * 1.2)}k`;
    const bufsizeK = `${videoBitrate}k`;
    const gop = fps * 2;

    const args = [
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "-framerate", String(INPUT_FPS),
      "-i", "pipe:0",
      "-f", "lavfi",
      "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-c:v", "libx264",
      "-preset", "ultrafast",
      "-tune", "zerolatency",
      "-b:v", bitrateK,
      "-maxrate", maxrateK,
      "-bufsize", bufsizeK,
      "-pix_fmt", "yuv420p",
      "-g", String(gop),
      "-fps_mode", "cfr",
      "-r", String(fps),
      "-c:a", "aac",
      "-b:a", "128k",
      "-ar", "44100",
      "-ac", "2",
      "-map", "0:v:0",
      "-map", "1:a:0",
      "-f", "flv",
      "pipe:1",
    ];

    try {
      this.process = spawn("ffmpeg", args, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      this.startTime = Date.now();
      this.sessionFpsSamples = [];
      this.sessionBitrateSamples = [];

      // ── STEP 4: Flush buffered frames to FFmpeg stdin ──────────────────────
      logger.info({ bufferedFrames: frameBuffer.length }, "FFmpeg started — flushing buffered frames");
      for (const frame of frameBuffer) {
        if (this.process?.stdin?.writable) {
          try { this.process.stdin.write(frame); } catch {}
        }
      }
      frameBuffer.length = 0;

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
        if (this.stats.state === "stopping") {
          this.stats.state = "idle";
          this.cleanup();
          this.emit();
        } else if (this.stats.state !== "reconnecting") {
          // Unexpected FFmpeg exit — try to reconnect
          logger.error({ code }, "FFmpeg exited unexpectedly");
          this._scheduleReconnect(`FFmpeg exited (code ${code})`);
        }
      });

      this.process.on("error", (err) => {
        this.stats.state = "error";
        this.stats.errorMessage = err.message;
        logger.error({ err }, "FFmpeg process error");
        this.cleanup();
        this.emit();
      });

      this.process.stdin?.on("error", () => {});

      ws.on("close", () => {
        logger.info("Stream WebSocket client disconnected");
        if (this.stats.state === "live" || this.stats.state === "connecting") {
          // Browser ws dropped (proxy timeout, network blip) — auto-reconnect
          this._scheduleReconnect("Browser connection lost");
        } else if (this.stats.state !== "reconnecting") {
          this.stop();
        }
      });
      ws.on("error", () => {
        if (this.stats.state === "live" || this.stats.state === "connecting") {
          this._scheduleReconnect("Browser connection error");
        }
      });

      // Transition to "live" after 3s as fallback; parseFFmpegStats transitions
      // immediately when it sees real fps > 0.
      setTimeout(() => {
        if (this.stats.state === "connecting" && this.process) {
          this.stats.state = "live";
          this.totalSessions++;
          this.lastStreamAt = new Date().toISOString();
          this.liveStartedAt = Date.now();
          this.emit();
        }
      }, 3000);

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

  /**
   * Schedule an automatic reconnect attempt.
   * Uses exponential backoff: 3s, 6s, 12s, 24s, 48s.
   * Gives up after MAX_RECONNECT attempts and sets state to "error".
   */
  private _scheduleReconnect(reason: string): void {
    if (this.stats.state === "reconnecting" || this.stats.state === "stopping") return;

    this.reconnectAttempts++;
    if (this.reconnectAttempts > MAX_RECONNECT) {
      logger.error({ reason, attempts: this.reconnectAttempts }, "Max reconnect attempts reached — giving up");
      this.stats.state = "error";
      this.stats.errorMessage = `${reason}. Max reconnect attempts reached. Please restart manually.`;
      this._hardStop();
      this.emit();
      return;
    }

    const delay = reconnectDelayMs(this.reconnectAttempts);
    logger.warn({ reason, attempt: this.reconnectAttempts, delayMs: delay }, "Stream lost — scheduling reconnect");

    this.stats.state = "reconnecting";
    this.stats.errorMessage = `${reason}. Reconnecting (${this.reconnectAttempts}/${MAX_RECONNECT}) in ${delay / 1000}s…`;
    this._hardStop(); // kill FFmpeg + publisher without touching state
    this.emit();

    this.reconnectTimerId = setTimeout(async () => {
      this.reconnectTimerId = null;
      if (this.stats.state !== "reconnecting") return; // user manually stopped
      if (!this.activeConfig) {
        this.stats.state = "error";
        this.stats.errorMessage = "No stream config saved — cannot reconnect";
        this.emit();
        return;
      }
      logger.info({ attempt: this.reconnectAttempts }, "Reconnect: setting state to connecting");
      // Reset to "connecting" — the frontend sees this and opens a new WebSocket
      this.pendingConfig = { ...this.activeConfig };
      this.stats.state = "connecting";
      this.stats.errorMessage = null;
      this.stats.fps = null;
      this.stats.bitrate = null;
      this.emit();

      // Watchdog for the new connection attempt
      this.connectTimeoutId = setTimeout(() => {
        this.connectTimeoutId = null;
        if (this.stats.state !== "connecting") return;
        logger.error("Reconnect: no browser client connected within 15s");
        this._scheduleReconnect("Browser did not reconnect in time");
      }, 15_000);
    }, delay);
  }

  /** Kill process and publisher without changing state (used by _scheduleReconnect) */
  private _hardStop(): void {
    if (this.connectTimeoutId) { clearTimeout(this.connectTimeoutId); this.connectTimeoutId = null; }
    if (this.reconnectTimerId) { clearTimeout(this.reconnectTimerId); this.reconnectTimerId = null; }
    if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; }
    if (this.cpuInterval) { clearInterval(this.cpuInterval); this.cpuInterval = null; }
    if (this.publisher) { try { this.publisher.close(); } catch {} this.publisher = null; }
    if (this.process) {
      try {
        this.process.stdin?.end();
        this.process.kill("SIGTERM");
        const p = this.process;
        setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, 3000);
      } catch {}
      this.process = null;
    }
    this.startTime = null;
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
        const dataOffset = buf.readUInt32BE(5);
        const skipTotal = dataOffset + 4;
        if (buf.length < skipTotal) return;
        buf = buf.slice(skipTotal);
        headerSkipped = true;
      }

      // Each FLV tag: TagType(1)+DataSize(3)+Timestamp(3)+TimestampExt(1)+StreamID(3)+Data+PrevTagSize(4)
      while (buf.length >= 15) {
        const tagType = buf[0];
        const dataSize = (buf[1] << 16) | (buf[2] << 8) | buf[3];
        if (buf.length < 11 + dataSize + 4) break;
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
      const parsedFps = parseFloat(fpsM[1]);
      this.stats.fps = parsedFps;
      if (this.stats.state === "live") this.sessionFpsSamples.push(parsedFps);
      // Transition to live as soon as FFmpeg reports real encoded frames
      if (parsedFps > 0 && this.stats.state === "connecting" && this.process) {
        this.stats.state = "live";
        this.totalSessions++;
        this.lastStreamAt = new Date().toISOString();
        this.liveStartedAt = Date.now();
        this.emit();
      }
      // Reset reconnect counter once we've been stable for > 10 seconds
      if (parsedFps > 0 && this.stats.state === "live" && this.reconnectAttempts > 0) {
        const liveMs = this.liveStartedAt ? Date.now() - this.liveStartedAt : 0;
        if (liveMs > 10_000) {
          this.reconnectAttempts = 0;
          logger.info("Stream stable — reconnect counter reset");
        }
      }
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
    // User-initiated stop — cancel any pending reconnects, reset counter
    if (this.reconnectTimerId) { clearTimeout(this.reconnectTimerId); this.reconnectTimerId = null; }
    if (this.connectTimeoutId) { clearTimeout(this.connectTimeoutId); this.connectTimeoutId = null; }
    this.reconnectAttempts = 0;
    this.activeConfig = null;
    this.liveStartedAt = null;

    if (!this.process) {
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
    this._hardStop();
    await new Promise((r) => setTimeout(r, 2000));
    await this.start(rtmpUrl, streamKey);
  }

  private cleanup() {
    if (this.connectTimeoutId) { clearTimeout(this.connectTimeoutId); this.connectTimeoutId = null; }
    if (this.reconnectTimerId) { clearTimeout(this.reconnectTimerId); this.reconnectTimerId = null; }
    if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; }
    if (this.cpuInterval) { clearInterval(this.cpuInterval); this.cpuInterval = null; }
    if (this.publisher) { try { this.publisher.close(); } catch {} this.publisher = null; }
    this.process = null;
    this.startTime = null;
  }
}

export const streamManager = new StreamManager();
