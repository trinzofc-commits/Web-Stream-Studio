import React, { useRef, useState, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import { useStudio } from '@/context/StudioContext';
import { useListSources, useUpdateSource, useGetOutputConfig, getListSourcesQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { useIsMobile } from '@/hooks/use-mobile';

/** Animated CSS overlay that mirrors the compositor's transition effect in the preview. */
function TransitionOverlay({ transition }: { transition: { type: string; durationMs: number } | null }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!transition || !overlayRef.current) return;
    const { type, durationMs } = transition;
    const el = overlayRef.current;
    const startTime = performance.now();

    const animate = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);

      if (type === 'fade') {
        el.style.opacity = String(Math.sin(progress * Math.PI));
        el.style.background = '#000';
        el.style.transform = 'none';
      } else if (type === 'dissolve') {
        el.style.opacity = String(1 - progress);
        el.style.background = '#000';
        el.style.transform = 'none';
      } else if (type === 'slide') {
        // Cover slides in from right, then reveals the new scene
        el.style.opacity = '1';
        const pct = progress < 0.5
          ? (1 - progress * 2) * 100   // slide from 0% offset to 0 (cover arrives)
          : (progress - 0.5) * 200;    // then cover departs to the right
        el.style.background = '#000';
        el.style.transform = `translateX(${pct * (progress < 0.5 ? -1 : 1)}%)`;
      } else if (type === 'swipe') {
        el.style.opacity = String(1 - progress);
        el.style.background = 'linear-gradient(90deg, transparent, #000 50%)';
        el.style.transform = 'none';
      } else if (type === 'zoom') {
        el.style.opacity = String(Math.sin(progress * Math.PI) * 0.7);
        el.style.background = '#000';
        el.style.transform = `scale(${1 + progress * 0.1})`;
      } else {
        el.style.opacity = String(Math.sin(progress * Math.PI));
        el.style.background = '#000';
        el.style.transform = 'none';
      }

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        el.style.opacity = '0';
      }
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (overlayRef.current) overlayRef.current.style.opacity = '0';
    };
  }, [transition]);

  return (
    <div
      ref={overlayRef}
      className="absolute inset-0 pointer-events-none z-50"
      style={{ opacity: 0, willChange: 'opacity, transform', transformOrigin: 'center' }}
    />
  );
}

type HandleDir = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

const CURSORS: Record<HandleDir, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  nw: 'nwse-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  se: 'nwse-resize',
};

const HANDLES: { dir: HandleDir; style: React.CSSProperties }[] = [
  { dir: 'nw', style: { top: -5, left: -5, cursor: CURSORS.nw } },
  { dir: 'n',  style: { top: -5, left: '50%', transform: 'translateX(-50%)', cursor: CURSORS.n } },
  { dir: 'ne', style: { top: -5, right: -5, cursor: CURSORS.ne } },
  { dir: 'e',  style: { top: '50%', right: -5, transform: 'translateY(-50%)', cursor: CURSORS.e } },
  { dir: 'se', style: { bottom: -5, right: -5, cursor: CURSORS.se } },
  { dir: 's',  style: { bottom: -5, left: '50%', transform: 'translateX(-50%)', cursor: CURSORS.s } },
  { dir: 'sw', style: { bottom: -5, left: -5, cursor: CURSORS.sw } },
  { dir: 'w',  style: { top: '50%', left: -5, transform: 'translateY(-50%)', cursor: CURSORS.w } },
];

const MIN_SIZE = 10;

const RESOLUTION_BASE: Record<string, [number, number]> = {
  '720p':  [1280, 720],
  '1080p': [1920, 1080],
  '1440p': [2560, 1440],
  '4K':    [3840, 2160],
};

