import React, { useState } from 'react';
import { useStudio } from '@/context/StudioContext';
import { useListScenes, useCreateScene, useDeleteScene, useUpdateScene, useDuplicateScene, getListScenesQueryKey } from '@workspace/api-client-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Plus, Trash2, Copy, Edit2, GripVertical, Scissors, Layers, ArrowRight, ZoomIn, Blend, SplitSquareVertical } from 'lucide-react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useQueryClient } from '@tanstack/react-query';

const TRANSITION_ICONS: Record<string, React.ReactNode> = {
  cut:     <Scissors className="w-2.5 h-2.5" />,
  fade:    <Layers className="w-2.5 h-2.5" />,
  slide:   <ArrowRight className="w-2.5 h-2.5" />,
  swipe:   <SplitSquareVertical className="w-2.5 h-2.5" />,
  zoom:    <ZoomIn className="w-2.5 h-2.5" />,
  dissolve: <Blend className="w-2.5 h-2.5" />,
};

export function ScenePanel() {
  const { activeProjectId, activeSceneId, switchScene, setActiveSourceId } = useStudio();
  const queryClient = useQueryClient();
  const [editingSceneId, setEditingSceneId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  const { data: scenes = [] } = useListScenes(activeProjectId!, {
    query: { enabled: !!activeProjectId },
  });

  const createScene = useCreateScene();
  const deleteScene = useDeleteScene();
  const updateScene = useUpdateScene();
  const duplicateScene = useDuplicateScene();

  const handleCreateScene = () => {
    if (!activeProjectId) return;
    createScene.mutate(
      {
        projectId: activeProjectId,
        data: { name: `Scene ${scenes.length + 1}` },
      },
      {
        onSuccess: (newScene) => {
          queryClient.invalidateQueries({ queryKey: getListScenesQueryKey(activeProjectId) });
          setActiveSceneId(newScene.id);
        },
      }
    );
  };

  const handleDeleteScene = (sceneId: number) => {
    deleteScene.mutate(
      { id: sceneId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListScenesQueryKey(activeProjectId!) });
          if (activeSceneId === sceneId) {
            setActiveSceneId(null);
            setActiveSourceId(null);
          }
        },
      }
    );
  };

  const handleDuplicateScene = (sceneId: number) => {
    duplicateScene.mutate(
      { id: sceneId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListScenesQueryKey(activeProjectId!) });
        },
      }
    );
  };

  const handleUpdateName = (sceneId: number) => {
    if (!editName.trim()) {
      setEditingSceneId(null);
      return;
    }
    updateScene.mutate(
      { id: sceneId, data: { name: editName } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getListScenesQueryKey(activeProjectId!), (old: any) =>
            old ? old.map((s: any) => (s.id === sceneId ? { ...s, name: updated.name } : s)) : old
          );
          setEditingSceneId(null);
        },
      }
    );
  };

  return (
    <div className="flex flex-col h-full bg-card border-r border-border border-b">
      <div className="p-2 border-b border-border font-medium text-xs text-muted-foreground uppercase tracking-wider flex justify-between items-center">
        Scenes
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 flex flex-col gap-1">
          {scenes.map((scene) => (
            <ContextMenu key={scene.id}>
              <ContextMenuTrigger>
                <div
                  className={`flex items-center gap-2 p-2 text-sm rounded cursor-pointer group ${
                    activeSceneId === scene.id
                      ? 'bg-primary/20 text-primary-foreground font-medium'
                      : 'hover:bg-muted text-foreground'
                  }`}
                  onClick={() => {
                    switchScene(scene.id, {
                      type: scene.transitionType ?? 'fade',
                      durationMs: scene.transitionDurationMs ?? 300,
                    });
                  }}
                  onDoubleClick={() => {
                    setEditingSceneId(scene.id);
                    setEditName(scene.name);
                  }}
                >
                  <GripVertical className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 cursor-grab" />
                  {editingSceneId === scene.id ? (
                    <input
                      autoFocus
                      className="flex-1 bg-background border border-primary px-1 text-sm outline-none w-full"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onBlur={() => handleUpdateName(scene.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleUpdateName(scene.id);
                        if (e.key === 'Escape') setEditingSceneId(null);
                      }}
                    />
                  ) : (
                    <span className="flex-1 truncate">{scene.name}</span>
                  )}
                  {/* Transition type badge */}
                  <span
                    className="opacity-0 group-hover:opacity-60 transition-opacity text-muted-foreground flex-shrink-0"
                    title={`Transition: ${scene.transitionType ?? 'fade'}`}
                  >
                    {TRANSITION_ICONS[scene.transitionType ?? 'fade'] ?? <Layers className="w-2.5 h-2.5" />}
                  </span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-48">
                <ContextMenuItem
                  onClick={() => {
                    setEditingSceneId(scene.id);
                    setEditName(scene.name);
                  }}
                >
                  <Edit2 className="mr-2 w-4 h-4" /> Rename
                </ContextMenuItem>
                <ContextMenuItem onClick={() => handleDuplicateScene(scene.id)}>
                  <Copy className="mr-2 w-4 h-4" /> Duplicate
                </ContextMenuItem>
                <ContextMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => handleDeleteScene(scene.id)}
                >
                  <Trash2 className="mr-2 w-4 h-4" /> Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
          {scenes.length === 0 && (
            <div className="p-4 text-center text-xs text-muted-foreground">
              No scenes
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="p-2 border-t border-border flex justify-between bg-muted/30">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCreateScene}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
