import React, { useEffect, useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { TopMenubar } from '@/components/layout/TopMenubar';
import { BottomBar } from '@/components/layout/BottomBar';
import { ScenePanel } from '@/components/panels/ScenePanel';
import { SourcePanel } from '@/components/panels/SourcePanel';
import { CanvasPreview } from '@/components/canvas/CanvasPreview';
import { PropertiesPanel } from '@/components/panels/PropertiesPanel';
import { AudioMixer } from '@/components/panels/AudioMixer';
import { SettingsModal } from '@/components/modals/SettingsModal';
import { MediaLibraryModal } from '@/components/modals/MediaLibraryModal';
import { StudioProvider, useStudio } from '@/context/StudioContext';
import { useDeleteSource, useListSources, useCreateSource, getListSourcesQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

function StudioContent() {
  const {
    activeSceneId,
    activeSourceId,
    setActiveSourceId,
    isLoading,
    activeProjectId,
  } = useStudio();

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);

  const queryClient = useQueryClient();
  const deleteSource = useDeleteSource();
  const createSource = useCreateSource();
  const { data: sources = [] } = useListSources(activeSceneId!, {
    query: { enabled: !!activeSceneId },
  });

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Delete / Backspace — remove active source
      if ((e.key === 'Delete' || e.key === 'Backspace') && activeSourceId) {
        deleteSource.mutate(
          { id: activeSourceId },
          {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey(activeSceneId!) });
              setActiveSourceId(null);
            },
          }
        );
      }

      // Ctrl/Cmd+D — duplicate source
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && activeSourceId && activeSceneId) {
        e.preventDefault();
        const src = sources.find((s) => s.id === activeSourceId);
        if (src) {
          createSource.mutate(
            {
              sceneId: activeSceneId,
              data: {
                name: `${src.name} (Copy)`,
                type: src.type,
                settings: src.settings,
                x: (src.x ?? 0) + 20,
                y: (src.y ?? 0) + 20,
                width: src.width,
                height: src.height,
                rotation: src.rotation,
                opacity: src.opacity,
              },
            },
            {
              onSuccess: (newSrc) => {
                queryClient.invalidateQueries({ queryKey: getListSourcesQueryKey(activeSceneId) });
                setActiveSourceId(newSrc.id);
              },
            }
          );
        }
      }

      // Escape — deselect
      if (e.key === 'Escape') setActiveSourceId(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSourceId, activeSceneId, sources, deleteSource, createSource, queryClient, setActiveSourceId]);

  if (isLoading || !activeProjectId) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Loading Studio…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col bg-background text-foreground overflow-hidden">
      <TopMenubar
        onSettingsOpen={() => setSettingsOpen(true)}
        onMediaLibraryOpen={() => setMediaLibraryOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden min-h-0">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* LEFT — Scenes + Sources */}
          <ResizablePanel defaultSize={18} minSize={13} maxSize={28}>
            <ResizablePanelGroup direction="vertical" className="h-full">
              <ResizablePanel defaultSize={50} minSize={20}>
                <ScenePanel />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={50} minSize={20}>
                <SourcePanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* CENTER — Canvas */}
          <ResizablePanel defaultSize={62} minSize={35}>
            <CanvasPreview />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* RIGHT — Properties */}
          <ResizablePanel defaultSize={20} minSize={14} maxSize={32}>
            <PropertiesPanel onOpenMediaLibrary={() => setMediaLibraryOpen(true)} />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* BOTTOM — Audio + Stats */}
      <div className="h-44 border-t border-border flex flex-col bg-card shrink-0">
        <div className="flex-1 overflow-hidden">
          <AudioMixer />
        </div>
        <BottomBar onSettingsOpen={() => setSettingsOpen(true)} />
      </div>

      <SettingsModal open={settingsOpen} onOpenChange={setSettingsOpen} />
      <MediaLibraryModal open={mediaLibraryOpen} onOpenChange={setMediaLibraryOpen} />
    </div>
  );
}

export default function StudioPage() {
  return (
    <StudioProvider>
      <StudioContent />
    </StudioProvider>
  );
}
