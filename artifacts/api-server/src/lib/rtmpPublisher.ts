/**
 * Minimal RTMP publisher over plain TCP or TLS.
 *
 * Why this exists: FFmpeg on this system is compiled with --enable-librtmp, which
 * takes over all rtmp* protocol URLs. The bundled librtmp does not support TLS
 * (RTMPS), so streaming to Facebook Live (port 443, TLS-only) fails.
 *
 * This module:
 *  1. Opens a TLS or plain TCP socket to the RTMP server.
 *  2. Runs the full RTMP handshake (C0/C1 → S0/S1/S2 → C2).
 *  3. Sends connect / releaseStream / FCPublish / createStream / publish
 *     AMF0 commands and waits for the corresponding _result / onStatus replies.
 *  4. Exposes writeFlvTag() so callers can forward FLV tags read from
 *     FFmpeg's stdout directly as RTMP video/audio/data messages.
 */

import * as net from "net";
import * as tls from "tls";
import { EventEmitter } from "events";
import { logger } from "./logger.js";

// ── AMF0 encoding ─────────────────────────────────────────────────────────────

function amfStr(s: string): Buffer {
  const b = Buffer.from(s, "utf8");
  const o = Buffer.allocUnsafe(3 + b.length);
  o[0] = 2;
  o.writeUInt16BE(b.length, 1);
  b.copy(o, 3);
  return o;
}
function amfNum(n: number): Buffer {
  const o = Buffer.allocUnsafe(9);
  o[0] = 0;
  o.writeDoubleBE(n, 1);
  return o;
}
function amfBool(v: boolean): Buffer {
  return Buffer.from([1, v ? 1 : 0]);
}
function amfNull(): Buffer {
  return Buffer.from([5]);
}
function amfObj(pairs: [string, Buffer][]): Buffer {
  const parts: Buffer[] = [Buffer.from([3])];
  for (const [k, v] of pairs) {
    const kb = Buffer.from(k, "utf8");
    const lb = Buffer.allocUnsafe(2);
    lb.writeUInt16BE(kb.length, 0);
    parts.push(lb, kb, v);
  }
  parts.push(Buffer.from([0, 0, 9]));
  return Buffer.concat(parts);
}

// ── AMF0 decoding ─────────────────────────────────────────────────────────────

function decAmf(buf: Buffer, pos: number): { val: unknown; pos: number } {
  if (pos >= buf.length) return { val: undefined, pos };
  const type = buf[pos++];
  if (type === 0) return { val: buf.readDoubleBE(pos), pos: pos + 8 };
  if (type === 1) return { val: buf[pos] !== 0, pos: pos + 1 };
  if (type === 2) {
    const l = buf.readUInt16BE(pos);
    return { val: buf.slice(pos + 2, pos + 2 + l).toString("utf8"), pos: pos + 2 + l };
  }
  if (type === 3 || type === 8) {
    if (type === 8) pos += 4;
    const obj: Record<string, unknown> = {};
    while (pos + 2 <= buf.length) {
      const kl = buf.readUInt16BE(pos);
      pos += 2;
      if (kl === 0 && buf[pos] === 9) { pos++; break; }
      const key = buf.slice(pos, pos + kl).toString("utf8");
      pos += kl;
      const r = decAmf(buf, pos);
      obj[key] = r.val;
      pos = r.pos;
    }
    return { val: obj, pos };
  }
  if (type === 5) return { val: null, pos };
  if (type === 10) {
    const count = buf.readUInt32BE(pos);
    pos += 4;
    const arr: unknown[] = [];
    for (let i = 0; i < count; i++) {
      const r = decAmf(buf, pos);
      arr.push(r.val);
      pos = r.pos;
    }
    return { val: arr, pos };
  }
  return { val: undefined, pos };
}

function decAmfList(buf: Buffer): unknown[] {
  const vals: unknown[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const r = decAmf(buf, pos);
    if (r.val === undefined && r.pos === pos) break;
    vals.push(r.val);
    pos = r.pos;
  }
  return vals;
}

// ── RTMP chunk encoding ───────────────────────────────────────────────────────

