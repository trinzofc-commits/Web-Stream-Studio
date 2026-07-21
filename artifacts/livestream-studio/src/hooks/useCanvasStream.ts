/**
 * useCanvasStream
 * Captures the scene canvas + audio mix and streams to the backend over a
 * single binary WebSocket.
 *
 * ── Encoding strategy (server-side CPU, not user device) ──────────────────
 *  Instead of a manual toBlob(JPEG) loop (software JPEG encode on device CPU
 *  at 15 fps), we use:
 *
 *    canvas.captureStream(fps)  →  hardware-accelerated video track (GPU)
 *    compositor.getAudioStream()  →  Web Audio mix
 *    combined MediaStream  →  MediaRecorder (VP8/VP9/H264+Opus, hardware)
 *    250 ms WebM chunks  →  tagged 0x01 over WebSocket  →  FFmpeg on server
 *
 *  The user's CPU does virtually nothing for encoding. The Replit server
 *  FFmpeg transcodes WebM→libx264 for RTMP — that's server CPU, not device.
 *
 * ── Tagged binary protocol ─────────────────────────────────────────────────
 *  byte 0 = message type:
 *    0x00  handshake  — JSON: { hasAudio, mimeType, combined }
 *    0x01  combined WebM chunk (video + optional audio from MediaRecorder)
 *    0x02  (reserved — was separate audio pipe; no longer used in combined mode)
 *  Legacy: if first byte is 0xFF (JPEG SOI) → untagged JPEG video frame (compat)
 */
import { useEffect, useRef, useCallback } from 'react';
import { StreamCompositor } from '@/lib/streamCompositor';

type Source = {
  id: number;
  type: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity?: number;
  rotation?: number;
  visible: boolean;
  sortOrder: number;
  settings?: Record<string, any> | null;
};

function getWsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

/**
 * Frame-rate hint passed to captureStream().
 * The browser uses this as a target — actual FPS is hardware-dependent.
 * Must match INPUT_FPS in streamManager.ts on the backend.
 */
const TARGET_FPS = 30;

