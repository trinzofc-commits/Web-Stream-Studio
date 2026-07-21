import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, Layers, Radio, Music2, Settings, Plus, Trash2, Eye, EyeOff, Play, Square, RefreshCw, ChevronRight, Copy, Image as ImageIcon, Film, Type, LayoutGrid, Clock, Timer, QrCode, Bookmark, Stamp, List, Music, Globe, Maximize2, X, Wifi } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Slider } from '@/components/ui/slider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useStudio } from '@/context/StudioContext';
import {
  useListScenes, useCreateScene, useDeleteScene, useUpdateScene, useDuplicateScene, getListScenesQueryKey,
  useListSources, useCreateSource, useDeleteSource, useUpdateSource, getListSourcesQueryKey,
  useListAudioTracks, useUpdateAudioTrack, getListAudioTracksQueryKey,
  useGetStreamStatus, useStartStream, useStopStream, useGetStreamConfig, useGetOutputConfig,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CanvasPreview } from '@/components/canvas/CanvasPreview';
import { PropertiesPanel } from '@/components/panels/PropertiesPanel';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { MediaLibraryModal } from '@/components/modals/MediaLibraryModal';

// Source types shown on mobile — only functional ones
const MOBILE_SOURCE_TYPES: { type: string; label: string; icon: any }[] = [
  { type: 'rtmp',     label: 'RTMP (DJI / OBS)',       icon: Wifi },
  { type: 'camera',   label: 'Camera',                  icon: Video },
  { type: 'image',    label: 'Hình ảnh',                icon: ImageIcon },
  { type: 'video',    label: 'Video',                   icon: Film },
  { type: 'text',     label: 'Văn bản',                 icon: Type },
  { type: 'color',    label: 'Màu nền',                 icon: LayoutGrid },
  { type: 'clock',    label: 'Đồng hồ',                 icon: Clock },
  { type: 'countdown',label: 'Đếm ngược',              icon: Timer },
  { type: 'qrcode',   label: 'QR Code',                 icon: QrCode },
  { type: 'logo',     label: 'Logo',                    icon: Bookmark },
  { type: 'watermark',label: 'Watermark',               icon: Stamp },
  { type: 'audio',    label: 'Audio',                   icon: Music },
  { type: 'audioPlaylist', label: 'Playlist âm thanh',  icon: List },
  { type: 'browser',  label: 'Browser',                 icon: Globe },
];

const sourceIcons: Record<string, any> = Object.fromEntries(
  MOBILE_SOURCE_TYPES.map(({ type, icon }) => [type, icon])
);

type Tab = 'scenes' | 'sources' | 'audio';