function encodeChunks(
  csId: number,
  msgType: number,
  streamId: number,
  timestamp: number,
  payload: Buffer,
  chunkSize: number,
): Buffer {
  const parts: Buffer[] = [];
  let offset = 0;
  while (offset < payload.length) {
    const slice = payload.slice(offset, Math.min(offset + chunkSize, payload.length));
    if (offset === 0) {
      // Format 0: full 12-byte header
      const h = Buffer.allocUnsafe(12);
      h[0] = csId & 0x3f; // fmt=0
      const t = timestamp & 0xffffff;
      h[1] = (t >> 16) & 0xff;
      h[2] = (t >> 8) & 0xff;
      h[3] = t & 0xff;
      h[4] = (payload.length >> 16) & 0xff;
      h[5] = (payload.length >> 8) & 0xff;
      h[6] = payload.length & 0xff;
      h[7] = msgType;
      h.writeUInt32LE(streamId, 8);
      parts.push(h);
    } else {
      // Format 3: continuation (no header)
      parts.push(Buffer.from([0xc0 | (csId & 0x3f)]));
    }
    parts.push(slice);
    offset += chunkSize;
  }
  return Buffer.concat(parts);
}

function buildCmd(csId: number, streamId: number, ...values: Buffer[]): Buffer {
  const payload = Buffer.concat(values);
  return encodeChunks(csId, 20 /* AMF0 Command */, streamId, 0, payload, 128);
}

// ── RTMP chunk parser state ───────────────────────────────────────────────────

interface CsState {
  type: number;
  streamId: number;
  ts: number;
  len: number;
  collected: Buffer[];
}

// ── RtmpPublisher ─────────────────────────────────────────────────────────────

export class RtmpPublisher extends EventEmitter {
  private sock: tls.TLSSocket | net.Socket | null = null;
  private raw = Buffer.alloc(0); // incoming byte buffer

  // Handshake raw-read support
  private handshakeDone = false;
  private rawNeed = 0;
  private rawResolve: ((b: Buffer) => void) | null = null;

  // RTMP parse state
  private serverChunkSize = 128;
  private csStates = new Map<number, CsState>();

  // Command tracking
  private txId = 0;
  private pendingCmds = new Map<
    number,
    { resolve: (vals: unknown[]) => void; reject: (e: Error) => void }
  >();
  private publishResolve: (() => void) | null = null;
  private publishReject: ((e: Error) => void) | null = null;

  // Stream info
  private publishStreamId = 1;
  private outChunkSize = 4096;
  private publishReady = false;

  // Window Acknowledgement — Facebook requires the publisher to send
  // Acknowledgement (type 3) when cumulative bytes received exceed the window.
  // Without this Facebook throttles/drops the inbound connection.
  private windowAckSize = 2_500_000; // default until server sets it
  private bytesReceived = 0;
  private lastAckSent = 0;

  // ── Public API ──────────────────────────────────────────────────────────────