/** Prefer hardware-accelerated codecs first; browser picks the first supported. */
const VIDEO_MIME_PREFERENCES_AUDIO = [
  'video/webm;codecs=h264,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];
const VIDEO_MIME_PREFERENCES_NO_AUDIO = [
  'video/webm;codecs=h264',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** WebM chunk interval in ms for MediaRecorder. */
const CHUNK_TIMESLICE_MS = 250;

/** Target video bitrate in kbps sent to MediaRecorder (server FFmpeg re-encodes anyway). */
const VIDEO_BITRATE_KBPS = 3_000;

/** Prefix a 1-byte tag in front of an ArrayBuffer. */
function taggedMessage(tag: number, payload: ArrayBuffer): ArrayBuffer {
  const out = new Uint8Array(1 + payload.byteLength);
  out[0] = tag;
  out.set(new Uint8Array(payload), 1);
  return out.buffer;
}

export function useCanvasStream(
  sources: Source[],
  streamState: string | undefined,
  canvasWidth: number,
  canvasHeight: number,
  consumePendingTransition?: () => { type: string; durationMs: number } | null,
) {
  const compositorRef = useRef<StreamCompositor | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const isStreamingRef = useRef(false);

  // Keep compositor in sync with sources; apply pending transitions when sources change
  const consumeRef = useRef(consumePendingTransition);
  consumeRef.current = consumePendingTransition;

  useEffect(() => {
    const compositor = compositorRef.current;
    if (!compositor) return;
    const transition = consumeRef.current?.();
    if (transition && transition.type !== 'cut') {
      compositor.beginTransition(sources, transition.type, transition.durationMs);
    } else {
      compositor.updateSources(sources);
    }
  }, [sources]);

  const stopStream = useCallback(() => {
    if (!isStreamingRef.current) return;
    isStreamingRef.current = false;

    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try { recorderRef.current.stop(); } catch {}
    }
    recorderRef.current = null;

    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;

    compositorRef.current?.stop();
    compositorRef.current = null;
  }, []);

  const startStream = useCallback(async (currentSources: Source[], w: number, h: number) => {
    if (isStreamingRef.current) return;
    isStreamingRef.current = true;

    try {
      // ── 1. Build compositor & start canvas render loop ─────────────────────
      const compositor = new StreamCompositor(w, h);
      compositor.updateSources(currentSources);
      compositor.start();
      // Resume AudioContext inside user-gesture call stack (required by browsers)
      compositor.resumeAudioContext();
      compositorRef.current = compositor;

      // Give AudioContext a moment to wire elements
      await new Promise((r) => setTimeout(r, 80));

      // ── 2. Build the combined MediaStream ──────────────────────────────────
      //   Video: captureStream() — browser uses GPU/hardware path, ~0 device CPU
      //   Audio: Web Audio destination mix (all audio sources blended)
      const canvasEl = compositor.getCanvas();
      const canvasStream = canvasEl.captureStream(TARGET_FPS);

      const audioStream = compositor.getAudioStream();
      const hasAudio = audioStream != null && audioStream.getAudioTracks().length > 0;

      const combinedStream = hasAudio
        ? new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioStream!.getAudioTracks(),
          ])
        : canvasStream;

      // ── 3. Pick best supported MIME type ────────────────────────────────────
      const prefs = hasAudio ? VIDEO_MIME_PREFERENCES_AUDIO : VIDEO_MIME_PREFERENCES_NO_AUDIO;
      const mimeType = prefs.find((m) => {
        try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
      }) ?? 'video/webm';

      // ── 4. Open WebSocket ───────────────────────────────────────────────────
      const ws = new WebSocket(getWsUrl('/ws?role=stream'));
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('WebSocket failed to connect'));
        setTimeout(() => reject(new Error('WebSocket timeout')), 8000);
      });

      // ── 5. Send handshake ───────────────────────────────────────────────────
      //   Server uses mimeType to set the correct FFmpeg demuxer and knows
      //   whether audio tracks are embedded in the WebM chunks.
      const handshakeBytes = new TextEncoder().encode(
        JSON.stringify({ hasAudio, mimeType, combined: true }),
      );
      const handshake = new Uint8Array(1 + handshakeBytes.length);
      handshake[0] = 0x00;
      handshake.set(handshakeBytes, 1);
      ws.send(handshake.buffer);

      ws.onclose = () => { if (isStreamingRef.current) stopStream(); };
      ws.onerror = () => { if (isStreamingRef.current) stopStream(); };

      // ── 6. Start MediaRecorder → tag 0x01 chunks → WebSocket ───────────────
      //   All encoding (video + audio) happens here in the browser's native
      //   codec path — uses hardware encoder on most devices.
      //   The heavy work (libx264 transcode for RTMP) is on the server.
      const recorder = new MediaRecorder(combinedStream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BITRATE_KBPS * 1000,
        ...(hasAudio ? { audioBitsPerSecond: 128_000 } : {}),
      });

      recorder.ondataavailable = async (e) => {
        if (!e.data.size || ws.readyState !== WebSocket.OPEN) return;
        const buf = await e.data.arrayBuffer();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(taggedMessage(0x01, buf));
        }
      };

      recorder.onerror = () => {
        if (isStreamingRef.current) stopStream();
      };

      recorder.start(CHUNK_TIMESLICE_MS);
      recorderRef.current = recorder;

    } catch {
      stopStream();
    }
  }, [stopStream]);

  // Keep stable refs so the effect below doesn't re-run on every render
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const wRef = useRef(canvasWidth);
  wRef.current = canvasWidth;
  const hRef = useRef(canvasHeight);
  hRef.current = canvasHeight;

  useEffect(() => {
    const active = streamState === 'connecting' || streamState === 'live';
    if (active && !isStreamingRef.current) {
      startStream(sourcesRef.current, wRef.current, hRef.current);
    } else if (!active && isStreamingRef.current) {
      stopStream();
    }
  }, [streamState, startStream, stopStream]);

  // Cleanup on unmount
  useEffect(() => () => stopStream(), [stopStream]);
}