export function CanvasPreview() {
  const { activeSceneId, activeSourceId, setActiveSourceId, activeTransition } = useStudio();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const { data: sources = [] } = useListSources(activeSceneId!, {
    query: { enabled: !!activeSceneId },
  });
  const { data: outputConfig } = useGetOutputConfig();

  const updateSource = useUpdateSource();

  const [scale, setScale] = useState(1);
  const [gridVisible, setGridVisible] = useState(false);

  const resolution = (outputConfig as any)?.resolution ?? '1080p';
  const aspectRatio = (outputConfig as any)?.aspectRatio ?? 'landscape';
  const [baseW, baseH] = RESOLUTION_BASE[resolution] ?? [1920, 1080];
  const canvasW = aspectRatio === 'portrait' ? baseH : baseW;
  const canvasH = aspectRatio === 'portrait' ? baseW : baseH;

  useEffect(() => {
    const fitCanvas = () => {
      if (!containerRef.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      const pad = 32;
      const scaleW = (width - pad) / canvasW;
      const scaleH = (height - pad) / canvasH;
      setScale(Math.max(0.05, Math.min(scaleW, scaleH)));
    };
    fitCanvas();
    const ro = new ResizeObserver(fitCanvas);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [canvasW, canvasH]);

  const saveSource = useCallback(
    (id: number, data: Record<string, number>) => {
      updateSource.mutate(
        { id, data },
        {
          onSuccess: (updated) => {
            queryClient.setQueryData(
              getListSourcesQueryKey(activeSceneId!),
              (old: any) => old?.map((s: any) => (s.id === id ? { ...s, ...updated } : s)) ?? old
            );
          },
        }
      );
    },
    [updateSource, queryClient, activeSceneId]
  );

  const orderedSources = [...sources].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden relative">
      {/* Toolbar — hidden on mobile */}
      {!isMobile && (
        <div className="absolute top-2 right-2 z-10 flex gap-1 bg-card/90 backdrop-blur border border-border p-1 rounded-md shadow">
          <Toggle
            size="sm"
            pressed={gridVisible}
            onPressedChange={setGridVisible}
            className="h-7 px-2 text-xs"
          >
            Grid
          </Toggle>
          <div className="w-px h-7 bg-border" />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setScale((s) => Math.max(0.05, s - 0.05))}>
            <ZoomOut className="w-3.5 h-3.5" />
          </Button>
          <span className="text-xs font-mono w-12 flex items-center justify-center">
            {Math.round(scale * 100)}%
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setScale((s) => s + 0.05)}>
            <ZoomIn className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

      {/* Canvas area */}
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center overflow-hidden"
        style={{ background: 'repeating-conic-gradient(#1a1a1a 0% 25%, #141414 0% 50%) 0 0 / 20px 20px' }}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.canvas) {
            setActiveSourceId(null);
          }
        }}
      >
        {/* Wrapper sized to the visual (scaled) dimensions so layout is correct.
            CSS transform doesn't affect layout flow — without this wrapper, the
            full-resolution div (e.g. 1920×1080) would overflow the container. */}
        <div style={{ width: canvasW * scale, height: canvasH * scale, position: 'relative', flexShrink: 0 }}>
        <div
          data-canvas="true"
          className="relative bg-black shadow-2xl ring-1 ring-white/10 overflow-hidden"
          style={{
            width: canvasW,
            height: canvasH,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            position: 'absolute',
            top: 0,
            left: 0,
          }}
        >
          {gridVisible && (
            <div
              className="absolute inset-0 pointer-events-none z-10 opacity-15"
              style={{
                backgroundImage:
                  'linear-gradient(rgba(255,255,255,0.8) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.8) 1px,transparent 1px)',
                backgroundSize: `${canvasW / 10}px ${canvasH / 10}px`,
              }}
            />
          )}

          {!activeSceneId && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/50 text-sm">
              Select a scene to start
            </div>
          )}

          {orderedSources.map((source) => {
            if (!source.visible) return null;
            return (
              <DraggableResizableSource
                key={source.id}
                source={source}
                isSelected={activeSourceId === source.id}
                scale={scale}
                onSelect={() => setActiveSourceId(source.id)}
                onSave={saveSource}
              />
            );
          })}

          {/* Transition overlay — animates on scene switch */}
          <TransitionOverlay transition={activeTransition} />
        </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Draggable + resizable source box                                      */
