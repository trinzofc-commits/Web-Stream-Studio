import React from 'react';
import { useGetStreamStatus, useStartStream, useStopStream, useGetStreamStatsSummary } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Play, Square, Settings2, RefreshCw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';

export function BottomBar({ onSettingsOpen }: { onSettingsOpen: () => void }) {
  const queryClient = useQueryClient();
  const { data: streamStatus } = useGetStreamStatus({
    query: { refetchInterval: 1000 }
  });
  const { data: statsSummary } = useGetStreamStatsSummary();

  const startStream = useStartStream();
  const stopStream = useStopStream();

  const isLive = streamStatus?.state === 'live';
  const isConnecting = streamStatus?.state === 'connecting';
  const isError = streamStatus?.state === 'error';

  const handleStreamToggle = () => {
    if (isLive || isConnecting) {
      stopStream.mutate(undefined, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['streamStatus'] })
      });
    } else {
      startStream.mutate({ data: { rtmpUrl: "rtmp://mock", streamKey: "mock-key" } }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['streamStatus'] })
      });
    }
  };

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex h-12 bg-card border-t border-border items-center justify-between px-4">
      {/* Left side stats */}
      <div className="flex items-center gap-6 text-[11px] font-mono text-muted-foreground flex-1">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${streamStatus?.droppedFrames ? 'bg-destructive' : 'bg-green-500'}`} />
          <span>Dropped Frames (Network): {streamStatus?.droppedFrames || 0} ({(streamStatus?.droppedFrames && streamStatus?.totalFrames ? ((streamStatus.droppedFrames / streamStatus.totalFrames) * 100).toFixed(1) : '0.0')}%)</span>
        </div>
        
        {isLive && streamStatus?.uptimeSeconds !== undefined && (
          <div className="flex items-center gap-1.5">
            <span className="text-foreground">LIVE:</span>
            <span>{formatUptime(streamStatus.uptimeSeconds)}</span>
          </div>
        )}
        
        <div className="flex items-center gap-1.5">
          <span className="text-foreground">REC:</span>
          <span>00:00:00</span>
        </div>

        <div className="flex gap-4 ml-auto mr-4 text-right">
          <span>CPU: {streamStatus?.cpuUsage?.toFixed(1) || '2.4'}%, {streamStatus?.fps || 60} fps</span>
          <span>{streamStatus?.networkKbps || 0} kb/s</span>
        </div>
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="h-8 text-xs font-medium" onClick={onSettingsOpen}>
          Settings
        </Button>
        <div className="w-px h-6 bg-border mx-1" />
        
        <Button 
          variant={isLive || isConnecting ? "destructive" : "default"} 
          size="sm" 
          className={`h-8 min-w-[120px] font-bold ${!isLive && !isConnecting && 'bg-primary text-primary-foreground hover:bg-primary/90'}`}
          onClick={handleStreamToggle}
          disabled={startStream.isPending || stopStream.isPending}
        >
          {isLive ? (
            <><Square className="w-4 h-4 mr-2 fill-current" /> Stop Stream</>
          ) : isConnecting ? (
            <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Connecting...</>
          ) : (
            <><Play className="w-4 h-4 mr-2 fill-current" /> Start Stream</>
          )}
        </Button>
      </div>
    </div>
  );
}
