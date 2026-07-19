/**
 * useCanvasStream
 * Captures the scene canvas (video) + audio mix via StreamCompositor and
 * streams both to the backend over a single binary WebSocket.
 *
 * ── Tagged binary protocol ─────────────────────────────────────────────────
 *  byte 0 = message type:
 *    0x00  handshake  — JSON payload: { hasAudio: boolean }
 *    0x01  video      — JPEG frame bytes
 *    0x02  audio      — WebM/Opus chunk bytes (from MediaRecorder)
 *  Legacy: if first byte is 0xFF (JPEG SOI) the message is an untagged video
 *  frame sent by an older client — the backend handles this for compat.
 *
 * ── Audio path ─────────────────────────────────────────────────────────────
 *  AudioContext → [audio/audioPlaylist elements] → MediaStreamDestination
 *  → MediaRecorder (opus, 250 ms chunks) → tagged 0x02 → WebSocket → FFmpeg
 *
 * ── Video path ─────────────────────────────────────────────────────────────
 *  compositor canvas → scale to 720p → toBlob JPEG → tagged 0x01 → WebSocket
 *  → FFmpeg (15 fps input)
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

/** Target frame rate for JPEG capture sent to the server.
 *  Must match INPUT_FPS in streamManager.ts on the backend. */
const TARGET_FPS = 15;

/** JPEG quality sent over WebSocket to FFmpeg. */
const JPEG_QUALITY = 0.6;

/** Max long-side pixels for the encoded frame (720p = 1280 long side for 16:9). */
const MAX_ENCODE_LONG_SIDE = 1280;

/** Audio chunk interval in ms for MediaRecorder. */
const AUDIO_TIMESLICE_MS = 250;

function calcEncodeSize(w: number, h: number): [number, number] {
  let ew: number, eh: number;
  if (w >= h) {
    ew = Math.min(w, MAX_ENCODE_LONG_SIDE);
    eh = Math.round(ew * h / w);
  } else {
    eh = Math.min(h, MAX_ENCODE_LONG_SIDE);
    ew = Math.round(eh * w / h);
  }
  ew = ew % 2 === 0 ? ew : ew - 1;
  eh = eh % 2 === 0 ? eh : eh - 1;
  return [ew, eh];
}

/** Prefix a byte tag in front of an ArrayBuffer without copying the payload. */
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
) {
  const compositorRef = useRef<StreamCompositor | null>(null);
  const captureIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const isStreamingRef = useRef(false);

  // Keep compositor in sync with sources at all times
  useEffect(() => {
    compositorRef.current?.updateSources(sources);
  }, [sources]);

  const stopStream = useCallback(() => {
    if (!isStreamingRef.current) return;
    isStreamingRef.current = false;

    if (captureIntervalRef.current !== null) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }

    if (audioRecorderRef.current && audioRecorderRef.current.state !== 'inactive') {
      try { audioRecorderRef.current.stop(); } catch {}
    }
    audioRecorderRef.current = null;

    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;

    compositorRef.current?.stop();
    compositorRef.current = null;
  }, []);

  const startStream = useCallback(async (currentSources: Source[], w: number, h: number) => {
    if (isStreamingRef.current) return;
    isStreamingRef.current = true;

    try {
      // 1. Build compositor and start render loop
      const compositor = new StreamCompositor(w, h);
      compositor.updateSources(currentSources);
      compositor.start();
      // Resume AudioContext — must be called inside a user-gesture call stack
      compositor.resumeAudioContext();
      compositorRef.current = compositor;

      // 2. Probe audio availability before opening WebSocket
      //    (compositor needs a moment to wire audio elements)
      await new Promise((r) => setTimeout(r, 50));
      const audioStream = compositor.getAudioStream();
      const hasAudio = audioStream != null;

      // 3. Open binary WebSocket to backend
      const ws = new WebSocket(getWsUrl('/ws?role=stream'));
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('WebSocket failed to connect'));
        setTimeout(() => reject(new Error('WebSocket timeout')), 8000);
      });

      // 4. Send handshake immediately so the server knows audio is coming
      //    before it spawns FFmpeg (RTMP connect takes 2–5 s — plenty of time)
      const handshakeJson = JSON.stringify({ hasAudio });
      const handshakeBytes = new TextEncoder().encode(handshakeJson);
      const handshake = new Uint8Array(1 + handshakeBytes.length);
      handshake[0] = 0x00;
      handshake.set(handshakeBytes, 1);
      ws.send(handshake.buffer);

      ws.onclose = () => { if (isStreamingRef.current) stopStream(); };
      ws.onerror = () => { if (isStreamingRef.current) stopStream(); };

      // 5. Start audio MediaRecorder — sends 0x02-tagged WebM/Opus chunks
      if (hasAudio && audioStream) {
        const mimeType =
          MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
          MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';

        if (mimeType) {
          const recorder = new MediaRecorder(audioStream, {
            mimeType,
            audioBitsPerSecond: 128_000,
          });
          recorder.ondataavailable = async (e) => {
            if (!e.data.size || ws.readyState !== WebSocket.OPEN) return;
            const buf = await e.data.arrayBuffer();
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(taggedMessage(0x02, buf));
            }
          };
          recorder.start(AUDIO_TIMESLICE_MS);
          audioRecorderRef.current = recorder;
        }
      }

      // 6. Capture JPEG frames from canvas, tagged with 0x01
      const [ENCODE_WIDTH, ENCODE_HEIGHT] = calcEncodeSize(w, h);
      const srcCanvas = compositor.getCanvas();
      const encCanvas = document.createElement('canvas');
      encCanvas.width = ENCODE_WIDTH;
      encCanvas.height = ENCODE_HEIGHT;
      const encCtx = encCanvas.getContext('2d')!;
      let capturing = false;

      captureIntervalRef.current = setInterval(() => {
        if (capturing || !isStreamingRef.current) return;
        if (ws.readyState !== WebSocket.OPEN) return;

        capturing = true;
        encCtx.drawImage(srcCanvas, 0, 0, ENCODE_WIDTH, ENCODE_HEIGHT);
        encCanvas.toBlob(
          (blob) => {
            capturing = false;
            if (!blob || ws.readyState !== WebSocket.OPEN) return;
            blob.arrayBuffer().then((buf) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(taggedMessage(0x01, buf));
              }
            }).catch(() => {});
          },
          'image/jpeg',
          JPEG_QUALITY,
        );
      }, Math.floor(1000 / TARGET_FPS));

    } catch {
      stopStream();
    }
  }, [stopStream]);

  // Track latest values for the effect below without triggering re-runs
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