/* ------------------------------------------------------------------ */
interface SourceBoxProps {
  source: any;
  isSelected: boolean;
  scale: number;
  onSelect: () => void;
  onSave: (id: number, data: Record<string, number>) => void;
}

function DraggableResizableSource({ source, isSelected, scale, onSelect, onSave }: SourceBoxProps) {
  const [rect, setRect] = useState({ x: source.x, y: source.y, width: source.width, height: source.height });
  const [interactMode, setInteractMode] = useState(false);
  const dragRef = useRef<{
    mode: 'move' | HandleDir;
    startMouse: { x: number; y: number };
    startRect: typeof rect;
  } | null>(null);

  // Sync when source updates from server
  useEffect(() => {
    if (!dragRef.current) {
      setRect({ x: source.x, y: source.y, width: source.width, height: source.height });
    }
  }, [source.x, source.y, source.width, source.height]);

  const beginDrag = (e: React.PointerEvent, mode: 'move' | HandleDir) => {
    if (source.locked) return;
    if (interactMode) return; // pass events through to iframe
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startMouse: { x: e.clientX, y: e.clientY },
      startRect: { ...rect },
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = (e.clientX - dragRef.current.startMouse.x) / scale;
    const dy = (e.clientY - dragRef.current.startMouse.y) / scale;
    const { startRect, mode } = dragRef.current;

    let { x, y, width, height } = startRect;

    if (mode === 'move') {
      x = Math.round(startRect.x + dx);
      y = Math.round(startRect.y + dy);
    } else {
      // Edge / corner resize
      if (mode.includes('e')) width = Math.max(MIN_SIZE, Math.round(startRect.width + dx));
      if (mode.includes('s')) height = Math.max(MIN_SIZE, Math.round(startRect.height + dy));
      if (mode.includes('w')) {
        const newW = Math.max(MIN_SIZE, Math.round(startRect.width - dx));
        x = Math.round(startRect.x + (startRect.width - newW));
        width = newW;
      }
      if (mode.includes('n')) {
        const newH = Math.max(MIN_SIZE, Math.round(startRect.height - dy));
        y = Math.round(startRect.y + (startRect.height - newH));
        height = newH;
      }
    }
    setRect({ x, y, width, height });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    const prev = dragRef.current.startRect;
    dragRef.current = null;
    if (rect.x !== prev.x || rect.y !== prev.y || rect.width !== prev.width || rect.height !== prev.height) {
      onSave(source.id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
  };

  const opacity = typeof source.opacity === 'number' ? source.opacity / 100 : 1;
  const isBrowser = source.type === 'browser';

  // Exit interact mode when pressing Escape
  React.useEffect(() => {
    if (!interactMode) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setInteractMode(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [interactMode]);

  return (
    <div
      className="absolute select-none"
      style={{
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        opacity,
        transform: `rotate(${source.rotation ?? 0}deg)`,
        transformOrigin: 'center',
        zIndex: source.sortOrder + 1,
        outline: interactMode
          ? '2px solid #f59e0b'
          : isSelected ? '2px solid hsl(var(--primary))' : '1px solid transparent',
        cursor: interactMode ? 'default' : source.locked ? 'default' : 'grab',
      }}
      onPointerDown={(e) => beginDrag(e, 'move')}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => { if (isBrowser) { onSelect(); setInteractMode(true); } }}
    >
      <SourceContent source={source} interactMode={interactMode} />

      {/* Interact mode badge — browser sources only */}
      {isBrowser && isSelected && !interactMode && (
        <button
          className="absolute bottom-1.5 right-1.5 z-30 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-black/70 text-white border border-white/20 hover:bg-amber-500/80 transition-colors"
          style={{ pointerEvents: 'auto' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); setInteractMode(true); }}
          title="Bật chế độ tương tác (double-click cũng được)"
        >
          ☝ Interact
        </button>
      )}
      {isBrowser && interactMode && (
        <div
          className="absolute top-1.5 right-1.5 z-30 flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-medium bg-amber-500 text-black"
          style={{ pointerEvents: 'none' }}
        >
          ☝ Đang tương tác · ESC để thoát
        </div>
      )}

      {/* Resize handles — only when selected, not locked, not in interact mode */}
      {isSelected && !source.locked && !interactMode &&
        HANDLES.map(({ dir, style }) => (
          <div
            key={dir}
            className="absolute w-3 h-3 bg-white border-2 border-primary rounded-sm z-20"
            style={{ ...style, position: 'absolute' }}
            onPointerDown={(e) => beginDrag(e, dir)}
          />
        ))}
    </div>
  );
}

/* Renders the visible content of a source based on its type */
function SourceContent({ source, interactMode }: { source: any; interactMode?: boolean }) {
  const s = source.settings ?? {};

  const base = 'w-full h-full flex items-center justify-center overflow-hidden';

  switch (source.type) {
    case 'image':
      return s.url ? (
        <img src={s.url} alt={source.name} className="w-full h-full" style={{ objectFit: s.fit ?? 'contain' }} />
      ) : <PlaceholderBox label="Image" color="#3b4a6b" />;

    case 'video':
      return s.url ? (
        <video
          src={s.url}
          className="w-full h-full"
          style={{ objectFit: 'contain', background: '#000' }}
          autoPlay={s.autoplay !== false}
          loop={s.loop !== false}
          muted={s.muted !== false}
          playsInline
        />
      ) : <PlaceholderBox label="Video" color="#3b3a4a" />;

    case 'text':
      return (
        <div
          className="w-full h-full flex items-center justify-center px-4 text-center break-words"
          style={{
            background: s.bgColor ?? 'transparent',
            color: s.color ?? '#ffffff',
            fontSize: `${s.fontSize ?? 48}px`,
            fontFamily: s.fontFamily ?? 'sans-serif',
            fontWeight: s.bold ? 'bold' : 'normal',
            fontStyle: s.italic ? 'italic' : 'normal',
            textShadow: s.outline ? `0 0 4px ${s.outlineColor ?? '#000'}, 0 0 8px ${s.outlineColor ?? '#000'}` : 'none',
            lineHeight: 1.2,
            pointerEvents: 'none',
          }}
        >
          {s.text ?? 'Text'}
        </div>
      );

    case 'color':
      return <div className="w-full h-full" style={{ background: s.color ?? '#1a1a2e' }} />;

    case 'browser':
      return s.url ? (
        <iframe
          src={s.url}
          className="w-full h-full border-none"
          style={{ pointerEvents: interactMode ? 'auto' : 'none', background: '#000' }}
          title={source.name}
          allow="autoplay; fullscreen; picture-in-picture; camera; microphone"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : <PlaceholderBox label="Browser" color="#1e3a5f" />;

    case 'camera':
      return <LiveCamera deviceId={s.deviceId} mirror={s.mirror} />;

    case 'rtmp':
      return <RtmpSource streamKey={s.streamKey} />;

    case 'display':
      return <PlaceholderBox label="Screen Capture" color="#1a3a1e" icon="🖥" />;

    case 'clock':
      return <ClockSource format={s.format} />;

    case 'countdown':
      return <CountdownSource target={s.targetDate} format={s.format} endMessage={s.endMessage} />;

    case 'qrcode':
      return <QRCodeSource data={s.data} fg={s.fgColor} bg={s.bgColor} />;

    case 'audio':
      return <PlaceholderBox label="Audio Input" color="#3a1e3a" icon="🎙" />;

    case 'slideshow':
      return <SlideshowSource urls={s.urls ?? []} interval={s.interval ?? 5} />;

    case 'pdf':
      return s.url ? (
        <iframe src={`${s.url}#page=${s.startPage ?? 1}`} className="w-full h-full border-none" title={source.name} />
      ) : <PlaceholderBox label="PDF" color="#3a2a1e" icon="📄" />;

    case 'logo':
      return s.url ? (
        // Global transform opacity is applied by parent div; settings.opacity is
        // applied additionally via parent globalAlpha in the compositor, so we
        // wrap in a sub-div with settings opacity to stay in sync.
        <div className="w-full h-full" style={{ opacity: s.opacity ?? 1 }}>
          <img src={s.url} alt="logo" className="w-full h-full" style={{ objectFit: 'contain' }} />
        </div>
      ) : <PlaceholderBox label="Logo" color="#2a2a2a" icon="🏷" />;

    case 'watermark':
      return s.url ? (
        <div className="w-full h-full" style={{ opacity: s.opacity ?? 0.5 }}>
          <img src={s.url} alt="watermark" className="w-full h-full" style={{ objectFit: 'contain' }} />
        </div>
      ) : <PlaceholderBox label="Watermark" color="#1e1e1e" icon="💧" />;

    case 'videoPlaylist':
      return s.urls?.length > 0
        ? <video src={s.urls[0]} className="w-full h-full" style={{ objectFit: 'contain' }} autoPlay loop muted playsInline />
        : <PlaceholderBox label="Video Playlist" color="#2a1e3a" icon="📽" />;

    case 'audioPlaylist':
      return <PlaceholderBox label="Audio Playlist" color="#1e2a3a" icon="🎵" />;

    default:
      return <PlaceholderBox label={source.type} color="#222" />;
  }
}

function PlaceholderBox({ label, color, icon }: { label: string; color: string; icon?: string }) {
  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center gap-2"
      style={{ background: color }}
    >
      {icon && <span style={{ fontSize: '2rem', lineHeight: 1 }}>{icon}</span>}
      <span className="text-xs text-white/50 font-mono tracking-widest uppercase">{label}</span>
    </div>
  );
}

function LiveCamera({ deviceId, mirror }: { deviceId?: string; mirror?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true, audio: false })
      .then((s) => {
        stream = s;
        if (videoRef.current) {
          videoRef.current.srcObject = s;
          videoRef.current.play().catch(() => {});
        }
      })
      .catch(() => {});
    return () => { stream?.getTracks().forEach((t) => t.stop()); };
  }, [deviceId]);

  return (
    <video
      ref={videoRef}
      className="w-full h-full object-cover"
      style={{ transform: mirror ? 'scaleX(-1)' : undefined, background: '#000' }}
      autoPlay
      muted
      playsInline
    />
  );
}