  async connect(rtmpUrl: string): Promise<void> {
    const m = rtmpUrl.match(/^(rtmps?):\/\/([^/:]+)(?::(\d+))?\/(.*?)\/([^/]+)$/);
    if (!m) throw new Error(`Invalid RTMP URL: ${rtmpUrl}`);
    const [, scheme, host, portStr, app, streamKey] = m;
    const useTLS = scheme === "rtmps";
    const port = portStr ? parseInt(portStr, 10) : useTLS ? 443 : 1935;
    const tcUrl = `${scheme}://${host}:${port}/${app}`;

    logger.info({ host, port, app, useTLS }, "RtmpPublisher: connecting");

    const sock: tls.TLSSocket | net.Socket = useTLS
      ? tls.connect({ host, port, servername: host, rejectUnauthorized: true })
      : net.connect({ host, port });
    this.sock = sock;

    // Disable Nagle algorithm — critical for low-latency RTMP streaming.
    // Without this, the OS batches small writes into ~200ms windows, causing
    // visible FPS drops and audio/video drift on Facebook Live.
    sock.setNoDelay(true);

    // TCP keepalive — detects dead connections within ~30s instead of waiting
    // for the OS default (minutes), triggering faster reconnect on Facebook drops.
    sock.setKeepAlive(true, 15_000);

    await new Promise<void>((resolve, reject) => {
      (sock as tls.TLSSocket | net.Socket).once(
        useTLS ? "secureConnect" : "connect",
        resolve as () => void,
      );
      sock.once("error", reject);
    });

    sock.on("data", (d: Buffer) => this.onData(d));
    sock.on("error", (e: Error) => this.emit("error", e));
    sock.on("close", () => this.emit("close"));

    // ── Handshake ──
    const c1 = Buffer.alloc(1536, 0);
    c1.writeUInt32BE(Math.floor(Date.now() / 1000), 0);
    for (let i = 8; i < 1536; i++) c1[i] = (Math.random() * 256) | 0;
    sock.write(Buffer.concat([Buffer.from([3]), c1])); // C0 + C1

    const s0s1s2 = await this.readRaw(3073); // S0 + S1 + S2
    sock.write(s0s1s2.slice(1, 1537)); // C2 = echo of S1

    this.handshakeDone = true;
    logger.info({ host, port }, "RtmpPublisher: handshake complete");
    this.drainRtmp();

    // ── connect ──
    const txConnect = ++this.txId;
    const connectResult = await new Promise<unknown[]>((resolve, reject) => {
      this.pendingCmds.set(txConnect, { resolve, reject });
      sock.write(
        buildCmd(
          3,
          0,
          amfStr("connect"),
          amfNum(txConnect),
          amfObj([
            ["app", amfStr(app)],
            ["flashVer", amfStr("FMLE/3.0 (compatible; FMSc/1.0)")],
            ["tcUrl", amfStr(tcUrl)],
            ["fpad", amfBool(false)],
            ["capabilities", amfNum(239)],
            ["audioCodecs", amfNum(3575)],
            ["videoCodecs", amfNum(252)],
            ["videoFunction", amfNum(1)],
            ["objectEncoding", amfNum(0)],
          ]),
        ),
      );
    });
    logger.info({ connectResult }, "RtmpPublisher: connect OK");

    // Tell server our send chunk size
    const csBuf = Buffer.allocUnsafe(4);
    csBuf.writeUInt32BE(this.outChunkSize, 0);
    sock.write(encodeChunks(2, 1, 0, 0, csBuf, 128));

    // ── releaseStream / FCPublish ──
    sock.write(buildCmd(3, 0, amfStr("releaseStream"), amfNum(++this.txId), amfNull(), amfStr(streamKey)));
    sock.write(buildCmd(3, 0, amfStr("FCPublish"), amfNum(++this.txId), amfNull(), amfStr(streamKey)));

    // ── createStream ──
    const txCreate = ++this.txId;
    const createResult = await new Promise<unknown[]>((resolve, reject) => {
      this.pendingCmds.set(txCreate, { resolve, reject });
      sock.write(buildCmd(3, 0, amfStr("createStream"), amfNum(txCreate), amfNull()));
    });
    const newStreamId = createResult[3]; // [cmd, txId, null, streamId]
    this.publishStreamId = typeof newStreamId === "number" ? newStreamId : 1;
    logger.info({ publishStreamId: this.publishStreamId }, "RtmpPublisher: createStream OK");

    // ── publish ──
    await new Promise<void>((resolve, reject) => {
      this.publishResolve = resolve;
      this.publishReject = reject;
      const timer = setTimeout(() => {
        this.publishReject = null;
        this.publishResolve = null;
        reject(new Error("publish timed out — Facebook did not send NetStream.Publish.Start"));
      }, 15000);
      sock.write(
        buildCmd(
          4,
          this.publishStreamId,
          amfStr("publish"),
          amfNum(++this.txId),
          amfNull(),
          amfStr(streamKey),
          amfStr("live"),
        ),
      );
      // clear timer if resolved/rejected before timeout
      const orig = resolve;
      this.publishResolve = () => { clearTimeout(timer); orig(); };
    });

    this.publishReady = true;
    logger.info("RtmpPublisher: publish started — sending video/audio");
  }

