/**
 * useCanvasStream
 * Watches stream state and, when streaming starts, captures the scene canvas
 * via StreamCompositor → MediaRecorder → WebSocket binary → backend FFmpeg stdin.
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

function getBestMimeType(): string {
  const candidates = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';
}

export function useCanvasStream(
  sources: Source[],
  streamState: string | undefined,
  canvasWidth: number,
  canvasHeight: number,
) {
  const compositorRef = useRef<StreamCompositor | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const isStreamingRef = useRef(false);

  // Keep compositor in sync with sources at all times
  useEffect(() => {
    compositorRef.current?.updateSources(sources);
  }, [sources]);

  const stopStream = useCallback(() => {
    if (!isStreamingRef.current) return;
    isStreamingRef.current = false;

    try { recorderRef.current?.stop(); } catch {}
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
      // 1. Build compositor with correct canvas dimensions and start rendering
      const compositor = new StreamCompositor(w, h);
      compositor.updateSources(currentSources);
      compositor.start();
      compositorRef.current = compositor;

      // 2. Get canvas MediaStream (video only — audio handled server-side)
      const canvasStream = compositor.captureStream(30);

      // 3. Open binary WebSocket to backend BEFORE starting MediaRecorder
      const ws = new WebSocket(getWsUrl('/ws?role=stream'));
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => {
          console.log('[stream] WebSocket connected to', ws.url);
          resolve();
        };
        ws.onerror = (e) => {
          console.error('[stream] WebSocket error', e);
          reject(new Error('WebSocket failed to connect'));
        };
        ws.onclose = (e) => {
          console.warn('[stream] WebSocket closed before open', e.code, e.reason);
        };
        setTimeout(() => reject(new Error('WebSocket timeout')), 8000);
      });

      // 4. Create MediaRecorder and wire data → WebSocket
      const mimeType = getBestMimeType();
      const recorder = new MediaRecorder(canvasStream, {
        mimeType,
        videoBitsPerSecond: 2_500_000, // match FFmpeg target bitrate
      });
      recorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0 && ws.readyState === WebSocket.OPEN) {
          ws.send(e.data);
        }
      };

      recorder.onerror = () => stopStream();

      ws.onclose = () => {
        if (isStreamingRef.current) stopStream();
      };
      ws.onerror = () => {
        if (isStreamingRef.current) stopStream();
      };

      // 5. Start encoding — 100ms chunks to minimize pipeline latency
      recorder.start(100);
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
