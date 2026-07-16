import React, { useRef } from 'react';
import {
  Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator,
  MenubarShortcut, MenubarTrigger,
} from '@/components/ui/menubar';
import { useStudio } from '@/context/StudioContext';
import { Badge } from '@/components/ui/badge';
import { Video, Settings, FolderOpen, Save, FileDown, FileUp, Library } from 'lucide-react';
import { useGetStreamStatus, useCreateProject, useListProjects, useUpdateProject } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const RTMP_PRESETS: Record<string, string> = {
  facebook: 'rtmps://live-api-s.facebook.com:443/rtmp/',
  youtube: 'rtmp://a.rtmp.youtube.com/live2',
  twitch: 'rtmp://live.twitch.tv/app',
  custom: '',
};

interface Props {
  onSettingsOpen: () => void;
  onMediaLibraryOpen: () => void;
}

export function TopMenubar({ onSettingsOpen, onMediaLibraryOpen }: Props) {
  const { activeProject, activeProjectId, setActiveProjectId, setActiveSceneId } = useStudio();
  const queryClient = useQueryClient();
  const importRef = useRef<HTMLInputElement>(null);

  const { data: streamStatus } = useGetStreamStatus({ query: { refetchInterval: 2000 } });
  const { data: projects } = useListProjects();
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();

  const isLive = streamStatus?.state === 'live';
  const isConnecting = streamStatus?.state === 'connecting';

  const handleNewProject = () => {
    const name = window.prompt('Project name:', 'New Project');
    if (!name?.trim()) return;
    createProject.mutate(
      { data: { name: name.trim() } },
      {
        onSuccess: (p) => {
          queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
          setActiveProjectId(p.id);
          setActiveSceneId(null);
          toast.success(`Project "${p.name}" created`);
        },
      }
    );
  };

  const handleSave = () => {
    if (!activeProjectId || !activeProject) return;
    const name = window.prompt('Rename project:', activeProject.name);
    if (!name?.trim() || name.trim() === activeProject.name) return;
    updateProject.mutate(
      { id: activeProjectId, data: { name: name.trim() } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
          toast.success('Project saved');
        },
      }
    );
  };

  const handleExportJSON = async () => {
    if (!activeProjectId) return;
    try {
      const res = await fetch(`/api/projects/${activeProjectId}/export`);
      if (!res.ok) throw new Error('Export failed');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${activeProject?.name ?? 'project'}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Project exported');
    } catch {
      toast.error('Export failed');
    }
  };

  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        const res = await fetch('/api/projects/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Import failed');
        const imported = await res.json();
        queryClient.invalidateQueries({ queryKey: ['/api/projects'] });
        setActiveProjectId(imported.id);
        setActiveSceneId(null);
        toast.success(`Project "${imported.name}" imported`);
      } catch {
        toast.error('Import failed — invalid file');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  return (
    <div className="flex h-10 items-center justify-between border-b border-border bg-card px-2 shrink-0">
      {/* Hidden file input for JSON import */}
      <input
        ref={importRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportJSON}
      />

      <div className="flex items-center gap-0">
        <Menubar className="border-none bg-transparent h-auto shadow-none">
          <MenubarMenu>
            <MenubarTrigger className="font-bold cursor-pointer px-2 py-1">
              <Video className="w-4 h-4 mr-1.5 text-primary" />
              OBS Web
            </MenubarTrigger>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="cursor-pointer px-2 py-1">File</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onSelect={handleNewProject}>
                New Project
              </MenubarItem>
              <MenubarSeparator />
              {projects && projects.length > 1 && (
                <>
                  {projects.map((p) => (
                    <MenubarItem
                      key={p.id}
                      onSelect={() => { setActiveProjectId(p.id); setActiveSceneId(null); }}
                    >
                      <FolderOpen className="w-4 h-4 mr-2" />
                      {p.name}
                      {p.id === activeProjectId && ' ✓'}
                    </MenubarItem>
                  ))}
                  <MenubarSeparator />
                </>
              )}
              <MenubarItem onSelect={handleSave}>
                <Save className="w-4 h-4 mr-2" /> Save / Rename
                <MenubarShortcut>⌘S</MenubarShortcut>
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={handleExportJSON}>
                <FileDown className="w-4 h-4 mr-2" /> Export JSON
              </MenubarItem>
              <MenubarItem onSelect={() => importRef.current?.click()}>
                <FileUp className="w-4 h-4 mr-2" /> Import JSON
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={onSettingsOpen}>
                <Settings className="w-4 h-4 mr-2" /> Settings
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="cursor-pointer px-2 py-1">Edit</MenubarTrigger>
            <MenubarContent>
              <MenubarItem disabled>Undo <MenubarShortcut>⌘Z</MenubarShortcut></MenubarItem>
              <MenubarItem disabled>Redo <MenubarShortcut>⇧⌘Z</MenubarShortcut></MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="cursor-pointer px-2 py-1">View</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onSelect={handleFullscreen}>Toggle Fullscreen <MenubarShortcut>F11</MenubarShortcut></MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="cursor-pointer px-2 py-1">Tools</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onSelect={onMediaLibraryOpen}>
                <Library className="w-4 h-4 mr-2" /> Media Library
              </MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="cursor-pointer px-2 py-1">Help</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onSelect={() => window.open('https://obsproject.com/wiki', '_blank')}>
                Documentation
              </MenubarItem>
              <MenubarSeparator />
              <MenubarItem disabled>OBS Web Studio v1.0</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </div>

      <div className="flex items-center gap-3 mr-2">
        <span className="text-xs font-medium text-muted-foreground">
          {activeProject?.name ?? 'Loading...'}
        </span>
        <div className="flex items-center gap-2">
          {isLive && (
            <Badge variant="destructive" className="animate-pulse shadow-[0_0_10px_rgba(255,0,0,0.5)] text-xs">
              ● LIVE
            </Badge>
          )}
          {isConnecting && (
            <Badge className="bg-yellow-500 text-black text-xs">CONNECTING...</Badge>
          )}
          {!isLive && !isConnecting && (
            <Badge variant="outline" className="text-muted-foreground text-xs">IDLE</Badge>
          )}
        </div>
      </div>
    </div>
  );
}
