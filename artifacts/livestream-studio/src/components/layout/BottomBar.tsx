import React, { useEffect, useRef, useState } from 'react';
import {
  useGetStreamStatus,
  useStartStream,
  useStopStream,
  useGetStreamConfig,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Play, Square, RefreshCw, Server } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useStudio } from '@/context/StudioContext';

interface Props {
  onSettingsOpen: () => void;
}

export function BottomBar({ onSettingsOpen }: Props) {
  const queryClient = useQueryClient();
  const { activeSceneId } = useStudio();

  const { data: streamStatus } = useGetStreamStatus({ query: { refetchInterval: 1000 } });
  const { data: streamConfig } = useGetStreamConfig();

  const startStream = useStartStream();
  const stopStream = useStopStream();
  const [serverStreaming, setServerStreaming] = useState(false);

  // REC timer — tracks time since stream went live
  const [recSeconds, setRecSeconds] = useState(0);
  const recIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isLive = streamStatus?.state === 'live';
  const isConnecting = streamStatus?.state === 'connecting';
  const isError = streamStatus?.state === 'error';

  useEffect(() => {
    if (isLive) {
      recIntervalRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } else {
      if (recIntervalRef.current) {
        clearInterval(recIntervalRef.current);
        recIntervalRef.current = null;
      }
      if (!isLive) setRecSeconds(0);
    }
    return () => {
      if (recIntervalRef.current) clearInterval(recIntervalRef.current);
    };
  }, [isLive]);

  const formatTime = (totalSeconds: number) => {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  };

  const handleStreamToggle = () => {
    if (isLive || isConnecting) {
      stopStream.mutate(undefined, {
        onSuccess: () => {
          setServerStreaming(false);
          queryClient.invalidateQueries({ queryKey: ['/api/stream/status'] });
          toast.info('Stream stopped');
        },
        onError: () => toast.error('Failed to stop stream'),
      });
    } else {
      if (!streamConfig?.rtmpUrl || !streamConfig?.streamKey) {
        toast.error('Configure RTMP URL and Stream Key in Settings first', {
          action: { label: 'Settings', onClick: onSettingsOpen },
        });
        return;
      }
      setServerStreaming(false);
      startStream.mutate(
        { data: { rtmpUrl: streamConfig.rtmpUrl, streamKey: streamConfig.streamKey } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['/api/stream/status'] });
            toast.success('Stream starting…');
          },
          onError: (err: any) => toast.error(err?.message ?? 'Failed to start stream'),
        }
      );
    }
  };

  /** Start server-side compositing — streams video files directly without browser rendering */
  const handleServerStream = async () => {
    if (isLive || isConnecting) {
      stopStream.mutate(undefined, {
        onSuccess: () => {
          setServerStreaming(false);
          queryClient.invalidateQueries({ queryKey: ['/api/stream/status'] });
          toast.info('Stream stopped');
        },
        onError: () => toast.error('Failed to stop stream'),
      });
      return;
    }
    if (!streamConfig?.rtmpUrl || !streamConfig?.streamKey) {
      toast.error('Configure RTMP URL and Stream Key in Settings first', {
        action: { label: 'Settings', onClick: onSettingsOpen },
      });
      return;
    }
    if (!activeSceneId) {
      toast.error('Select a scene first');
      return;
    }
    try {
      const res = await fetch('/api/stream/start-server', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sceneId: activeSceneId,
          rtmpUrl: streamConfig.rtmpUrl,
          streamKey: streamConfig.streamKey,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as any).error ?? 'Failed to start server stream');
      }
      setServerStreaming(true);
      queryClient.invalidateQueries({ queryKey: ['/api/stream/status'] });
      toast.success('Server-side stream starting — tab can now be closed');
    } catch (err: any) {
      toast.error(err?.message ?? 'Failed to start server stream');
    }
  };

  const droppedFrames = streamStatus?.droppedFrames ?? 0;
  const totalFrames = streamStatus?.totalFrames ?? 0;
  const dropPct = totalFrames > 0 ? ((droppedFrames / totalFrames) * 100).toFixed(1) : '0.0';
  const fps = streamStatus?.fps ?? (isLive ? 30 : 0);
  const kbps = streamStatus?.networkKbps ?? 0;
  const cpuRaw = streamStatus?.cpuUsage;

  return (
    <div className="flex h-12 bg-card border-t border-border items-center justify-between px-4 shrink-0">
      {/* Left: stats */}
      <div className="flex items-center gap-5 text-[11px] font-mono text-muted-foreground flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${droppedFrames > 0 ? 'bg-destructive' : 'bg-green-500'}`} />
          <span>
            Dropped: {droppedFrames} ({dropPct}%)
          </span>
        </div>

        {isLive && (
          <div className="flex items-center gap-1">
            <span className="text-green-400 font-bold">LIVE</span>
            <span className="text-foreground ml-0.5">{formatTime(recSeconds)}</span>
          </div>
        )}

        <div className="flex items-center gap-1">
          <span className="text-muted-foreground/60">REC:</span>
          <span className={isLive ? 'text-red-400' : ''}>{formatTime(recSeconds)}</span>
        </div>

        {isError && (
          <span className="text-destructive truncate max-w-[200px]">
            Error: {streamStatus?.errorMessage ?? 'FFmpeg error'}
          </span>
        )}

        <div className="flex gap-3 ml-auto text-right">
          {cpuRaw != null && <span>CPU: {cpuRaw.toFixed(1)}%</span>}
          <span>{fps} fps</span>
          <span>{kbps > 0 ? `${kbps.toFixed(0)} kb/s` : '0 kb/s'}</span>
        </div>
      </div>

      {/* Right: controls */}
      <div className="flex items-center gap-2 ml-4">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs font-medium"
          onClick={onSettingsOpen}
        >
          Settings
        </Button>
        <div className="w-px h-6 bg-border" />

        {/* Server-side stream button — streams video files without browser rendering */}
        <Button
          variant={isLive && serverStreaming ? 'destructive' : 'outline'}
          size="sm"
          className="h-8 px-3 font-medium text-xs"
          onClick={handleServerStream}
          disabled={stopStream.isPending || (!isLive && !isConnecting && startStream.isPending)}
          title="Stream directly from server (no browser needed — video files only)"
        >
          {isLive && serverStreaming ? (
            <><Square className="w-3.5 h-3.5 mr-1.5 fill-current" /> Stop</>
          ) : isConnecting && serverStreaming ? (
            <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /></>
          ) : (
            <><Server className="w-3.5 h-3.5 mr-1.5" /> Server</>
          )}
        </Button>

        <Button
          variant={isLive && !serverStreaming ? 'destructive' : 'default'}
          size="sm"
          className="h-8 min-w-[130px] font-bold"
          onClick={handleStreamToggle}
          disabled={startStream.isPending || stopStream.isPending}
        >
          {isLive && !serverStreaming ? (
            <><Square className="w-3.5 h-3.5 mr-2 fill-current" /> Stop Stream</>
          ) : isConnecting && !serverStreaming ? (
            <><RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" /> Connecting…</>
          ) : isLive && serverStreaming ? (
            <><Play className="w-3.5 h-3.5 mr-2 fill-current" /> Start Stream</>
          ) : (
            <><Play className="w-3.5 h-3.5 mr-2 fill-current" /> Start Stream</>
          )}
        </Button>
      </div>
    </div>
  );
}
