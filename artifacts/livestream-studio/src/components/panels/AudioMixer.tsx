import React, { useEffect, useState, useRef } from 'react';
import { useStudio } from '@/context/StudioContext';
import { useListAudioTracks, useCreateAudioTrack, useUpdateAudioTrack, useDeleteAudioTrack, getListAudioTracksQueryKey } from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Plus, Settings2, Trash2 } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { useQueryClient } from '@tanstack/react-query';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function AudioMixer() {
  const { activeProjectId } = useStudio();
  const queryClient = useQueryClient();

  const { data: tracks = [] } = useListAudioTracks(
    { query: { enabled: true } } // Normally we might pass projectId, but API doesn't take it
  );

  const createTrack = useCreateAudioTrack();
  const updateTrack = useUpdateAudioTrack();
  const deleteTrack = useDeleteAudioTrack();

  const handleAddTrack = () => {
    createTrack.mutate({
      data: {
        name: `Audio Track ${tracks.length + 1}`,
        volume: 100,
        gain: 0,
        balance: 0,
      }
    }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAudioTracksQueryKey() })
    });
  };

  const handleUpdate = (id: number, data: any) => {
    updateTrack.mutate({ id, data }, {
      onSuccess: (updated) => {
        queryClient.setQueryData(getListAudioTracksQueryKey(), (old: any) =>
          old ? old.map((t: any) => (t.id === id ? updated : t)) : old
        );
      }
    });
  };

  const handleDelete = (id: number) => {
    deleteTrack.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAudioTracksQueryKey() })
    });
  };

  return (
    <div className="flex h-full w-full bg-card border-r border-border overflow-x-auto">
      <div className="flex flex-col items-center justify-center min-w-[60px] border-r border-border bg-muted/10 p-2">
        <Button variant="ghost" size="icon" onClick={handleAddTrack} title="Add Audio Track">
          <Plus className="w-5 h-5" />
        </Button>
      </div>

      {tracks.map((track) => (
        <AudioStrip key={track.id} track={track} onUpdate={handleUpdate} onDelete={handleDelete} />
      ))}
      {tracks.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4">
          No audio tracks
        </div>
      )}
    </div>
  );
}

function AudioStrip({ track, onUpdate, onDelete }: { track: any, onUpdate: (id: number, data: any) => void, onDelete: (id: number) => void }) {
  const [vuL, setVuL] = useState(0);
  const [vuR, setVuR] = useState(0);
  const animationRef = useRef<number>();

  useEffect(() => {
    // Fake VU meter animation if not muted
    const animate = () => {
      if (!track.muted && track.volume > 0) {
        const baseLevel = (track.volume / 100) * 80;
        setVuL(Math.min(100, Math.max(0, baseLevel + (Math.random() * 20 - 10))));
        setVuR(Math.min(100, Math.max(0, baseLevel + (Math.random() * 20 - 10))));
      } else {
        setVuL(0);
        setVuR(0);
      }
      animationRef.current = requestAnimationFrame(() => {
        setTimeout(animate, 50); // slight delay to make it look chunky
      });
    };
    animate();
    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [track.muted, track.volume]);

  return (
    <div className="flex flex-col min-w-[140px] max-w-[140px] border-r border-border p-3 gap-3">
      <div className="flex justify-between items-center group">
        <div className="text-xs font-medium truncate flex-1 pr-2" title={track.name}>
          {track.name}
        </div>
        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon" className="h-4 w-4" onClick={() => onDelete(track.id)}>
            <Trash2 className="w-3 h-3 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="flex gap-4 flex-1 items-end justify-center">
        {/* Slider */}
        <div className="h-[120px] flex items-center">
          <Slider
            orientation="vertical"
            value={[track.volume]}
            max={100}
            step={1}
            onValueChange={([val]) => onUpdate(track.id, { volume: val })}
            className="h-full"
          />
        </div>

        {/* VU Meters */}
        <div className="flex gap-1 h-[120px] items-end pb-[6px]">
          <div className="w-2 h-full bg-background rounded-sm overflow-hidden flex flex-col justify-end">
            <div className="w-full bg-green-500 transition-all duration-75" style={{ height: `${vuL}%`, backgroundColor: vuL > 85 ? 'red' : vuL > 70 ? 'yellow' : '#22c55e' }} />
          </div>
          <div className="w-2 h-full bg-background rounded-sm overflow-hidden flex flex-col justify-end">
            <div className="w-full bg-green-500 transition-all duration-75" style={{ height: `${vuR}%`, backgroundColor: vuR > 85 ? 'red' : vuR > 70 ? 'yellow' : '#22c55e' }} />
          </div>
        </div>
      </div>

      <div className="flex justify-between gap-1">
        <Button
          variant={track.muted ? "destructive" : "secondary"}
          size="sm"
          className="flex-1 h-7 text-xs font-bold"
          onClick={() => onUpdate(track.id, { muted: !track.muted })}
        >
          M
        </Button>
        <Button
          variant={track.solo ? "default" : "secondary"}
          size="sm"
          className="flex-1 h-7 text-xs font-bold"
          onClick={() => onUpdate(track.id, { solo: !track.solo })}
        >
          S
        </Button>
      </div>

      <div className="flex justify-between items-center">
        <span className="text-[10px] text-muted-foreground">{track.volume.toFixed(1)} dB</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-5 w-5">
              <Settings2 className="w-3 h-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Filters</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
