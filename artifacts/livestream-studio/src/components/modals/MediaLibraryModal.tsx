import React, { useRef, useState, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useListUploads, useDeleteUpload, getListUploadsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { UploadCloud, Trash2, FileIcon, ImageIcon, FilmIcon, MusicIcon, Loader2, Check } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, clicking an asset calls this instead of just showing it */
  onSelect?: (asset: { id: number; url: string; filename: string; type: string }) => void;
}

export function MediaLibraryModal({ open, onOpenChange, onSelect }: Props) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<string>('all');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: uploads = [], isLoading } = useListUploads({ query: { enabled: open } });
  const deleteUpload = useDeleteUpload();

  const filtered = tab === 'all' ? uploads : uploads.filter((a) => a.type === tab);

  const uploadFiles = async (files: FileList | File[]) => {
    setUploading(true);
    let ok = 0;
    let fail = 0;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', file);
      try {
        const res = await fetch('/api/uploads', { method: 'POST', body: fd });
        if (!res.ok) throw new Error(await res.text());
        ok++;
      } catch {
        fail++;
      }
    }
    setUploading(false);
    queryClient.invalidateQueries({ queryKey: getListUploadsQueryKey() });
    if (ok > 0) toast.success(`${ok} file${ok > 1 ? 's' : ''} uploaded`);
    if (fail > 0) toast.error(`${fail} file${fail > 1 ? 's' : ''} failed`);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) uploadFiles(e.dataTransfer.files);
  }, []);

  const handleDelete = (id: number) => {
    deleteUpload.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListUploadsQueryKey() });
        if (selectedId === id) setSelectedId(null);
        toast.success('Asset deleted');
      },
      onError: () => toast.error('Failed to delete'),
    });
  };

  const handleAssetClick = (asset: typeof uploads[0]) => {
    setSelectedId(asset.id);
    if (onSelect) {
      onSelect({ id: asset.id, url: `/api${asset.url.startsWith('/api') ? asset.url.slice(4) : asset.url}`, filename: asset.filename, type: asset.type });
      onOpenChange(false);
    }
  };

  const getIcon = (type: string) => {
    if (type === 'image') return ImageIcon;
    if (type === 'video') return FilmIcon;
    if (type === 'audio') return MusicIcon;
    return FileIcon;
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[680px] flex flex-col p-0 bg-background gap-0">
        <DialogHeader className="p-4 border-b border-border bg-card flex-row items-center justify-between shrink-0">
          <DialogTitle>Media Library</DialogTitle>
          <div className="flex gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,audio/*"
              className="hidden"
              onChange={handleFileInput}
            />
            <Button size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Uploading…</>
                : <><UploadCloud className="w-4 h-4 mr-2" /> Upload</>}
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 flex flex-col min-h-0 p-4 gap-3">
          <Tabs value={tab} onValueChange={setTab} className="shrink-0">
            <TabsList>
              <TabsTrigger value="all">All ({uploads.length})</TabsTrigger>
              <TabsTrigger value="image">Images ({uploads.filter((a) => a.type === 'image').length})</TabsTrigger>
              <TabsTrigger value="video">Videos ({uploads.filter((a) => a.type === 'video').length})</TabsTrigger>
              <TabsTrigger value="audio">Audio ({uploads.filter((a) => a.type === 'audio').length})</TabsTrigger>
            </TabsList>
          </Tabs>

          <ScrollArea className="flex-1 min-h-0">
            {/* Drop zone shown when empty */}
            {filtered.length === 0 && !isLoading && (
              <div
                className={cn(
                  'h-48 flex flex-col items-center justify-center border-2 border-dashed rounded-lg transition-colors cursor-pointer',
                  dragOver ? 'border-primary bg-primary/5' : 'border-border'
                )}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloud className="w-10 h-10 mb-3 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">Drag & drop files here, or click to upload</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Images, Videos, Audio</p>
              </div>
            )}

            {/* Asset grid with drag-and-drop support */}
            {filtered.length > 0 && (
              <div
                className={cn(
                  'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-1 min-h-[200px] rounded-lg transition-colors',
                  dragOver && 'bg-primary/5 border-2 border-dashed border-primary'
                )}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
              >
                {filtered.map((asset) => {
                  const Icon = getIcon(asset.type);
                  const isSelected = selectedId === asset.id;
                  return (
                    <div
                      key={asset.id}
                      className={cn(
                        'group relative border bg-card rounded-md overflow-hidden hover:border-primary transition-colors cursor-pointer flex flex-col aspect-square',
                        isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-border'
                      )}
                      onClick={() => handleAssetClick(asset)}
                      title={asset.filename}
                    >
                      <div className="flex-1 bg-muted/20 flex items-center justify-center overflow-hidden">
                        {asset.type === 'image' ? (
                          <img
                            src={asset.url}
                            alt={asset.filename}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : asset.type === 'video' ? (
                          <video
                            src={asset.url}
                            className="w-full h-full object-cover"
                            muted
                            preload="metadata"
                          />
                        ) : (
                          <Icon className="w-10 h-10 text-muted-foreground/40" />
                        )}
                      </div>
                      <div className="p-1.5 text-[10px] border-t border-border bg-card">
                        <div className="truncate font-medium">{asset.filename}</div>
                        <div className="text-muted-foreground">{formatSize(asset.sizeBytes)}</div>
                      </div>

                      {isSelected && onSelect && (
                        <div className="absolute top-1 left-1 w-5 h-5 bg-primary rounded-full flex items-center justify-center">
                          <Check className="w-3 h-3 text-primary-foreground" />
                        </div>
                      )}

                      <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="destructive"
                          size="icon"
                          className="h-6 w-6"
                          onClick={(e) => { e.stopPropagation(); handleDelete(asset.id); }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {onSelect && (
          <div className="p-3 border-t border-border bg-card shrink-0 text-xs text-muted-foreground text-center">
            Click an asset to select it
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