  /** Forward one FLV tag as an RTMP message. tagType: 8=audio, 9=video, 18=script */
  writeFlvTag(tagType: number, timestamp: number, data: Buffer): void {
    if (!this.publishReady || !this.sock) return;
    try {
      this.sock.write(
        encodeChunks(4, tagType, this.publishStreamId, timestamp, data, this.outChunkSize),
      );
    } catch {
      // ignore write errors — socket close will be detected via 'close' event
    }
  }

  close(): void {
    this.publishReady = false;
    try {
      this.sock?.destroy();
    } catch {}
    this.sock = null;
  }

  // ── Raw byte reader (handshake only) ────────────────────────────────────────

  private readRaw(n: number): Promise<Buffer> {
    return new Promise((resolve) => {
      this.rawNeed = n;
      this.rawResolve = resolve;
      this.tryFlushRaw();
    });
  }

  private tryFlushRaw(): void {
    if (this.rawResolve && this.raw.length >= this.rawNeed) {
      const result = this.raw.slice(0, this.rawNeed);
      this.raw = this.raw.slice(this.rawNeed);
      const cb = this.rawResolve;
      this.rawResolve = null;
      this.rawNeed = 0;
      cb(result);
    }
  }

  private onData(d: Buffer): void {
    this.raw = Buffer.concat([this.raw, d]);

    // Track bytes received and send Window Acknowledgement when due.
    // Facebook's RTMP server sets a window size and expects periodic acks;
    // missing them causes the server to stall or drop the connection.
    this.bytesReceived += d.length;
    if (this.bytesReceived - this.lastAckSent >= this.windowAckSize) {
      this.lastAckSent = this.bytesReceived;
      if (this.sock && this.handshakeDone) {
        try {
          const ack = Buffer.allocUnsafe(4);
          // >>> 0 coerces to an *unsigned* 32-bit integer, preventing the
          // RangeError that writeUInt32BE throws when the value is negative
          // (JS bitwise ops are signed; & 0xffffffff overflows after 2^31-1 bytes).
          ack.writeUInt32BE(this.bytesReceived >>> 0, 0);
          this.sock.write(encodeChunks(2, 3 /* Acknowledgement */, 0, 0, ack, 128));
        } catch {
          // Never crash the data path on an ack write error — the stream
          // state is still valid; missed acks are tolerated by most servers.
        }
      }
    }

    if (!this.handshakeDone) {
      this.tryFlushRaw();
    } else {
      this.drainRtmp();
    }
  }

  // ── RTMP chunk parser ────────────────────────────────────────────────────────

