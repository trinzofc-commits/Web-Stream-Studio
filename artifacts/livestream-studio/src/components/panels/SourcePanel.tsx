import React, { useState } from 'react';
import { useStudio } from '@/context/StudioContext';
import {
  useListSources,
  useCreateSource,
  useDeleteSource,
  useUpdateSource,
  useUpdateSourceLayer,
  getListSourcesQueryKey,
} from '@workspace/api-client-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator } from '@/components/ui/context-menu';
import { Plus, Trash2, Copy, Eye, EyeOff, Lock, Unlock, GripVertical, Video, Monitor, Image as ImageIcon, Film, Music, Globe, Type, QrCode, Clock, Timer, LayoutGrid, List, Music2, FileText, Bookmark, Stamp, ChevronUp, ChevronDown, ChevronsUp, ChevronsDown, Signal } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

const sourceIcons: Record<string, any> = {
  camera: Video,
  display: Monitor,
  image: ImageIcon,
  video: Film,
  audio: Music,
  browser: Globe,
  text: Type,
  color: LayoutGrid,
  qrcode: QrCode,
  clock: Clock,
  countdown: Timer,
  slideshow: LayoutGrid,
  videoPlaylist: List,
  audioPlaylist: Music2,
  pdf: FileText,
  logo: Bookmark,
  watermark: Stamp,
  rtmp: Signal,
};

export function SourcePanel() {
  const { activeSceneId, activeSourceId, setActiveSourceId } = useStudio();
  const queryClient = useQueryClient();
  const [editingSourceId, setEditingSourceId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const { data: sources = [] } = useListSources(activeSceneId!, {
    query: { enabled: !!activeSceneId },
  });

  const createSource = useCreateSource();
  const deleteSource = useDeleteSource();
  const updateSource = useUpdateSource();
  const updateSourceLayer = useUpdateSourceLayer();

  const handleCreateSource = (type: any) => {
    if (!activeSceneId) return;
    createSource.mutate(
      {
        sceneId: activeSceneId,
        data: {
          name: `${type.charAt(0).toUpperCase() + type.slice(1)} Source`,
          type,
          x: 0,
          y: 0,
          width: 1280,
          height: 720,
          opacity: 100,
          rotation: 0,
        },
      },
      {
        onSuccess: (newSource) => {
          queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey(activeSceneId) });
          setActiveSourceId(newSource.id);
        },
      }
    );
  };

  const handleDeleteSource = (sourceId: number) => {
    deleteSource.mutate(
      { id: sourceId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey(activeSceneId!) });
          if (activeSourceId === sourceId) {
            setActiveSourceId(null);
          }
        },
      }
    );
  };

  const handleUpdateSource = (sourceId: number, data: any) => {
    updateSource.mutate(
      { id: sourceId, data },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getListSourcesQueryKey(activeSceneId!), (old: any) =>
            old ? old.map((s: any) => (s.id === sourceId ? updated : s)) : old
          );
        },
      }
    );
  };

  const handleLayerAction = (sourceId: number, action: any) => {
    updateSourceLayer.mutate(
      { id: sourceId, data: { action } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey(activeSceneId!) });
        },
      }
    );
  };

  const handleUpdateName = (sourceId: number) => {
    if (!editName.trim()) {
      setEditingSourceId(null);
      return;
    }
    handleUpdateSource(sourceId, { name: editName });
    setEditingSourceId(null);
  };

  if (!activeSceneId) {
    return (
      <div className="flex flex-col h-full bg-card border-r border-border">
        <div className="p-2 border-b border-border font-medium text-xs text-muted-foreground uppercase tracking-wider">
          Sources
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
          Select a scene to view sources
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-card border-r border-border">
      <div className="p-2 border-b border-border font-medium text-xs text-muted-foreground uppercase tracking-wider">
        Sources
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 flex flex-col gap-1">
          {[...sources].sort((a, b) => a.sortOrder - b.sortOrder).map((source) => {
            const Icon = sourceIcons[source.type] || Monitor;
            return (
              <ContextMenu key={source.id}>
                <ContextMenuTrigger>
                  <div
                    className={`flex items-center gap-2 p-1.5 text-sm rounded cursor-pointer group ${
                      activeSourceId === source.id
                        ? 'bg-primary/20 text-primary-foreground font-medium'
                        : 'hover:bg-muted text-foreground'
                    }`}
                    onClick={() => setActiveSourceId(source.id)}
                    onDoubleClick={() => {
                      setEditingSourceId(source.id);
                      setEditName(source.name);
                    }}
                  >
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    {editingSourceId === source.id ? (
                      <input
                        autoFocus
                        className="flex-1 bg-background border border-primary px-1 text-sm outline-none min-w-0"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onBlur={() => handleUpdateName(source.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleUpdateName(source.id);
                          if (e.key === 'Escape') setEditingSourceId(null);
                        }}
                      />
                    ) : (
                      <span className="flex-1 truncate">{source.name}</span>
                    )}
                    <div className="flex items-center gap-1 opacity-50 group-hover:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 hover:bg-background/50"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateSource(source.id, { locked: !source.locked });
                        }}
                      >
                        {source.locked ? <Lock className="w-3 h-3 text-muted-foreground" /> : <Unlock className="w-3 h-3 text-muted-foreground" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 hover:bg-background/50"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleUpdateSource(source.id, { visible: !source.visible });
                        }}
                      >
                        {source.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 text-muted-foreground" />}
                      </Button>
                    </div>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-48">
                  <ContextMenuItem
                    onClick={() => {
                      setEditingSourceId(source.id);
                      setEditName(source.name);
                    }}
                  >
                    <Type className="mr-2 w-4 h-4" /> Rename
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => handleLayerAction(source.id, 'bringToFront')}>
                    <ChevronsUp className="mr-2 w-4 h-4" /> Bring to Front
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleLayerAction(source.id, 'bringForward')}>
                    <ChevronUp className="mr-2 w-4 h-4" /> Bring Forward
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleLayerAction(source.id, 'sendBackward')}>
                    <ChevronDown className="mr-2 w-4 h-4" /> Send Backward
                  </ContextMenuItem>
                  <ContextMenuItem onClick={() => handleLayerAction(source.id, 'sendToBack')}>
                    <ChevronsDown className="mr-2 w-4 h-4" /> Send to Back
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => handleDeleteSource(source.id)}
                  >
                    <Trash2 className="mr-2 w-4 h-4" /> Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {sources.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">
              No sources
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="p-2 border-t border-border flex justify-between bg-muted/30">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <Plus className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {Object.entries(sourceIcons).map(([type, Icon]) => (
              <DropdownMenuItem key={type} onClick={() => handleCreateSource(type)}>
                <Icon className="mr-2 w-4 h-4 text-muted-foreground" />
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
