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
import { useListProjects, useCreateProject, useDeleteSource, useListSources, useCreateSource } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

function StudioContent() {
  const { activeProjectId, setActiveProjectId, activeSceneId, setActiveSceneId, activeSourceId, setActiveSourceId } = useStudio();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mediaLibraryOpen, setMediaLibraryOpen] = useState(false);

  const queryClient = useQueryClient();
  const { data: projects, isLoading } = useListProjects();
  const createProject = useCreateProject();
  
  const deleteSource = useDeleteSource();
  const createSource = useCreateSource();
  const { data: sources = [] } = useListSources(activeSceneId!, {
    query: { enabled: !!activeSceneId },
  });

  // Auto-load or create project
  useEffect(() => {
    if (!isLoading && projects && !activeProjectId) {
      if (projects.length > 0) {
        setActiveProjectId(projects[0].id);
        if (projects[0].activeSceneId) {
          setActiveSceneId(projects[0].activeSceneId);
        }
      } else {
        createProject.mutate({
          data: { name: "Default Project" }
        }, {
          onSuccess: (project) => {
            setActiveProjectId(project.id);
          }
        });
      }
    }
  }, [isLoading, projects, activeProjectId, setActiveProjectId, setActiveSceneId, createProject]);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (activeSourceId) {
          deleteSource.mutate({ id: activeSourceId }, {
            onSuccess: () => {
              queryClient.invalidateQueries({ queryKey: ['/api/scenes', activeSceneId, 'sources'] });
              setActiveSourceId(null);
            }
          });
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        e.preventDefault();
        if (activeSourceId && activeSceneId) {
          const sourceToDuplicate = sources.find(s => s.id === activeSourceId);
          if (sourceToDuplicate) {
            createSource.mutate({
              sceneId: activeSceneId,
              data: {
                name: `${sourceToDuplicate.name} (Copy)`,
                type: sourceToDuplicate.type,
                settings: sourceToDuplicate.settings,
                x: sourceToDuplicate.x + 20,
                y: sourceToDuplicate.y + 20,
                width: sourceToDuplicate.width,
                height: sourceToDuplicate.height,
                rotation: sourceToDuplicate.rotation,
                opacity: sourceToDuplicate.opacity,
              }
            }, {
              onSuccess: (newSource) => {
                queryClient.invalidateQueries({ queryKey: ['/api/scenes', activeSceneId, 'sources'] });
                setActiveSourceId(newSource.id);
              }
            });
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeSourceId, activeSceneId, sources, deleteSource, createSource, queryClient, setActiveSourceId]);

  if (!activeProjectId) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background text-foreground">
        <div className="animate-pulse">Loading Studio...</div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full flex flex-col bg-background text-foreground overflow-hidden font-sans">
      <TopMenubar 
        onSettingsOpen={() => setSettingsOpen(true)}
        onMediaLibraryOpen={() => setMediaLibraryOpen(true)}
      />

      <div className="flex-1 flex overflow-hidden">
        <ResizablePanelGroup direction="horizontal">
          {/* LEFT SIDEBAR: Scenes & Sources */}
          <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="flex flex-col">
            <ResizablePanelGroup direction="vertical">
              <ResizablePanel defaultSize={50} minSize={20}>
                <ScenePanel />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={50} minSize={20}>
                <SourcePanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle className="w-1 bg-border" />

          {/* CENTER: Canvas */}
          <ResizablePanel defaultSize={60} minSize={30}>
            <CanvasPreview />
          </ResizablePanel>

          <ResizableHandle withHandle className="w-1 bg-border" />

          {/* RIGHT SIDEBAR: Properties */}
          <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
            <PropertiesPanel />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* BOTTOM AREA: Audio Mixer + Bottom Stats */}
      <div className="h-48 border-t border-border flex flex-col bg-card shrink-0">
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
