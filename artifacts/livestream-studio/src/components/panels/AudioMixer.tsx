import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  useListAudioTracks, useCreateAudioTrack, useUpdateAudioTrack, useDeleteAudioTrack,
  getListAudioTracksQueryKey,
} from '@workspace/api-client-react';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Settings2 } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { useQueryClient } from '@tanstack/react-query';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// Global shared AudioContext + mic stream
let sharedAudioCtx: AudioContext | null = null;
let sharedMicStream: MediaStream | null = null;
let micSourceNode: MediaStreamAudioSourceNode | null = null;
const micAnalysers: Set<{ analyser: AnalyserNode; buf: Uint8Array<ArrayBuffer>; onLevel: (l: number, r: number) => void }> = new Set();

async function getMicAnalyser(onLevel: (l: number, r: number) => void): Promise<() => void> {
  try {
    if (!sharedAudioCtx) sharedAudioCtx = new AudioContext();
    if (!sharedMicStream) {
      sharedMicStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    if (sharedAudioCtx.state === 'suspended') await sharedAudioCtx.resume();
    if (!micSourceNode && sharedMicStream) {
      micSourceNode = sharedAudioCtx.createMediaStreamSource(sharedMicStream);
    }
    const analyser = sharedAudioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.6;
    const buf = new Uint8Array(analyser.frequencyBinCount) as Uint8Array<ArrayBuffer>;
    micSourceNode!.connect(analyser);
    const entry = { analyser, buf, onLevel };
    micAnalysers.add(entry);
    return () => {
      micAnalysers.delete(entry);
      try { analyser.disconnect(); } catch {}
    };
  } catch {
    return () => {};
  }
}

// Poll all mic analysers
let micPollId: ReturnType<typeof setInterval> | null = null;
function startMicPoll() {
  if (micPollId) return;
  micPollId = setInterval(() => {
    for (const entry of micAnalysers) {
      entry.analyser.getByteFrequencyData(entry.buf);
      const avg = entry.buf.reduce((a, b) => a + b, 0) / entry.buf.length;
      const level = Math.min(100, (avg / 255) * 100 * 3.5); // amplify a bit
      // Slight stereo variation
      entry.onLevel(level, Math.min(100, level + (Math.random() * 4 - 2)));
    }
  }, 50);
}

export function AudioMixer() {
  const queryClient = useQueryClient();
  const { data: tracks = [] } = useListAudioTracks({ query: { enabled: true } });
  const createTrack = useCreateAudioTrack();
  const updateTrack = useUpdateAudioTrack();
  const deleteTrack = useDeleteAudioTrack();

  useEffect(() => {
    startMicPoll();
    return () => {};
  }, []);

  const handleAddTrack = () => {
    createTrack.mutate(
      { data: { name: `Audio ${tracks.length + 1}`, volume: 0.7, gain: 1.0, balance: 0 } },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAudioTracksQueryKey() }) }
    );
  };

  const handleUpdate = useCallback((id: number, data: any) => {
    updateTrack.mutate(
      { id, data },
      {
        onSuccess: (updated) =>
          queryClient.setQueryData(getListAudioTracksQueryKey(), (old: any) =>
            old?.map((t: any) => (t.id === id ? updated : t)) ?? old
          ),
      }
    );
  }, [updateTrack, queryClient]);

  const handleDelete = (id: number) => {
    deleteTrack.mutate(
      { id },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListAudioTracksQueryKey() }) }
    );
  };

  return (
    <div className="flex h-full w-full bg-card overflow-x-auto">
      <div className="flex flex-col items-center justify-center min-w-[48px] border-r border-border bg-muted/10 p-1.5 gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleAddTrack}>
              <Plus className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Add track</TooltipContent>
        </Tooltip>
      </div>

      {tracks.map((track) => (
        <AudioStrip key={track.id} track={track} onUpdate={handleUpdate} onDelete={handleDelete} />
      ))}

      {tracks.length === 0 && (
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
          No audio tracks — click + to add
        </div>
      )}
    </div>
  );
}