// ─── Top header ────────────────────────────────────────────────────────────────
function MobileHeader({ projectName, isLive, isConnecting, onSettingsOpen }: {
  projectName: string;
  isLive: boolean;
  isConnecting: boolean;
  onSettingsOpen: () => void;
}) {
  return (
    <div className="flex h-12 items-center justify-between px-3 bg-card border-b border-border shrink-0">
      <div className="flex items-center gap-2">
        <Video className="w-4 h-4 text-primary" />
        <span className="font-bold text-sm text-foreground">OBS Web</span>
        <span className="text-xs text-muted-foreground truncate max-w-[100px]">{projectName}</span>
      </div>
      <div className="flex items-center gap-2">
        {isLive && (
          <Badge variant="destructive" className="animate-pulse text-[10px] px-1.5 py-0.5 shadow-[0_0_8px_rgba(255,0,0,0.4)]">
            ● LIVE
          </Badge>
        )}
        {isConnecting && (
          <Badge className="bg-yellow-500 text-black text-[10px] px-1.5 py-0.5">CONNECTING</Badge>
        )}
        {!isLive && !isConnecting && (
          <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0.5">IDLE</Badge>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onSettingsOpen}>
          <Settings className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

// ─── Stream button ──────────────────────────────────────────────────────────────
function MobileStreamButton({ onSettingsOpen }: { onSettingsOpen: () => void }) {
  const queryClient = useQueryClient();
  const { data: streamStatus } = useGetStreamStatus({ query: { refetchInterval: 1000 } });
  const { data: streamConfig } = useGetStreamConfig();
  const startStream = useStartStream();
  const stopStream = useStopStream();

  const isLive = streamStatus?.state === 'live';
  const isConnecting = streamStatus?.state === 'connecting';

  const [recSeconds, setRecSeconds] = React.useState(0);
  const recRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  React.useEffect(() => {
    if (isLive) {
      recRef.current = setInterval(() => setRecSeconds(s => s + 1), 1000);
    } else {
      if (recRef.current) clearInterval(recRef.current);
      setRecSeconds(0);
    }
    return () => { if (recRef.current) clearInterval(recRef.current); };
  }, [isLive]);

  const formatTime = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
  };

  const handleToggle = () => {
    if (isLive || isConnecting) {
      stopStream.mutate(undefined, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/stream/status'] }); toast.info('Đã dừng stream'); },
        onError: () => toast.error('Không thể dừng stream'),
      });
    } else {
      if (!streamConfig?.rtmpUrl || !streamConfig?.streamKey) {
        toast.error('Cần cấu hình RTMP URL và Stream Key trong Settings', {
          action: { label: 'Settings', onClick: onSettingsOpen },
        });
        return;
      }
      startStream.mutate({ data: { rtmpUrl: streamConfig.rtmpUrl, streamKey: streamConfig.streamKey } }, {
        onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/stream/status'] }); toast.success('Đang kết nối…'); },
        onError: (err: any) => toast.error(err?.message ?? 'Không thể bắt đầu stream'),
      });
    }
  };

  return (
    <div className="px-3 py-2 bg-card border-t border-border shrink-0">
      <Button
        className={`w-full h-12 text-base font-bold rounded-xl ${isLive || isConnecting ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-primary hover:bg-primary/90 text-primary-foreground'}`}
        onClick={handleToggle}
        disabled={startStream.isPending || stopStream.isPending}
      >
        {isLive ? (
          <><Square className="w-5 h-5 mr-2 fill-current" /> Dừng Stream — {formatTime(recSeconds)}</>
        ) : isConnecting ? (
          <><RefreshCw className="w-5 h-5 mr-2 animate-spin" /> Đang kết nối…</>
        ) : (
          <><Play className="w-5 h-5 mr-2 fill-current" /> Bắt đầu Stream</>
        )}
      </Button>
    </div>
  );
}

// ─── Bottom tab bar ─────────────────────────────────────────────────────────────
function MobileTabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'scenes',  label: 'Scenes',  icon: Layers },
    { id: 'sources', label: 'Sources', icon: Radio },
    { id: 'audio',   label: 'Audio',   icon: Music2 },
  ];
  return (
    <div className="flex border-t border-border bg-card shrink-0">
      {tabs.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-medium transition-colors ${
            active === id ? 'text-primary' : 'text-muted-foreground'
          }`}
          onClick={() => onChange(id)}
        >
          <Icon className={`w-5 h-5 ${active === id ? 'text-primary' : 'text-muted-foreground'}`} />
          {label}
          {active === id && <div className="absolute bottom-0 h-0.5 w-10 bg-primary rounded-full" />}
        </button>
      ))}
    </div>
  );
}

// ─── Transition picker ──────────────────────────────────────────────────────────

const TRANSITION_DEFS = [
  { type: 'cut',      label: 'Cut',      defaultMs: 0   },
  { type: 'fade',     label: 'Fade',     defaultMs: 600 },
  { type: 'dissolve', label: 'Dissolve', defaultMs: 500 },
  { type: 'slide',    label: 'Slide',    defaultMs: 500 },
  { type: 'swipe',    label: 'Swipe',    defaultMs: 400 },
  { type: 'zoom',     label: 'Zoom',     defaultMs: 500 },
] as const;

/** Mini animated preview thumbnail for a single transition type. Loops every 1.8 s. */
function MiniPreview({ type, playing }: { type: string; playing: boolean }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const rafRef     = useRef<number | null>(null);
  const loopRef    = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runAnim = useCallback(() => {
    const el = overlayRef.current;
    if (!el) return;
    const dur = type === 'cut' ? 120 : 600;
    const start = performance.now();

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / dur);
      el.style.opacity = '1';

      if (type === 'cut') {
        el.style.opacity = p < 0.5 ? '1' : '0';
        el.style.transform = 'none';
        el.style.background = '#06b6d4';
      } else if (type === 'fade') {
        el.style.opacity = String(Math.sin(p * Math.PI));
        el.style.transform = 'none';
        el.style.background = '#000';
      } else if (type === 'dissolve') {
        el.style.opacity = String(1 - p);
        el.style.transform = 'none';
        el.style.background = '#000';
      } else if (type === 'slide') {
        const pct = p < 0.5 ? (1 - p * 2) * 100 : (p - 0.5) * 200;
        el.style.opacity = '1';
        el.style.background = '#06b6d4';
        el.style.transform = `translateX(${pct * (p < 0.5 ? -1 : 1)}%)`;
      } else if (type === 'swipe') {
        el.style.opacity = String(1 - p);
        el.style.background = 'linear-gradient(90deg, transparent, #06b6d4 60%)';
        el.style.transform = `translateX(${p * 40}%)`;
      } else if (type === 'zoom') {
        el.style.opacity = String(Math.sin(p * Math.PI) * 0.9);
        el.style.background = '#000';
        el.style.transform = `scale(${1 + p * 0.15})`;
      }

      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        el.style.opacity = '0';
        // Loop
        loopRef.current = setTimeout(runAnim, 900);
      }
    };

    rafRef.current = requestAnimationFrame(tick);
  }, [type]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current)  cancelAnimationFrame(rafRef.current);
      if (loopRef.current) clearTimeout(loopRef.current);
      if (overlayRef.current) overlayRef.current.style.opacity = '0';
      return;
    }
    runAnim();
    return () => {
      if (rafRef.current)  cancelAnimationFrame(rafRef.current);
      if (loopRef.current) clearTimeout(loopRef.current);
    };
  }, [playing, runAnim]);

  return (
    /* Thumbnail: two stacked colour blocks + animated overlay */
    <div className="relative w-14 h-9 rounded overflow-hidden shrink-0">
      {/* "old scene" — darker teal */}
      <div className="absolute inset-0 bg-teal-900/80" />
      {/* "new scene" — lighter, shows through as overlay leaves */}
      <div className="absolute inset-0 bg-teal-500/40" />
      {/* Animated overlay */}
      <div
        ref={overlayRef}
        className="absolute inset-0"
        style={{ opacity: 0, willChange: 'transform, opacity', overflow: 'hidden' }}
      />
      {/* Scene divider lines */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-white/10" />
    </div>
  );
}

function TransitionPicker({
  selected,
  durationMs,
  onChange,
}: {
  selected: string;
  durationMs: number;
  onChange: (type: string, ms: number) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const isSliderVisible = selected !== 'cut';

  return (
    <div className="px-3 py-2 border-b border-border shrink-0 space-y-2">
      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
        Hiệu ứng chuyển scene
      </span>
      {/* Transition cards */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {TRANSITION_DEFS.map(({ type, label }) => {
          const isActive = selected === type;
          const isPlaying = hovered === type || isActive;
          return (
            <button
              key={type}
              onMouseEnter={() => setHovered(type)}
              onMouseLeave={() => setHovered(null)}
              onTouchStart={() => setHovered(type)}
              onTouchEnd={() => setHovered(null)}
              onClick={() => onChange(type, type === 'cut' ? 0 : durationMs || TRANSITION_DEFS.find(d => d.type === type)!.defaultMs)}
              className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded-lg border shrink-0 transition-colors ${
                isActive
                  ? 'border-primary bg-primary/15'
                  : 'border-border bg-muted/30 hover:bg-muted/60'
              }`}
            >
              <MiniPreview type={type} playing={isPlaying} />
              <span className={`text-[10px] font-medium ${isActive ? 'text-primary' : 'text-muted-foreground'}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Duration slider — hidden for Cut */}
      {isSliderVisible && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground shrink-0">Thời gian</span>
          <Slider
            min={100}
            max={1500}
            step={50}
            value={[durationMs]}
            onValueChange={([v]) => onChange(selected, v)}
            className="flex-1"
          />
          <span className="text-[10px] text-muted-foreground w-10 text-right shrink-0">
            {durationMs}ms
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Scene tab ──────────────────────────────────────────────────────────────────
function SceneTab() {
  const { activeProjectId, activeSceneId, setActiveSourceId, switchScene } = useStudio();
  const queryClient = useQueryClient();
  const { data: scenes = [] } = useListScenes(activeProjectId!, { query: { enabled: !!activeProjectId } });
  const createScene = useCreateScene();
  const deleteScene = useDeleteScene();
  const duplicateScene = useDuplicateScene();

  // Transition state — persisted in component lifetime
  const [transType, setTransType] = useState<string>('cut');
  const [transDuration, setTransDuration] = useState<number>(500);

  const handleTransitionChange = (type: string, ms: number) => {
    setTransType(type);
    setTransDuration(ms);
  };

  const handleCreate = () => {
    if (!activeProjectId) return;
    createScene.mutate({ projectId: activeProjectId, data: { name: `Scene ${scenes.length + 1}` } }, {
      onSuccess: (s) => { queryClient.invalidateQueries({ queryKey: getListScenesQueryKey(activeProjectId) }); switchScene(s.id); },
    });
  };

  const handleSceneClick = (sceneId: number) => {
    setActiveSourceId(null);
    switchScene(sceneId, transType === 'cut' ? undefined : { type: transType, durationMs: transDuration });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Scenes</span>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={handleCreate}>
          <Plus className="w-3.5 h-3.5" /> Thêm scene
        </Button>
      </div>

      {/* Transition picker */}
      <TransitionPicker
        selected={transType}
        durationMs={transDuration}
        onChange={handleTransitionChange}
      />

      {/* Scene list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {scenes.map((scene) => (
            <div
              key={scene.id}
              className={`flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors ${
                activeSceneId === scene.id
                  ? 'bg-primary/20 border border-primary/30'
                  : 'bg-muted/30 border border-transparent hover:bg-muted/50'
              }`}
              onClick={() => handleSceneClick(scene.id)}
            >
              <Layers className={`w-4 h-4 shrink-0 ${activeSceneId === scene.id ? 'text-primary' : 'text-muted-foreground'}`} />
              <span className={`flex-1 text-sm font-medium truncate ${activeSceneId === scene.id ? 'text-primary' : 'text-foreground'}`}>
                {scene.name}
              </span>
              {activeSceneId === scene.id && (
                <div className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={e => e.stopPropagation()}>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => duplicateScene.mutate({ id: scene.id }, {
                    onSuccess: () => queryClient.invalidateQueries({ queryKey: getListScenesQueryKey(activeProjectId!) }),
                  })}>
                    <Copy className="mr-2 w-4 h-4" /> Nhân đôi
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => deleteScene.mutate({ id: scene.id }, {
                      onSuccess: () => {
                        queryClient.invalidateQueries({ queryKey: getListScenesQueryKey(activeProjectId!) });
                        if (activeSceneId === scene.id) { switchScene(0); setActiveSourceId(null); }
                      },
                    })}
                  >
                    <Trash2 className="mr-2 w-4 h-4" /> Xóa
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
          {scenes.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Chưa có scene nào.<br />
              <button className="text-primary text-sm mt-2 underline" onClick={handleCreate}>Tạo scene đầu tiên</button>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// Source types that need a URL to be useful — auto-open media picker on mobile
const URL_SOURCE_TYPES = new Set(['image', 'logo', 'watermark', 'video']);

// ─── Source tab ─────────────────────────────────────────────────────────────────
function SourceTab({
  onSelectSource,
  onOpenMediaLibrary,
}: {
  onSelectSource: (id: number) => void;
  onOpenMediaLibrary: (cb: (url: string) => void) => void;
}) {
  const { activeSceneId, activeSourceId, setActiveSourceId } = useStudio();
  const queryClient = useQueryClient();
  const { data: sources = [] } = useListSources(activeSceneId!, { query: { enabled: !!activeSceneId } });
  const createSource = useCreateSource();
  const deleteSource = useDeleteSource();
  const updateSource = useUpdateSource();

  const doCreate = (type: string, extraSettings: Record<string, any> = {}) => {
    if (!activeSceneId) return;
    const info = MOBILE_SOURCE_TYPES.find(s => s.type === type);
    const settings = Object.keys(extraSettings).length ? extraSettings : undefined;
    createSource.mutate({
      sceneId: activeSceneId,
      data: { name: info?.label ?? type, type: type as any, x: 0, y: 0, width: 1280, height: 720, opacity: 100, rotation: 0, ...(settings ? { settings } : {}) },
    }, {
      onSuccess: (s) => {
        // If we already set a URL via media library, also update the source settings
        if (extraSettings.url) {
          updateSource.mutate({ id: s.id, data: { settings: extraSettings } }, {
            onSuccess: () => queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey(activeSceneId!) }),
          });
        } else {
          queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey(activeSceneId) });
        }
        setActiveSourceId(s.id);
        onSelectSource(s.id);
      },
    });
  };

  const handleCreate = (type: string) => {
    if (!activeSceneId) return;
    // For URL-based sources, open the media library first so the image appears immediately
    if (URL_SOURCE_TYPES.has(type)) {
      onOpenMediaLibrary((url) => doCreate(type, { url }));
      return;
    }
    doCreate(type);
  };

  if (!activeSceneId) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Chọn một scene ở tab Scenes để quản lý sources.
      </div>
    );
  }

  const sorted = [...sources].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Sources</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs">
              <Plus className="w-3.5 h-3.5" /> Thêm source
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 max-h-80 overflow-y-auto">
            {MOBILE_SOURCE_TYPES.map(({ type, label, icon: Icon }) => (
              <DropdownMenuItem key={type} onClick={() => handleCreate(type)}>
                <Icon className="mr-2.5 w-4 h-4 text-muted-foreground shrink-0" />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {sorted.map((source) => {
            const Icon = sourceIcons[source.type] ?? Radio;
            const isActive = activeSourceId === source.id;
            return (
              <div
                key={source.id}
                className={`flex items-center gap-3 px-3 py-3 rounded-lg cursor-pointer transition-colors ${
                  isActive ? 'bg-primary/20 border border-primary/30' : 'bg-muted/30 border border-transparent hover:bg-muted/50'
                }`}
                onClick={() => { setActiveSourceId(source.id); onSelectSource(source.id); }}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${isActive ? 'text-primary' : 'text-foreground'}`}>{source.name}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">{MOBILE_SOURCE_TYPES.find(s => s.type === source.type)?.label ?? source.type}</p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={(e) => { e.stopPropagation(); updateSource.mutate({ id: source.id, data: { visible: !source.visible } }, {
                      onSuccess: (u) => queryClient.setQueryData(getListSourcesQueryKey(activeSceneId!), (old: any) => old?.map((s: any) => s.id === source.id ? u : s) ?? old),
                    }); }}
                  >
                    {source.visible
                      ? <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                      : <EyeOff className="w-3.5 h-3.5 text-muted-foreground/40" />}
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-7 w-7"
                    onClick={(e) => { e.stopPropagation(); deleteSource.mutate({ id: source.id }, {
                      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey(activeSceneId!) }); if (activeSourceId === source.id) setActiveSourceId(null); },
                    }); }}
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive/60" />
                  </Button>
                </div>
              </div>
            );
          })}
          {sources.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Chưa có source nào trong scene này.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Audio tab ──────────────────────────────────────────────────────────────────
function AudioTab() {
  const queryClient = useQueryClient();
  const { data: tracks = [] } = useListAudioTracks({ query: { enabled: true } });
  const updateTrack = useUpdateAudioTrack();

  const handleUpdate = (id: number, data: any) => {
    updateTrack.mutate({ id, data }, {
      onSuccess: (updated) => queryClient.setQueryData(getListAudioTracksQueryKey(), (old: any) =>
        old?.map((t: any) => t.id === id ? updated : t) ?? old
      ),
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Audio Mixer</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {tracks.map((track) => {
            const vol = typeof track.volume === 'number' ? track.volume : 1;
            return (
              <div key={track.id} className="bg-muted/30 rounded-xl p-3 space-y-3 border border-border/50">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{track.name}</span>
                  <div className="flex gap-1.5">
                    <Button
                      variant={track.muted ? 'destructive' : 'secondary'}
                      size="sm"
                      className="h-7 w-10 text-xs font-bold"
                      onClick={() => handleUpdate(track.id, { muted: !track.muted })}
                    >
                      M
                    </Button>
                    <Button
                      variant={track.solo ? 'default' : 'secondary'}
                      size="sm"
                      className="h-7 w-10 text-xs font-bold"
                      onClick={() => handleUpdate(track.id, { solo: !track.solo })}
                    >
                      S
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground font-mono w-7 shrink-0">
                    {Math.round(vol * 100)}%
                  </span>
                  <Slider
                    value={[vol]}
                    min={0} max={1} step={0.01}
                    onValueChange={([v]) => handleUpdate(track.id, { volume: v })}
                    className="flex-1"
                    disabled={track.muted}
                  />
                  <Music2 className={`w-3.5 h-3.5 shrink-0 ${track.muted ? 'text-muted-foreground/30' : 'text-muted-foreground'}`} />
                </div>
              </div>
            );
          })}
          {tracks.length === 0 && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Không có audio track nào.
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

const RESOLUTION_BASE: Record<string, [number, number]> = {
  '720p':  [1280, 720],
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '4K':    [3840, 2160],
};

/**
 * Computes exact pixel dimensions for the canvas preview container.
 * CSS aspect-ratio alone is unreliable in flex columns — pixel values are precise.
 *
 * Max height is capped at MAX_H_RATIO of viewport height so the rest of the UI fits.
 */
const MAX_H_RATIO = 0.40; // 40% of viewport height

function useCanvasContainerSize(aspectRatioSetting: string) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  useEffect(() => {
    const compute = () => {
      const vw = window.innerWidth;
      const maxH = window.innerHeight * MAX_H_RATIO;
      let w: number, h: number;

      if (aspectRatioSetting === 'portrait') {
        // Canvas is 9:16 — tall. Fit into width first, then cap height.
        h = vw * (16 / 9);
        if (h > maxH) { h = maxH; w = maxH * (9 / 16); }
        else { w = vw; }
      } else {
        // Canvas is 16:9 — wide. Fit width, height follows.
        w = vw;
        h = vw * (9 / 16);
        if (h > maxH) { h = maxH; w = maxH * (16 / 9); }
      }
      setSize({ width: Math.round(w), height: Math.round(h) });
    };

    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, [aspectRatioSetting]);

  return size;
}

// ─── Main mobile layout ─────────────────────────────────────────────────────────
export function MobileLayout({ onSettingsOpen, onMediaLibraryOpen }: {
  onSettingsOpen: () => void;
  onMediaLibraryOpen: (cb?: (url: string) => void) => void;
}) {
  const { activeProject } = useStudio();
  const { data: streamStatus } = useGetStreamStatus({ query: { refetchInterval: 1000 } });
  const { data: outputConfig } = useGetOutputConfig();
  const isLive = streamStatus?.state === 'live';
  const isConnecting = streamStatus?.state === 'connecting';

  const aspectRatioSetting: string = (outputConfig as any)?.aspectRatio ?? 'landscape';
  const canvasSize = useCanvasContainerSize(aspectRatioSetting);

  const [activeTab, setActiveTab] = useState<Tab>('scenes');
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [canvasFullscreen, setCanvasFullscreen] = useState(false);

  const handleSourceSelect = (_id: number) => {
    setPropertiesOpen(true);
  };

  return (
    <div className="h-dvh w-full flex flex-col bg-background text-foreground overflow-hidden">
      {/* Header */}
      <MobileHeader
        projectName={activeProject?.name ?? ''}
        isLive={isLive}
        isConnecting={isConnecting}
        onSettingsOpen={onSettingsOpen}
      />

      {/* Canvas — exact pixel size computed from aspect ratio + viewport */}
      <div className="shrink-0 mx-auto relative" style={canvasSize
        ? { width: canvasSize.width, height: canvasSize.height }
        : { width: '100%', aspectRatio: '16/9' }
      }>
        <div className="w-full h-full bg-black overflow-hidden">
          <CanvasPreview />
        </div>
        {/* Expand to fullscreen button */}
        <button
          className="absolute top-1.5 right-1.5 z-20 bg-black/60 hover:bg-black/80 text-white rounded-md p-1.5 transition-colors"
          onClick={() => setCanvasFullscreen(true)}
          title="Mở rộng canvas"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Stream button */}
      <MobileStreamButton onSettingsOpen={onSettingsOpen} />

      {/* Tab bar */}
      <MobileTabBar active={activeTab} onChange={setActiveTab} />

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === 'scenes'  && <SceneTab />}
        {activeTab === 'sources' && <SourceTab onSelectSource={handleSourceSelect} onOpenMediaLibrary={onMediaLibraryOpen} />}
        {activeTab === 'audio'   && <AudioTab />}
      </div>

      {/* Properties sheet — slides up when a source is selected */}
      <Sheet open={propertiesOpen} onOpenChange={setPropertiesOpen}>
        <SheetContent side="bottom" className="h-[70vh] p-0 flex flex-col">
          <SheetHeader className="px-4 pt-4 pb-2 border-b border-border shrink-0">
            <SheetTitle className="text-sm">Thuộc tính source</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            <PropertiesPanel onOpenMediaLibrary={onMediaLibraryOpen} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Fullscreen canvas dialog */}
      <Dialog open={canvasFullscreen} onOpenChange={setCanvasFullscreen}>
        <DialogContent className="w-screen h-[100dvh] max-w-none p-0 m-0 rounded-none bg-background flex flex-col border-0 gap-0">
          {/* Toolbar */}
          <div className="shrink-0 flex items-center justify-between px-3 py-2 bg-card border-b border-border">
            <span className="text-xs font-semibold text-muted-foreground">Canvas — kéo để di chuyển, kéo góc để resize</span>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setCanvasFullscreen(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          {/* Full-size canvas */}
          <div className="flex-1 min-h-0">
            <CanvasPreview />
          </div>
          {/* Bottom hint */}
          <div className="shrink-0 px-3 py-2 bg-card border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Chọn source rồi kéo để di chuyển / kéo góc để resize</span>
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setCanvasFullscreen(false); setPropertiesOpen(true); }}>
              Thuộc tính
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