function ClockSource({ format }: { format?: string }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const fmt = format ?? 'HH:mm:ss';
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = now.getHours(), m = now.getMinutes(), s = now.getSeconds();
  const display = fmt
    .replace('HH', pad(h)).replace('H', String(h))
    .replace('mm', pad(m)).replace('m', String(m))
    .replace('ss', pad(s)).replace('s', String(s));
  return (
    <div className="w-full h-full flex items-center justify-center bg-black">
      <span style={{ fontSize: '80px', fontFamily: 'monospace', color: '#00e5ff', textShadow: '0 0 20px #00e5ff88' }}>
        {display}
      </span>
    </div>
  );
}

function CountdownSource({ target, format, endMessage }: { target?: string; format?: string; endMessage?: string }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const calc = () => {
      if (!target) { setSecs(0); return; }
      const diff = Math.max(0, Math.floor((new Date(target).getTime() - Date.now()) / 1000));
      setSecs(diff);
    };
    calc();
    const t = setInterval(calc, 1000);
    return () => clearInterval(t);
  }, [target]);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const display = secs <= 0 ? (endMessage ?? '00:00:00') : `${pad(h)}:${pad(m)}:${pad(s)}`;
  return (
    <div className="w-full h-full flex items-center justify-center bg-black">
      <span style={{ fontSize: '80px', fontFamily: 'monospace', color: '#ff4444', textShadow: '0 0 20px #ff444488' }}>
        {display}
      </span>
    </div>
  );
}