function AudioStrip({
  track,
  onUpdate,
  onDelete,
}: {
  track: any;
  onUpdate: (id: number, data: any) => void;
  onDelete: (id: number) => void;
}) {
  const [vuL, setVuL] = useState(0);
  const [vuR, setVuR] = useState(0);
  const animRef = useRef<number | undefined>(undefined);
  const envRef = useRef({ l: 0, r: 0 });

  const isMic = track.name?.toLowerCase().includes('micro') || track.name?.toLowerCase().includes('mic');

  useEffect(() => {
    if (track.muted || track.volume <= 0) {
      setVuL(0);
      setVuR(0);
      return;
    }

    if (isMic) {
      // Real mic level via Web Audio API
      const cleanup = getMicAnalyser((l, r) => {
        const vol = typeof track.volume === 'number' ? track.volume : 1;
        setVuL(Math.min(100, l * vol));
        setVuR(Math.min(100, r * vol));
      });
      return () => { cleanup.then((fn) => fn()); };
    } else {
      // Smooth simulation — envelope follower style
      const vol = typeof track.volume === 'number' ? track.volume : 1;
      const baseLevel = vol * 65;
      let cancelled = false;
      const tick = () => {
        if (cancelled) return;
        // Attack fast, release slow
        const target = baseLevel + (Math.sin(Date.now() / 400) * 15) + (Math.random() * 8 - 4);
        envRef.current.l += (target - envRef.current.l) * (target > envRef.current.l ? 0.3 : 0.08);
        envRef.current.r += (target + Math.random() * 4 - 2 - envRef.current.r) * (target > envRef.current.r ? 0.3 : 0.08);
        setVuL(Math.min(100, Math.max(0, envRef.current.l)));
        setVuR(Math.min(100, Math.max(0, envRef.current.r)));
        animRef.current = requestAnimationFrame(tick);
      };
      animRef.current = requestAnimationFrame(tick);
      return () => {
        cancelled = true;
        if (animRef.current) cancelAnimationFrame(animRef.current);
      };
    }
  }, [track.muted, track.volume, isMic]);

  const vol = typeof track.volume === 'number' ? track.volume : 1;
  const volPct = Math.round(vol * 100);

  return (
    <div className="flex flex-col min-w-[130px] max-w-[130px] border-r border-border p-2.5 gap-2 shrink-0">
      {/* Track name + delete */}
      <div className="flex items-center gap-1 group">
        <span className="text-xs font-medium truncate flex-1" title={track.name}>{track.name}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-4 w-4 opacity-0 group-hover:opacity-100 shrink-0"
          onClick={() => onDelete(track.id)}
        >
          <Trash2 className="w-2.5 h-2.5 text-destructive" />
        </Button>
      </div>

      {/* Fader + VU */}
      <div className="flex gap-3 flex-1 items-end justify-center h-[110px]">
        <Slider
          orientation="vertical"
          value={[vol]}
          min={0}
          max={1}
          step={0.01}
          onValueChange={([v]) => onUpdate(track.id, { volume: v })}
          className="h-full"
        />
        <div className="flex gap-1 h-full items-end">
          {[vuL, vuR].map((vu, i) => (
            <div key={i} className="w-2.5 h-full bg-muted/40 rounded-sm overflow-hidden flex flex-col justify-end relative">
              <div
                className="w-full transition-none rounded-sm"
                style={{
                  height: `${vu}%`,
                  background: vu > 90 ? '#ef4444' : vu > 75 ? '#eab308' : vu > 50 ? '#22c55e' : '#16a34a',
                  transition: 'height 50ms linear',
                }}
              />
              {/* Peak indicator */}
              {vu > 88 && (
                <div className="absolute top-0 w-full h-1 bg-red-500" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Mute / Solo */}
      <div className="flex gap-1">
        <Button
          variant={track.muted ? 'destructive' : 'secondary'}
          size="sm"
          className="flex-1 h-6 text-xs font-bold px-0"
          onClick={() => onUpdate(track.id, { muted: !track.muted })}
        >
          M
        </Button>
        <Button
          variant={track.solo ? 'default' : 'secondary'}
          size="sm"
          className="flex-1 h-6 text-xs font-bold px-0"
          onClick={() => onUpdate(track.id, { solo: !track.solo })}
        >
          S
        </Button>
      </div>

      {/* Level label */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground font-mono">{volPct}%</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-4 w-4">
              <Settings2 className="w-2.5 h-2.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Filters</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