  private drainRtmp(): void {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (!this.parseOneChunk()) break;
    }
  }

  private parseOneChunk(): boolean {
    let pos = 0;
    if (this.raw.length < 1) return false;

    // Basic header
    const b0 = this.raw[pos++];
    const fmt = (b0 >> 6) & 0x3;
    let csId = b0 & 0x3f;
    if (csId === 0) {
      if (this.raw.length < pos + 1) return false;
      csId = this.raw[pos++] + 64;
    } else if (csId === 1) {
      if (this.raw.length < pos + 2) return false;
      csId = this.raw[pos] + this.raw[pos + 1] * 256 + 64;
      pos += 2;
    }

    const prev = this.csStates.get(csId);
    let ts = 0, len = 0, type = 0, streamId = 0;

    if (fmt === 0) {
      if (this.raw.length < pos + 11) return false;
      ts = (this.raw[pos] << 16) | (this.raw[pos + 1] << 8) | this.raw[pos + 2]; pos += 3;
      len = (this.raw[pos] << 16) | (this.raw[pos + 1] << 8) | this.raw[pos + 2]; pos += 3;
      type = this.raw[pos++];
      streamId = this.raw.readUInt32LE(pos); pos += 4;
    } else if (fmt === 1) {
      if (this.raw.length < pos + 7) return false;
      const delta = (this.raw[pos] << 16) | (this.raw[pos + 1] << 8) | this.raw[pos + 2]; pos += 3;
      len = (this.raw[pos] << 16) | (this.raw[pos + 1] << 8) | this.raw[pos + 2]; pos += 3;
      type = this.raw[pos++];
      ts = (prev?.ts ?? 0) + delta;
      streamId = prev?.streamId ?? 0;
    } else if (fmt === 2) {
      if (this.raw.length < pos + 3) return false;
      const delta = (this.raw[pos] << 16) | (this.raw[pos + 1] << 8) | this.raw[pos + 2]; pos += 3;
      ts = (prev?.ts ?? 0) + delta;
      len = prev?.len ?? 0;
      type = prev?.type ?? 0;
      streamId = prev?.streamId ?? 0;
    } else {
      // fmt === 3: same as previous chunk on this stream
      ts = prev?.ts ?? 0;
      len = prev?.len ?? 0;
      type = prev?.type ?? 0;
      streamId = prev?.streamId ?? 0;
    }

    // Extended timestamp
    if ((ts & 0xffffff) === 0xffffff && fmt < 3) {
      if (this.raw.length < pos + 4) return false;
      ts = this.raw.readUInt32BE(pos); pos += 4;
    }

    // Chunk data
    const alreadyRead = prev?.collected
      ? prev.collected.reduce((acc, b) => acc + b.length, 0)
      : 0;
    const remaining = len - alreadyRead;
    const toRead = Math.min(remaining, this.serverChunkSize);
    if (this.raw.length < pos + toRead) return false;

    const chunk = this.raw.slice(pos, pos + toRead);
    pos += toRead;
    this.raw = this.raw.slice(pos);

    const collected = [...(prev?.collected ?? []), chunk];
    this.csStates.set(csId, { type, streamId, ts, len, collected });

    const total = collected.reduce((acc, b) => acc + b.length, 0);
    if (total >= len) {
      const msg = Buffer.concat(collected).slice(0, len);
      this.csStates.set(csId, { type, streamId, ts, len, collected: [] });
      this.handleMessage(type, streamId, ts, msg);
    }

    return true;
  }

  private handleMessage(type: number, streamId: number, ts: number, data: Buffer): void {
    if (type === 1) {
      // Set Chunk Size
      this.serverChunkSize = data.readUInt32BE(0) & 0x7fffffff;
      logger.debug({ serverChunkSize: this.serverChunkSize }, "RtmpPublisher: server set chunk size");
    } else if (type === 4) {
      // User Control — ignore
    } else if (type === 5) {
      // Window Acknowledgement Size — update our window tracker so we send
      // acks at the correct cadence the server expects.
      if (data.length >= 4) {
        this.windowAckSize = data.readUInt32BE(0);
        logger.debug({ windowAckSize: this.windowAckSize }, "RtmpPublisher: window ack size updated");
      }
    } else if (type === 6) {
      // Set Peer Bandwidth — ignore
    } else if (type === 20) {
      // AMF0 Command
      const vals = decAmfList(data);
      const cmd = vals[0] as string;
      const txId = vals[1] as number;

      logger.debug({ cmd, txId, vals }, "RtmpPublisher: received AMF command");

      if (cmd === "_result" || cmd === "_error") {
        const pending = this.pendingCmds.get(txId);
        if (pending) {
          this.pendingCmds.delete(txId);
          if (cmd === "_error") {
            pending.reject(new Error(`RTMP _error: ${JSON.stringify(vals)}`));
          } else {
            pending.resolve(vals);
          }
        }
      } else if (cmd === "onStatus") {
        const status = vals[3] as Record<string, unknown> | null;
        const code = status?.code as string | undefined;
        logger.info({ code, streamId }, "RtmpPublisher: onStatus");
        if (code === "NetStream.Publish.Start" && this.publishResolve) {
          const r = this.publishResolve;
          this.publishResolve = null;
          this.publishReject = null;
          r();
        } else if (
          (code === "NetStream.Publish.BadName" ||
            code === "NetStream.Publish.Denied" ||
            code === "NetStream.Failed") &&
          this.publishReject
        ) {
          const r = this.publishReject;
          this.publishResolve = null;
          this.publishReject = null;
          r(new Error(`Facebook rejected publish: ${code}`));
        }
      } else if (cmd === "onFCPublish") {
        // ok, ignore
      } else if (cmd === "onBWDone") {
        // ok, ignore
      }
    }
  }
}
