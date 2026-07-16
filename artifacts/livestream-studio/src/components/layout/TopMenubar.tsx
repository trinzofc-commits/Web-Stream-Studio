import React from 'react';
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarSeparator, MenubarShortcut, MenubarTrigger, MenubarSub, MenubarSubContent, MenubarSubTrigger } from '@/components/ui/menubar';
import { useStudio } from '@/context/StudioContext';
import { Badge } from '@/components/ui/badge';
import { Video, Settings, FolderOpen, Save, FileDown, FileUp, MonitorPlay } from 'lucide-react';
import { useGetStreamStatus } from '@workspace/api-client-react';

export function TopMenubar({ onSettingsOpen, onMediaLibraryOpen }: { onSettingsOpen: () => void, onMediaLibraryOpen: () => void }) {
  const { data: streamStatus } = useGetStreamStatus({
    query: { refetchInterval: 2000 }
  });

  const isLive = streamStatus?.state === 'live';
  const isConnecting = streamStatus?.state === 'connecting';

  return (
    <div className="flex h-10 items-center justify-between border-b border-border bg-card px-2">
      <div className="flex items-center gap-4">
        <Menubar className="border-none bg-transparent">
          <MenubarMenu>
            <MenubarTrigger className="font-bold cursor-pointer"><Video className="w-4 h-4 mr-2 text-primary"/> OBS Web</MenubarTrigger>
          </MenubarMenu>
          
          <MenubarMenu>
            <MenubarTrigger className="cursor-pointer">File</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>New Project</MenubarItem>
              <MenubarItem><FolderOpen className="w-4 h-4 mr-2" /> Open Project...</MenubarItem>
              <MenubarSeparator />
              <MenubarItem><Save className="w-4 h-4 mr-2" /> Save</MenubarItem>
              <MenubarItem>Save As...</MenubarItem>
              <MenubarSeparator />
              <MenubarItem><FileDown className="w-4 h-4 mr-2" /> Export JSON</MenubarItem>
              <MenubarItem><FileUp className="w-4 h-4 mr-2" /> Import JSON</MenubarItem>
              <MenubarSeparator />
              <MenubarItem onSelect={onSettingsOpen}><Settings className="w-4 h-4 mr-2" /> Settings</MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="cursor-pointer">Edit</MenubarTrigger>
            <MenubarContent>
              <MenubarItem disabled>Undo <MenubarShortcut>⌘Z</MenubarShortcut></MenubarItem>
              <MenubarItem disabled>Redo <MenubarShortcut>⇧⌘Z</MenubarShortcut></MenubarItem>
              <MenubarSeparator />
              <MenubarItem>Copy <MenubarShortcut>⌘C</MenubarShortcut></MenubarItem>
              <MenubarItem>Paste <MenubarShortcut>⌘V</MenubarShortcut></MenubarItem>
              <MenubarItem>Delete <MenubarShortcut>Del</MenubarShortcut></MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="cursor-pointer">View</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>Fullscreen</MenubarItem>
              <MenubarItem>Reset UI</MenubarItem>
            </MenubarContent>
          </MenubarMenu>

          <MenubarMenu>
            <MenubarTrigger className="cursor-pointer">Tools</MenubarTrigger>
            <MenubarContent>
              <MenubarItem onSelect={onMediaLibraryOpen}>Media Library</MenubarItem>
              <MenubarItem>Auto-Configuration Wizard</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
          
          <MenubarMenu>
            <MenubarTrigger className="cursor-pointer">Help</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>Documentation</MenubarItem>
              <MenubarItem>About</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
        </Menubar>
      </div>

      <div className="flex items-center gap-3 mr-2">
        <span className="text-xs font-medium text-muted-foreground mr-4">Untitled Project</span>
        
        <div className="flex items-center gap-2">
          {isLive && (
            <Badge variant="destructive" className="animate-pulse shadow-[0_0_10px_rgba(255,0,0,0.5)]">
              LIVE
            </Badge>
          )}
          {isConnecting && (
            <Badge className="bg-yellow-500 text-black">CONNECTING...</Badge>
          )}
          {!isLive && !isConnecting && (
            <Badge variant="outline" className="text-muted-foreground">IDLE</Badge>
          )}
        </div>
      </div>
    </div>
  );
}
