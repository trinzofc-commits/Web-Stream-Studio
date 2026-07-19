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
 */
const INPUT_FPS = 15;

/** Maximum auto-reconnect attempts before giving up */
const MAX_RECONNECT = 5;

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

  private pendingConfig: { rtmpUrl: string; streamKey: string; fps: number; videoBitrate: number } | null = null;
  private activeConfig: { rtmpUrl: string; streamKey: string; fps: number; videoBitrate: number } | null = null;

  private totalSessions = 0;
  private totalUptimeSeconds = 0;
  private lastStreamAt: string | null = null;
  private sessionFpsSamples: number[] = [];
  private sessionBitrateSamples: number[] = [];

  private reconnectAttempts = 0;
  private reconnectTimerId: ReturnType<typeof setTimeout> | null = null;
  private liveStartedAt: number | null = null;

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

  async start(rtmpUrl: string, streamKey: string, fps = 30, videoBitrate = 4000): Promise<void> {
    if (this.process) throw new Error("Stream already running");
    if (!rtmpUrl || !streamKey) throw new Error("RTMP URL and stream key are required");

    this.reconnectAttempts = 0;
    this.activeConfig = { rtmpUrl, streamKey, fps, videoBitrate };
    this.pendingConfig = { rtmpUrl, streamKey, fps, videoBitrate };
    this.stats = {
      ...this.stats, state: "connecting", errorMessage: null,
      droppedFrames: 0, totalFrames: 0, fps: null, bitrate: null,
    };
    this.emit();
    logger.info({ rtmpUrl }, "Stream connecting — waiting for browser canvas stream");

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

    // ── STEP 1: Register message handler IMMEDIATELY ───────────────────────────
    //
    // Tagged binary protocol (from useCanvasStream.ts):
    //   0x00 + JSON  → handshake  { hasAudio: boolean }
    //   0x01 + JPEG  → video frame
    //   0x02 + WebM  → audio chunk (Opus in WebM container from MediaRecorder)
    //   0xFF…        → legacy untagged JPEG (backward compat)
    //
    // We register this handler BEFORE the async RTMP connect so that the
    // handshake and early video/audio frames are captured during the 2–5 s
    // Facebook TLS handshake window.
    let hasAudio = false;
    const videoBuffer: Buffer[] = [];
    const audioBuffer: Buffer[] = [];
    const MAX_VIDEO_BUFFER = 150; // ~10 s at 15 fps
    const MAX_AUDIO_BUFFER = 200; // ~50 s at 250 ms chunks

    const messageHandler = (rawData: unknown, isBinary: boolean) => {
      if (!isBinary) return;

      let buf: Buffer;
      if (Array.isArray(rawData)) {
        buf = Buffer.concat(rawData as Buffer[]);
      } else if (Buffer.isBuffer(rawData)) {
        buf = rawData;
      } else {
        buf = Buffer.from(rawData as ArrayBuffer);
      }

      if (buf.length === 0) return;

      const tag = buf[0];

      if (tag === 0x00) {
        // Handshake — read audio capability before FFmpeg spawns
        try {
          const json = JSON.parse(buf.slice(1).toString("utf8"));
          hasAudio = json.hasAudio === true;
          logger.info({ hasAudio }, "Stream handshake received");
        } catch { /* ignore malformed */ }
        return;
      }

      // Determine video vs audio, support legacy untagged JPEG (0xFF = SOI)
      const isVideo = tag === 0x01 || tag === 0xFF;
      const isAudio = tag === 0x02;
      const payload = (tag === 0x01 || tag === 0x02) ? buf.slice(1) : buf;

      if (isVideo) {
        const stdin = (this.process?.stdin as any);
        if (stdin?.writable) {
          try { stdin.write(payload); } catch {}
        } else if (videoBuffer.length < MAX_VIDEO_BUFFER) {
          videoBuffer.push(payload);
        }
      } else if (isAudio) {
        const audioPipe = this.process?.stdio[3] as any;
        if (audioPipe?.writable) {
          try { audioPipe.write(payload); } catch {}
        } else if (audioBuffer.length < MAX_AUDIO_BUFFER) {
          audioBuffer.push(payload);
        }
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
      logger.error({ err }, "RtmpPublisher failed to connect");
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
    //
    // hasAudio is now set (handshake arrived during the ~3 s RTMP connect above).
    // When true: read audio from pipe:3 (fd 3) — WebM/Opus from MediaRecorder.
    // When false: use anullsrc (silent stream — no audio sources in the scene).
    logger.info({ hasAudio, fps, videoBitrate }, "Spawning FFmpeg");

    const bitrateK = `${videoBitrate}k`;
    const maxrateK = `${Math.round(videoBitrate * 1.2)}k`;
    const bufsizeK = `${videoBitrate}k`;
    const gop = fps * 2;

    const videoInputArgs = [
      "-f", "image2pipe", "-vcodec", "mjpeg",
      "-framerate", String(INPUT_FPS),
      "-i", "pipe:0",
    ];

    const audioInputArgs = hasAudio
      ? ["-f", "webm", "-i", "pipe:3"]
      : ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100"];

    const encodeArgs = [
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
      "-b:v", bitrateK, "-maxrate", maxrateK, "-bufsize", bufsizeK,
      "-pix_fmt", "yuv420p", "-g", String(gop),
      "-fps_mode", "cfr", "-r", String(fps),
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
      "-map", "0:v:0", "-map", "1:a:0",
      "-f", "flv", "pipe:1",
    ];

    const args = [...videoInputArgs, ...audioInputArgs, ...encodeArgs];

    // Use 4 stdio slots when audio pipe is needed (fd 3 = audio input)
    const stdioConfig = hasAudio
      ? (["pipe", "pipe", "pipe", "pipe"] as const)
      : (["pipe", "pipe", "pipe"] as const);

    try {
      this.process = spawn("ffmpeg", args, { stdio: stdioConfig as any });
      this.startTime = Date.now();
      this.sessionFpsSamples = [];
      this.sessionBitrateSamples = [];

      // ── STEP 4: Flush buffered frames/chunks to FFmpeg ─────────────────────
      logger.info(
        { videoFrames: videoBuffer.length, audioChunks: audioBuffer.length },
        "FFmpeg started — flushing buffers",
      );
      for (const frame of videoBuffer) {
        if ((this.process?.stdin as any)?.writable) {
          try { (this.process!.stdin as any).write(frame); } catch {}
        }
      }
      videoBuffer.length = 0;

      if (hasAudio) {
        const audioPipe = this.process.stdio[3] as any;
        for (const chunk of audioBuffer) {
          if (audioPipe?.writable) {
            try { audioPipe.write(chunk); } catch {}
          }
        }
      }
      audioBuffer.length = 0;

      // Forward FLV tags from FFmpeg stdout to RTMP publisher
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
      if (hasAudio) (this.process.stdio[3] as any)?.on("error", () => {});

      ws.on("close", () => {
        logger.info("Stream WebSocket client disconnected");
        if (this.stats.state === "live" || this.stats.state === "connecting") {
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

  private _scheduleReconnect(reason: string): void {
    if (this.stats.state === "reconnecting" || this.stats.state === "stopping") return;

    this.reconnectAttempts++;
    if (this.reconnectAttempts > MAX_RECONNECT) {
      logger.error({ reason, attempts: this.reconnectAttempts }, "Max reconnect attempts reached");
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
    this._hardStop();
    this.emit();

    this.reconnectTimerId = setTimeout(async () => {
      this.reconnectTimerId = null;
      if (this.stats.state !== "reconnecting") return;
      if (!this.activeConfig) {
        this.stats.state = "error";
        this.stats.errorMessage = "No stream config saved — cannot reconnect";
        this.emit();
        return;
      }
      logger.info({ attempt: this.reconnectAttempts }, "Reconnect: setting state to connecting");
      this.pendingConfig = { ...this.activeConfig };
      this.stats.state = "connecting";
      this.stats.errorMessage = null;
      this.stats.fps = null;
      this.stats.bitrate = null;
      this.emit();

      this.connectTimeoutId = setTimeout(() => {
        this.connectTimeoutId = null;
        if (this.stats.state !== "connecting") return;
        logger.error("Reconnect: no browser client connected within 15s");
        this._scheduleReconnect("Browser did not reconnect in time");
      }, 15_000);
    }, delay);
  }

  private _hardStop(): void {
    if (this.connectTimeoutId) { clearTimeout(this.connectTimeoutId); this.connectTimeoutId = null; }
    if (this.reconnectTimerId) { clearTimeout(this.reconnectTimerId); this.reconnectTimerId = null; }
    if (this.statsInterval) { clearInterval(this.statsInterval); this.statsInterval = null; }
    if (this.cpuInterval) { clearInterval(this.cpuInterval); this.cpuInterval = null; }
    if (this.publisher) { try { this.publisher.close(); } catch {} this.publisher = null; }
    if (this.process) {
      try {
        this.process.stdin?.end();
        // Close audio pipe if it exists
        const audioPipe = this.process.stdio[3] as any;
        if (audioPipe) try { audioPipe.end(); } catch {}
        this.process.kill("SIGTERM");
        const p = this.process;
        setTimeout(() => { try { p.kill("SIGKILL"); } catch {} }, 3000);
      } catch {}
      this.process = null;
    }
    this.startTime = null;
  }

  private pipeFlvToPublisher(stdout: Readable, publisher: RtmpPublisher): void {
    let buf = Buffer.alloc(0);
    let headerSkipped = false;

    stdout.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);

      if (!headerSkipped) {
        if (buf.length < 9) return;
        const dataOffset = buf.readUInt32BE(5);
        const skipTotal = dataOffset + 4;
        if (buf.length < skipTotal) return;
        buf = buf.slice(skipTotal);
        headerSkipped = true;
      }

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
      if (parsedFps > 0 && this.stats.state === "connecting" && this.process) {
        this.stats.state = "live";
        this.totalSessions++;
        this.lastStreamAt = new Date().toISOString();
        this.liveStartedAt = Date.now();
        this.emit();
      }
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
    const audioPipe = this.process.stdio[3] as any;
    if (audioPipe) try { audioPipe.end(); } catch {}
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