function QRCodeSource({ data, fg, bg }: { data?: string; fg?: string; bg?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    if (!data) { setSrc(''); return; }
    const encoded = encodeURIComponent(data);
    const fgHex = (fg ?? '#000000').replace('#', '');
    const bgHex = (bg ?? '#ffffff').replace('#', '');
    setSrc(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encoded}&color=${fgHex}&bgcolor=${bgHex}`);
  }, [data, fg, bg]);
  return src ? (
    <div className="w-full h-full flex items-center justify-center" style={{ background: bg ?? '#ffffff' }}>
      <img src={src} alt="QR" style={{ width: '80%', height: '80%', objectFit: 'contain' }} />
    </div>
  ) : <PlaceholderBox label="QR Code" color="#fff" icon="▣" />;
}

function SlideshowSource({ urls, interval }: { urls: string[]; interval: number }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    if (urls.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % urls.length), interval * 1000);
    return () => clearInterval(t);
  }, [urls, interval]);
  const url = urls[idx];
  return url ? (
    <img src={url} alt="" className="w-full h-full object-contain" />
  ) : <PlaceholderBox label="Slideshow" color="#1a1e2a" icon="🖼" />;
}

function RtmpSource({ streamKey }: { streamKey?: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [isLive, setIsLive] = useState(false);

  const hlsUrl = streamKey ? `/api/hls/live/${streamKey}/index.m3u8` : null;

  useEffect(() => {
    if (!hlsUrl) return;

    let mounted = true;
    let pollTimer: ReturnType<typeof setTimeout>;

    const loadHls = () => {
      if (!videoRef.current || !mounted) return;
      if (Hls.isSupported()) {
        const hls = new Hls({
          liveSyncDurationCount: 2,
          liveMaxLatencyDurationCount: 4,
          enableWorker: false,
        });
        hlsRef.current = hls;
        hls.loadSource(hlsUrl);
        hls.attachMedia(videoRef.current);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (mounted) videoRef.current?.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal && mounted) {
            hls.destroy();
            hlsRef.current = null;
            setIsLive(false);
            pollTimer = setTimeout(tryLoad, 4000);
          }
        });
      } else if (videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
        // Safari native HLS
        videoRef.current.src = hlsUrl;
        videoRef.current.play().catch(() => {});
      }
    };

    const tryLoad = async () => {
      if (!mounted) return;
      try {
        const res = await fetch(hlsUrl, { method: 'HEAD', cache: 'no-store' });
        if (res.ok && mounted) {
          setIsLive(true);
          loadHls();
          return;
        }
      } catch { /* stream not yet available */ }
      if (mounted) pollTimer = setTimeout(tryLoad, 3000);
    };

    tryLoad();

    return () => {
      mounted = false;
      clearTimeout(pollTimer);
      hlsRef.current?.destroy();
      hlsRef.current = null;
    };
  }, [hlsUrl]);

  if (!streamKey) return <PlaceholderBox label="RTMP Source" color="#0d1a2a" icon="📡" />;

  return (
    <div className="relative w-full h-full bg-black">
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        autoPlay
        muted
        playsInline
        style={{ display: isLive ? 'block' : 'none' }}
      />
      {!isLive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span style={{ fontSize: '2rem', lineHeight: 1 }}>📡</span>
          <span className="text-xs text-white/50 font-mono tracking-widest uppercase">Chờ tín hiệu…</span>
          <span className="text-[10px] text-white/25 font-mono mt-0.5">key: {streamKey}</span>
        </div>
      )}
    </div>
  );
}
