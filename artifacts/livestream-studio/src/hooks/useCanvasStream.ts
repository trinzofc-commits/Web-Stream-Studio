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
  opacity: number;
  rotation: number;
  visible: boolean;
  sortOrder: number;
  settings: Record<string, any> | null;
};

function getWsUrl(path: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}${path}`;
}

/** Target frame rate for JPEG capture. Lower = less CPU on client. */
const TARGET_FPS = 24;
/** JPEG quality 0–1. Lower = less CPU + bandwidth, small visual difference. */
const JPEG_QUALITY = 0.75;
/**
 * Encode resolution sent to server. Canvas may be 1920×1080 but toBlob()
 * at that size takes 500ms+ on mobile — scaling to 1280×720 first makes
 * toBlob() ~4× faster, letting frames actually arrive at 24 fps.
 */
const ENCODE_WIDTH = 854;
const ENCODE_HEIGHT = 480;

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
      // We scale the compositor canvas down to ENCODE_WIDTH×ENCODE_HEIGHT before
      // calling toBlob() — this makes toBlob() ~4× faster on mobile (1280×720
      // is fast; 1920×1080 can take 500ms+ per frame, starving FFmpeg).
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
