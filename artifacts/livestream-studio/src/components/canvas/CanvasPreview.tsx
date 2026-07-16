import React, { useRef, useState, useEffect } from 'react';
import { useStudio } from '@/context/StudioContext';
import { useListSources, useUpdateSource, getListSourcesQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';

export function CanvasPreview() {
  const { activeSceneId, activeSourceId, setActiveSourceId } = useStudio();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: sources = [] } = useListSources(activeSceneId!, {
    query: { enabled: !!activeSceneId },
  });

  const updateSource = useUpdateSource();

  const [scale, setScale] = useState(1);
  const [gridVisible, setGridVisible] = useState(false);

  // Auto-fit scale on mount or window resize
  useEffect(() => {
    const fitCanvas = () => {
      if (containerRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        const canvasRatio = 16 / 9;
        const containerRatio = width / height;
        
        let newScale = 1;
        // Padded to leave some margin
        const padding = 40;
        const availableW = width - padding;
        const availableH = height - padding;

        if (containerRatio > canvasRatio) {
          // Fit to height
          newScale = availableH / 720;
        } else {
          // Fit to width
          newScale = availableW / 1280;
        }
        setScale(Math.max(0.1, newScale));
      }
    };

    fitCanvas();
    window.addEventListener('resize', fitCanvas);
    return () => window.removeEventListener('resize', fitCanvas);
  }, []);

  const handleSourceDragEnd = (id: number, x: number, y: number) => {
    updateSource.mutate(
      { id, data: { x, y } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getListSourcesQueryKey(activeSceneId!), (old: any) =>
            old ? old.map((s: any) => (s.id === id ? updated : s)) : old
          );
        },
      }
    );
  };

  const activeSources = [...sources]
    .sort((a, b) => b.sortOrder - a.sortOrder) // render top to bottom visually (back to front in DOM)
    .reverse();

  return (
    <div className="flex-1 flex flex-col h-full bg-background overflow-hidden relative">
      <div className="absolute top-2 right-2 z-10 flex gap-2 bg-card/80 backdrop-blur border border-border p-1 rounded-md shadow-sm">
        <Toggle
          size="sm"
          pressed={gridVisible}
          onPressedChange={setGridVisible}
          className="h-7 px-2 text-xs"
        >
          Grid
        </Toggle>
        <div className="w-px h-7 bg-border mx-1" />
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setScale(s => Math.max(0.1, s - 0.1))}>
          <ZoomOut className="w-4 h-4" />
        </Button>
        <span className="text-xs font-mono flex items-center justify-center w-12">
          {Math.round(scale * 100)}%
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setScale(s => s + 0.1)}>
          <ZoomIn className="w-4 h-4" />
        </Button>
      </div>

      <div 
        ref={containerRef}
        className="flex-1 flex items-center justify-center w-full h-full overflow-hidden bg-checkerboard"
        onPointerDown={() => setActiveSourceId(null)}
      >
        <div 
          className="relative bg-black shadow-2xl overflow-hidden ring-1 ring-border/50"
          style={{
            width: 1280,
            height: 720,
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
          }}
        >
          {gridVisible && (
            <div 
              className="absolute inset-0 pointer-events-none opacity-20"
              style={{
                backgroundImage: 'linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)',
                backgroundSize: '128px 128px' // 10x10 grid on 1280x720 (roughly)
              }}
            />
          )}

          {!activeSceneId && (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              Select a scene
            </div>
          )}

          {activeSources.map((source) => {
            if (!source.visible) return null;
            const isSelected = activeSourceId === source.id;

            return (
              <DraggableSource
                key={source.id}
                source={source}
                isSelected={isSelected}
                onSelect={() => setActiveSourceId(source.id)}
                onDragEnd={(x, y) => handleSourceDragEnd(source.id, x, y)}
                scale={scale}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

// A simple draggable wrapper for a source box
function DraggableSource({ source, isSelected, onSelect, onDragEnd, scale }: any) {
  const [isDragging, setIsDragging] = useState(false);
  const [pos, setPos] = useState({ x: source.x, y: source.y });
  const startPosRef = useRef({ x: 0, y: 0, startX: 0, startY: 0 });

  useEffect(() => {
    if (!isDragging) {
      setPos({ x: source.x, y: source.y });
    }
  }, [source.x, source.y, isDragging]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (source.locked) return;
    e.stopPropagation();
    onSelect();
    e.target.setPointerCapture(e.pointerId);
    setIsDragging(true);
    startPosRef.current = {
      x: e.clientX,
      y: e.clientY,
      startX: pos.x,
      startY: pos.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = (e.clientX - startPosRef.current.x) / scale;
    const dy = (e.clientY - startPosRef.current.y) / scale;
    setPos({
      x: Math.round(startPosRef.current.startX + dx),
      y: Math.round(startPosRef.current.startY + dy),
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    e.target.releasePointerCapture(e.pointerId);
    if (pos.x !== source.x || pos.y !== source.y) {
      onDragEnd(pos.x, pos.y);
    }
  };

  return (
    <div
      className="absolute border border-transparent hover:border-primary/50"
      style={{
        left: pos.x,
        top: pos.y,
        width: source.width,
        height: source.height,
        opacity: source.opacity / 100,
        transform: `rotate(${source.rotation || 0}deg)`,
        transformOrigin: 'center center',
        zIndex: source.sortOrder,
        borderColor: isSelected ? 'hsl(var(--primary))' : undefined,
        cursor: source.locked ? 'default' : isDragging ? 'grabbing' : 'grab',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Box content - placeholder visualization based on type */}
      <div className="w-full h-full bg-secondary/80 flex items-center justify-center overflow-hidden relative backdrop-blur-sm">
        <span className="text-xs text-muted-foreground/80 font-mono tracking-widest px-2 truncate pointer-events-none select-none">
          {source.type.toUpperCase()}
        </span>
        {source.type === 'text' && source.settings?.text && (
          <div className="absolute inset-0 flex items-center justify-center font-bold text-4xl" style={{ color: source.settings.color || '#fff' }}>
            {source.settings.text}
          </div>
        )}
      </div>

      {/* Resize handles */}
      {isSelected && !source.locked && (
        <>
          <div className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-primary cursor-nwse-resize" />
          <div className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-primary cursor-nesw-resize" />
          <div className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-primary cursor-nesw-resize" />
          <div className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-primary cursor-nwse-resize" />
        </>
      )}
    </div>
  );
}
