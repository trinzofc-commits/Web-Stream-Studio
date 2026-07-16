import React, { useEffect, useState } from 'react';
import { useStudio } from '@/context/StudioContext';
import { useListSources, useUpdateSource, getListSourcesQueryKey } from '@workspace/api-client-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useQueryClient } from '@tanstack/react-query';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';

export function PropertiesPanel() {
  const { activeSceneId, activeSourceId } = useStudio();
  const queryClient = useQueryClient();

  const { data: sources = [] } = useListSources(activeSceneId!, {
    query: { enabled: !!activeSceneId },
  });

  const source = sources.find((s) => s.id === activeSourceId);
  const updateSource = useUpdateSource();

  const [localTransform, setLocalTransform] = useState({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    rotation: 0,
    opacity: 100,
  });

  const [localSettings, setLocalSettings] = useState<any>({});

  // Sync state when source changes
  useEffect(() => {
    if (source) {
      setLocalTransform({
        x: source.x,
        y: source.y,
        width: source.width,
        height: source.height,
        rotation: source.rotation || 0,
        opacity: source.opacity ?? 100,
      });
      setLocalSettings(source.settings || {});
    }
  }, [source]);

  if (!activeSceneId || !activeSourceId || !source) {
    return (
      <div className="flex flex-col h-full bg-card border-l border-border">
        <div className="p-2 border-b border-border font-medium text-xs text-muted-foreground uppercase tracking-wider">
          Properties
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
          Select a source to view properties
        </div>
      </div>
    );
  }

  const handleTransformChange = (key: string, value: number) => {
    setLocalTransform((prev) => ({ ...prev, [key]: value }));
  };

  const handleTransformCommit = (key: string, value: number) => {
    if (source[key as keyof typeof source] === value) return;
    updateSource.mutate(
      { id: source.id, data: { [key]: value } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getListSourcesQueryKey(activeSceneId!), (old: any) =>
            old ? old.map((s: any) => (s.id === source.id ? updated : s)) : old
          );
        },
      }
    );
  };

  const handleSettingsCommit = (newSettings: any) => {
    const merged = { ...localSettings, ...newSettings };
    setLocalSettings(merged);
    updateSource.mutate(
      { id: source.id, data: { settings: merged } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getListSourcesQueryKey(activeSceneId!), (old: any) =>
            old ? old.map((s: any) => (s.id === source.id ? updated : s)) : old
          );
        },
      }
    );
  };

  return (
    <div className="flex flex-col h-full bg-card border-l border-border">
      <div className="p-2 border-b border-border font-medium text-xs text-foreground bg-muted/20 truncate">
        {source.name} <span className="text-muted-foreground ml-1">({source.type})</span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Transform Section */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Transform</h4>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">X Pos</Label>
                <Input
                  type="number"
                  className="h-8 text-sm"
                  value={localTransform.x}
                  onChange={(e) => handleTransformChange('x', Number(e.target.value))}
                  onBlur={() => handleTransformCommit('x', localTransform.x)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Y Pos</Label>
                <Input
                  type="number"
                  className="h-8 text-sm"
                  value={localTransform.y}
                  onChange={(e) => handleTransformChange('y', Number(e.target.value))}
                  onBlur={() => handleTransformCommit('y', localTransform.y)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Width</Label>
                <Input
                  type="number"
                  className="h-8 text-sm"
                  value={localTransform.width}
                  onChange={(e) => handleTransformChange('width', Number(e.target.value))}
                  onBlur={() => handleTransformCommit('width', localTransform.width)}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Height</Label>
                <Input
                  type="number"
                  className="h-8 text-sm"
                  value={localTransform.height}
                  onChange={(e) => handleTransformChange('height', Number(e.target.value))}
                  onBlur={() => handleTransformCommit('height', localTransform.height)}
                />
              </div>
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs text-muted-foreground">Opacity</Label>
                <span className="text-xs">{localTransform.opacity}%</span>
              </div>
              <Slider
                value={[localTransform.opacity]}
                max={100}
                step={1}
                onValueChange={([val]) => handleTransformChange('opacity', val)}
                onValueCommit={([val]) => handleTransformCommit('opacity', val)}
              />
            </div>

            <div className="space-y-2 pt-2">
              <div className="flex justify-between items-center">
                <Label className="text-xs text-muted-foreground">Rotation</Label>
                <span className="text-xs">{localTransform.rotation}°</span>
              </div>
              <Slider
                value={[localTransform.rotation]}
                min={0}
                max={360}
                step={1}
                onValueChange={([val]) => handleTransformChange('rotation', val)}
                onValueCommit={([val]) => handleTransformCommit('rotation', val)}
              />
            </div>
          </div>

          {/* Type Specific Settings */}
          <Accordion type="single" collapsible defaultValue="settings">
            <AccordionItem value="settings" className="border-border">
              <AccordionTrigger className="text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:no-underline py-2">
                {source.type} Settings
              </AccordionTrigger>
              <AccordionContent className="pt-4 space-y-4">
                {source.type === 'camera' && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Device</Label>
                      <Select
                        value={localSettings.deviceId || 'default'}
                        onValueChange={(val) => handleSettingsCommit({ deviceId: val })}
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Select device" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Default Camera</SelectItem>
                          <SelectItem value="cam1">FaceTime HD</SelectItem>
                          <SelectItem value="cam2">OBS Virtual Camera</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Mirror Image</Label>
                      <Switch
                        checked={localSettings.mirror || false}
                        onCheckedChange={(val) => handleSettingsCommit({ mirror: val })}
                      />
                    </div>
                  </>
                )}

                {source.type === 'text' && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Text</Label>
                      <Input
                        className="h-8 text-sm"
                        value={localSettings.text || 'Sample Text'}
                        onChange={(e) => setLocalSettings({ ...localSettings, text: e.target.value })}
                        onBlur={(e) => handleSettingsCommit({ text: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Color</Label>
                      <Input
                        type="color"
                        className="h-8 w-full p-1"
                        value={localSettings.color || '#ffffff'}
                        onChange={(e) => setLocalSettings({ ...localSettings, color: e.target.value })}
                        onBlur={(e) => handleSettingsCommit({ color: e.target.value })}
                      />
                    </div>
                  </>
                )}

                {source.type === 'browser' && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">URL</Label>
                      <Input
                        className="h-8 text-sm"
                        value={localSettings.url || 'https://obsproject.com'}
                        onChange={(e) => setLocalSettings({ ...localSettings, url: e.target.value })}
                        onBlur={(e) => handleSettingsCommit({ url: e.target.value })}
                      />
                    </div>
                  </>
                )}

                {source.type === 'image' && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Image URL</Label>
                      <Input
                        className="h-8 text-sm"
                        value={localSettings.url || ''}
                        onChange={(e) => setLocalSettings({ ...localSettings, url: e.target.value })}
                        onBlur={(e) => handleSettingsCommit({ url: e.target.value })}
                        placeholder="https://..."
                      />
                    </div>
                  </>
                )}

                {source.type === 'video' && (
                  <>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">Video File / URL</Label>
                      <Input
                        className="h-8 text-sm"
                        value={localSettings.url || ''}
                        onChange={(e) => setLocalSettings({ ...localSettings, url: e.target.value })}
                        onBlur={(e) => handleSettingsCommit({ url: e.target.value })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Loop</Label>
                      <Switch
                        checked={localSettings.loop || false}
                        onCheckedChange={(val) => handleSettingsCommit({ loop: val })}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Autoplay</Label>
                      <Switch
                        checked={localSettings.autoplay !== false}
                        onCheckedChange={(val) => handleSettingsCommit({ autoplay: val })}
                      />
                    </div>
                  </>
                )}

                {!['camera', 'text', 'browser', 'image', 'video'].includes(source.type) && (
                  <div className="text-xs text-muted-foreground italic">
                    Additional settings not implemented for {source.type}.
                  </div>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </ScrollArea>
    </div>
  );
}
