import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useListUploads, useDeleteUpload, getListUploadsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { UploadCloud, Trash2, File as FileIcon, Image as ImageIcon, Film as VideoIcon, Music as MusicIcon } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

export function MediaLibraryModal({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const { data: uploads = [] } = useListUploads({ query: { enabled: open } });
  const deleteUpload = useDeleteUpload();

  const handleDelete = (id: number) => {
    deleteUpload.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListUploadsQueryKey() })
    });
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'image': return ImageIcon;
      case 'video': return VideoIcon;
      case 'audio': return MusicIcon;
      default: return FileIcon;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[700px] flex flex-col p-0 bg-background">
        <DialogHeader className="p-4 border-b border-border bg-card flex flex-row items-center justify-between">
          <DialogTitle>Media Library</DialogTitle>
          <Button size="sm">
            <UploadCloud className="w-4 h-4 mr-2" /> Upload Asset
          </Button>
        </DialogHeader>

        <div className="flex-1 p-4 overflow-hidden flex flex-col">
          <Tabs defaultValue="all" className="w-full flex-1 flex flex-col">
            <TabsList className="mb-4 self-start">
              <TabsTrigger value="all">All Files</TabsTrigger>
              <TabsTrigger value="images">Images</TabsTrigger>
              <TabsTrigger value="videos">Videos</TabsTrigger>
              <TabsTrigger value="audio">Audio</TabsTrigger>
            </TabsList>

            <ScrollArea className="flex-1">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {uploads.map((asset) => {
                  const Icon = getIcon(asset.type);
                  return (
                    <div key={asset.id} className="group relative border border-border bg-card rounded-md overflow-hidden hover:border-primary transition-colors flex flex-col aspect-square">
                      <div className="flex-1 bg-muted/20 flex items-center justify-center overflow-hidden">
                        {asset.type === 'image' && asset.url ? (
                          <img src={asset.url} alt={asset.filename} className="w-full h-full object-cover" />
                        ) : (
                          <Icon className="w-12 h-12 text-muted-foreground/50" />
                        )}
                      </div>
                      <div className="p-2 text-xs truncate border-t border-border bg-card">
                        {asset.filename}
                        <div className="text-[10px] text-muted-foreground">{(asset.sizeBytes / 1024).toFixed(1)} KB</div>
                      </div>
                      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="destructive" size="icon" className="h-6 w-6" onClick={() => handleDelete(asset.id)}>
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {uploads.length === 0 && (
                  <div className="col-span-full h-48 flex flex-col items-center justify-center text-muted-foreground border-2 border-dashed border-border rounded-lg">
                    <UploadCloud className="w-8 h-8 mb-2 opacity-50" />
                    <p>Drag and drop files here</p>
                    <p className="text-xs">Images, Videos, Audio</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
