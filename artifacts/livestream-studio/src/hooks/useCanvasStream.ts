/**
 * useCanvasStream
 * Watches stream state and, when streaming starts, captures the scene canvas
 * via StreamCompositor → JPEG frames → WebSocket binary → backend FFmpeg stdin.
 *
 * Server-side encoding: instead of MediaRecorder (VP8 on client CPU), we send
 * raw JPEG frames over WebSocket and let FFmpeg on the server encode H.264.
 * This cuts mobile CPU usage significantly — the phone only composites canvas,
 * it never runs a software video encoder.
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
 * Target frame rate for JPEG capture sent to the server.
 * Must match INPUT_FPS in streamManager.ts on the backend.
 *
 * 15 fps is plenty for livestreaming and cuts WebSocket bandwidth ~40% vs 24 fps.
 * The compositor still renders the local preview at 30 fps — only the data sent
 * to the server is reduced.
 */
const TARGET_FPS = 15;

/**
 * JPEG quality 0–1 for frames sent over WebSocket to FFmpeg.
 * 0.6 keeps ~90% of perceived quality vs 0.75 but is ~35% smaller on the wire.
 */
const JPEG_QUALITY = 0.6;

/**
 * Maximum long-side pixels for the encode canvas sent to the server.
 * 1280 px produces 1280×720 (landscape) for standard 16:9 content — exactly
 * 720p. toBlob() at this size is fast on modern devices and gives Facebook Live
 * enough detail while keeping WebSocket bandwidth stable.
 *
 * Estimated WebSocket throughput at these settings:
 *   15 fps × ~45 KB/frame ≈ 675 KB/s ≈ 5 Mbps  (well within stable range)
 */
const MAX_ENCODE_LONG_SIDE = 1280;

/** Calculate encode canvas size that preserves aspect ratio and ensures even
 *  pixel counts (required for H.264 yuv420p). */
function calcEncodeSize(w: number, h: number): [number, number] {
  let ew: number, eh: number;
  if (w >= h) {
    ew = Math.min(w, MAX_ENCODE_LONG_SIDE);
    eh = Math.round(ew * h / w);
  } else {
    eh = Math.min(h, MAX_ENCODE_LONG_SIDE);
    ew = Math.round(eh * w / h);
  }
  // H.264 yuv420p requires even dimensions
  ew = ew % 2 === 0 ? ew : ew - 1;
  eh = eh % 2 === 0 ? eh : eh - 1;
  return [ew, eh];
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

    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;

    compositorRef.current?.stop();
    compositorRef.current = null;
  }, []);

  const startStream = useCallback(async (currentSources: Source[], w: number, h: number) => {
    if (isStreamingRef.current) return;
    isStreamingRef.current = true;

    try {
      // 1. Build compositor and start rendering
      const compositor = new StreamCompositor(w, h);
      compositor.updateSources(currentSources);
      compositor.start();
      compositorRef.current = compositor;

      // 2. Open binary WebSocket to backend
      const ws = new WebSocket(getWsUrl('/ws?role=stream'));
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          console.log('[stream] WebSocket connected (server-side encoding mode)');
          resolve();
        };
        ws.onerror = (e) => {
          console.error('[stream] WebSocket error', e);
          reject(new Error('WebSocket failed to connect'));
        };
        setTimeout(() => reject(new Error('WebSocket timeout')), 8000);
      });

      ws.onclose = () => { if (isStreamingRef.current) stopStream(); };
      ws.onerror = () => { if (isStreamingRef.current) stopStream(); };

      // 3. Capture JPEG frames from canvas and pipe to server.
      // We scale the compositor canvas down to at most 1280px on the long side
      // while preserving aspect ratio, so portrait/landscape are both correct.
      // toBlob() at full 1920×1080 takes 500ms+ on mobile — this makes it ~4× faster.
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
        // Scale down: draw compositor canvas → smaller encode canvas
        encCtx.drawImage(srcCanvas, 0, 0, ENCODE_WIDTH, ENCODE_HEIGHT);
        encCanvas.toBlob(
          (blob) => {
            capturing = false;
            if (!blob || ws.readyState !== WebSocket.OPEN) return;
            blob.arrayBuffer().then((buf) => {
              if (ws.readyState === WebSocket.OPEN) ws.send(buf);
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

  // React to stream state changes
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
