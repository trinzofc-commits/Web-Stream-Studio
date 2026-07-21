import React, { useEffect, useState, useRef } from 'react';
import { useStudio } from '@/context/StudioContext';
import { useListSources, useUpdateSource, getListSourcesQueryKey } from '@workspace/api-client-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { FolderOpen, Plus, Minus, Copy, Check, Wifi, WifiOff, RefreshCw } from 'lucide-react';

interface Props {
  onOpenMediaLibrary?: (onSelect: (url: string) => void) => void;
}

export function PropertiesPanel({ onOpenMediaLibrary }: Props) {
  const { activeSceneId, activeSourceId } = useStudio();
  const queryClient = useQueryClient();

  const { data: sources = [] } = useListSources(activeSceneId!, {
    query: { enabled: !!activeSceneId },
  });

  const source = sources.find((s) => s.id === activeSourceId);
  const updateSource = useUpdateSource();

  const [localTransform, setLocalTransform] = useState({
    x: 0, y: 0, width: 1280, height: 720, rotation: 0, opacity: 100,
  });
  const [localSettings, setLocalSettings] = useState<Record<string, any>>({});

  useEffect(() => {
    if (source) {
      setLocalTransform({
        x: source.x ?? 0,
        y: source.y ?? 0,
        width: source.width ?? 1280,
        height: source.height ?? 720,
        rotation: source.rotation ?? 0,
        opacity: source.opacity ?? 100,
      });
      setLocalSettings((source.settings as Record<string, any>) ?? {});
    }
  }, [source?.id, source?.x, source?.y, source?.width, source?.height, source?.rotation, source?.opacity]);

  if (!activeSceneId || !activeSourceId || !source) {
    return (
      <div className="flex flex-col h-full bg-card border-l border-border">
        <div className="p-2 border-b border-border text-xs text-muted-foreground uppercase tracking-wider font-medium">
          Properties
        </div>
        <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground p-4 text-center">
          Select a source to view properties
        </div>
      </div>
    );
  }

  const commitTransform = (key: string, value: number) => {
    if ((source as any)[key] === value) return;
    updateSource.mutate(
      { id: source.id, data: { [key]: value } },
      {
        onSuccess: (updated) =>
          queryClient.setQueryData(getListSourcesQueryKey(activeSceneId!), (old: any) =>
            old?.map((s: any) => (s.id === source.id ? { ...s, ...updated } : s)) ?? old
          ),
      }
    );
  };

  const commitSettings = (patch: Record<string, any>) => {
    const merged = { ...localSettings, ...patch };
    setLocalSettings(merged);
    updateSource.mutate(
      { id: source.id, data: { settings: merged } },
      {
        onSuccess: (updated) =>
          queryClient.setQueryData(getListSourcesQueryKey(activeSceneId!), (old: any) =>
            old?.map((s: any) => (s.id === source.id ? { ...s, ...updated } : s)) ?? old
          ),
      }
    );
  };

  return (
    <div className="flex flex-col h-full bg-card border-l border-border overflow-hidden">
      <div className="p-2 border-b border-border text-xs font-medium bg-muted/20 truncate shrink-0">
        <span className="text-foreground">{source.name}</span>
        <span className="text-muted-foreground ml-1.5">({source.type})</span>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-5">
          {/* Transform */}
          <section className="space-y-3">
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Transform</h4>

            <div className="grid grid-cols-2 gap-2">
              {(['x', 'y', 'width', 'height'] as const).map((key) => (
                <div key={key} className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground uppercase">{key === 'x' ? 'X Pos' : key === 'y' ? 'Y Pos' : key.charAt(0).toUpperCase() + key.slice(1)}</Label>
                  <Input
                    type="number"
                    className="h-7 text-xs"
                    value={localTransform[key]}
                    onChange={(e) => setLocalTransform((p) => ({ ...p, [key]: Number(e.target.value) }))}
                    onBlur={() => commitTransform(key, localTransform[key])}
                    onKeyDown={(e) => { if (e.key === 'Enter') commitTransform(key, localTransform[key]); }}
                  />
                </div>
              ))}
            </div>

            <SliderRow
              label={`Opacity: ${localTransform.opacity}%`}
              value={localTransform.opacity}
              min={0} max={100}
              onChange={(v) => setLocalTransform((p) => ({ ...p, opacity: v }))}
              onCommit={(v) => commitTransform('opacity', v)}
            />
            <SliderRow
              label={`Rotation: ${localTransform.rotation}°`}
              value={localTransform.rotation}
              min={0} max={360}
              onChange={(v) => setLocalTransform((p) => ({ ...p, rotation: v }))}
              onCommit={(v) => commitTransform('rotation', v)}
            />
          </section>

          {/* Source-specific settings */}
          <Accordion type="single" collapsible defaultValue="src-settings">
            <AccordionItem value="src-settings" className="border-border">
              <AccordionTrigger className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest hover:no-underline py-2">
                {source.type} Settings
              </AccordionTrigger>
              <AccordionContent className="pt-3">
                <SourceSettings
                  type={source.type}
                  settings={localSettings}
                  onChange={setLocalSettings}
                  onCommit={commitSettings}
                  onOpenMediaLibrary={onOpenMediaLibrary}
                />
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </ScrollArea>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-source-type settings                                             */
/* ------------------------------------------------------------------ */

function SourceSettings({
  type,
  settings,
  onChange,
  onCommit,
  onOpenMediaLibrary,
}: {
  type: string;
  settings: Record<string, any>;
  onChange: (s: Record<string, any>) => void;
  onCommit: (patch: Record<string, any>) => void;
  onOpenMediaLibrary?: (onSelect: (url: string) => void) => void;
}) {
  const set = (key: string, value: any) => onChange({ ...settings, [key]: value });
  const commit = (key: string, value: any) => onCommit({ [key]: value });

  switch (type) {
    /* ---- CAMERA ---- */
    case 'camera':
      return <CameraSettings settings={settings} set={set} commit={commit} />;

    /* ---- DISPLAY / SCREEN CAPTURE ---- */
    case 'display':
      return (
        <div className="space-y-3 text-xs text-muted-foreground">
          <p className="leading-relaxed">
            Screen capture requires a desktop capture API. Click the button to request screen capture permission when streaming starts.
          </p>
          <Row label="Show cursor">
            <Switch
              checked={settings.showCursor !== false}
              onCheckedChange={(v) => onCommit({ showCursor: v })}
            />
          </Row>
        </div>
      );

    /* ---- AUDIO INPUT ---- */
    case 'audio':
      return <AudioInputSettings settings={settings} set={set} commit={commit} />;

    /* ---- IMAGE ---- */
    case 'image':
      return (
        <div className="space-y-3">
          <UrlFieldWithPicker label="Image URL" settingKey="url" settings={settings} commit={commit} onOpenLibrary={onOpenMediaLibrary} />
          <Row label="Fit">
            <Select value={settings.fit ?? 'contain'} onValueChange={(v) => onCommit({ fit: v })}>
              <SelectTrigger className="h-7 text-xs w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="contain">Contain</SelectItem>
                <SelectItem value="cover">Cover</SelectItem>
                <SelectItem value="fill">Fill</SelectItem>
                <SelectItem value="none">None</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </div>
      );

    /* ---- VIDEO ---- */
    case 'video':
      return (
        <div className="space-y-3">
          <UrlFieldWithPicker label="Video URL" settingKey="url" settings={settings} commit={commit} onOpenLibrary={onOpenMediaLibrary} />
          <Row label="Loop"><Switch checked={settings.loop !== false} onCheckedChange={(v) => onCommit({ loop: v })} /></Row>
          <Row label="Autoplay"><Switch checked={settings.autoplay !== false} onCheckedChange={(v) => onCommit({ autoplay: v })} /></Row>
          <Row label="Muted"><Switch checked={settings.muted !== false} onCheckedChange={(v) => onCommit({ muted: v })} /></Row>
          <SliderRow
            label={`Speed: ${settings.speed ?? 1}×`}
            value={(settings.speed ?? 1) * 100}
            min={25} max={200} step={25}
            onChange={(v) => {}}
            onCommit={(v) => onCommit({ speed: v / 100 })}
          />
        </div>
      );

    /* ---- BROWSER SOURCE ---- */
    case 'browser':
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">URL</Label>
            <Input
              className="h-7 text-xs"
              value={settings.url ?? ''}
              onChange={(e) => set('url', e.target.value)}
              onBlur={(e) => commit('url', e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">Width</Label>
              <Input type="number" className="h-7 text-xs" value={settings.frameWidth ?? 1280}
                onChange={(e) => set('frameWidth', Number(e.target.value))}
                onBlur={(e) => commit('frameWidth', Number(e.target.value))} />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">Height</Label>
              <Input type="number" className="h-7 text-xs" value={settings.frameHeight ?? 720}
                onChange={(e) => set('frameHeight', Number(e.target.value))}
                onBlur={(e) => commit('frameHeight', Number(e.target.value))} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Custom CSS</Label>
            <textarea
              className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-xs font-mono min-h-[60px] resize-y outline-none focus:ring-1 ring-ring"
              value={settings.css ?? ''}
              onChange={(e) => set('css', e.target.value)}
              onBlur={(e) => commit('css', e.target.value)}
              placeholder="body { background: transparent; }"
            />
          </div>
        </div>
      );

    /* ---- TEXT ---- */
    case 'text':
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Text</Label>
            <textarea
              className="w-full rounded-md border border-input bg-transparent px-2 py-1.5 text-xs min-h-[50px] resize-y outline-none focus:ring-1 ring-ring"
              value={settings.text ?? ''}
              onChange={(e) => set('text', e.target.value)}
              onBlur={(e) => commit('text', e.target.value)}
              placeholder="Your text here…"
            />
          </div>
          <Row label="Font">
            <Select value={settings.fontFamily ?? 'sans-serif'} onValueChange={(v) => onCommit({ fontFamily: v })}>
              <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sans-serif">Sans Serif</SelectItem>
                <SelectItem value="serif">Serif</SelectItem>
                <SelectItem value="monospace">Monospace</SelectItem>
                <SelectItem value="Impact">Impact</SelectItem>
                <SelectItem value="Arial Black">Arial Black</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <SliderRow
            label={`Size: ${settings.fontSize ?? 48}px`}
            value={settings.fontSize ?? 48}
            min={8} max={400} step={2}
            onChange={(v) => set('fontSize', v)}
            onCommit={(v) => commit('fontSize', v)}
          />
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="Color" value={settings.color ?? '#ffffff'} onCommit={(v) => onCommit({ color: v })} />
            <ColorField label="Background" value={settings.bgColor ?? 'transparent'} onCommit={(v) => onCommit({ bgColor: v })} />
          </div>
          <div className="flex gap-3">
            <Row label="Bold">
              <Switch checked={settings.bold === true} onCheckedChange={(v) => onCommit({ bold: v })} />
            </Row>
            <Row label="Italic">
              <Switch checked={settings.italic === true} onCheckedChange={(v) => onCommit({ italic: v })} />
            </Row>
          </div>
          <Row label="Outline">
            <Switch checked={settings.outline === true} onCheckedChange={(v) => onCommit({ outline: v })} />
          </Row>
          {settings.outline && (
            <ColorField label="Outline Color" value={settings.outlineColor ?? '#000000'} onCommit={(v) => onCommit({ outlineColor: v })} />
          )}
        </div>
      );

    /* ---- COLOR / SOLID ---- */
    case 'color':
      return (
        <div className="space-y-3">
          <ColorField label="Color" value={settings.color ?? '#1a1a2e'} onCommit={(v) => onCommit({ color: v })} />
          <SliderRow
            label={`Opacity: ${Math.round((settings.alpha ?? 1) * 100)}%`}
            value={(settings.alpha ?? 1) * 100}
            min={0} max={100}
            onChange={(v) => set('alpha', v / 100)}
            onCommit={(v) => commit('alpha', v / 100)}
          />
        </div>
      );

    /* ---- CLOCK ---- */
    case 'clock':
      return (
        <div className="space-y-3">
          <Row label="Format">
            <Select value={settings.format ?? 'HH:mm:ss'} onValueChange={(v) => onCommit({ format: v })}>
              <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="HH:mm:ss">HH:mm:ss (24h)</SelectItem>
                <SelectItem value="HH:mm">HH:mm</SelectItem>
                <SelectItem value="h:mm:ss A">h:mm:ss AM/PM</SelectItem>
                <SelectItem value="h:mm A">h:mm AM/PM</SelectItem>
              </SelectContent>
            </Select>
          </Row>
          <SliderRow
            label={`Font size: ${settings.fontSize ?? 80}px`}
            value={settings.fontSize ?? 80}
            min={16} max={400} step={4}
            onChange={(v) => set('fontSize', v)}
            onCommit={(v) => commit('fontSize', v)}
          />
          <ColorField label="Color" value={settings.color ?? '#00e5ff'} onCommit={(v) => onCommit({ color: v })} />
        </div>
      );

    /* ---- COUNTDOWN ---- */
    case 'countdown':
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Target date/time</Label>
            <Input
              type="datetime-local"
              className="h-7 text-xs"
              value={settings.targetDate ?? ''}
              onChange={(e) => set('targetDate', e.target.value)}
              onBlur={(e) => commit('targetDate', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Message when done</Label>
            <Input
              className="h-7 text-xs"
              value={settings.endMessage ?? ''}
              onChange={(e) => set('endMessage', e.target.value)}
              onBlur={(e) => commit('endMessage', e.target.value)}
              placeholder="Stream starting!"
            />
          </div>
          <ColorField label="Color" value={settings.color ?? '#ff4444'} onCommit={(v) => onCommit({ color: v })} />
        </div>
      );

    /* ---- QR CODE ---- */
    case 'qrcode':
      return (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Content / URL</Label>
            <Input
              className="h-7 text-xs"
              value={settings.data ?? ''}
              onChange={(e) => set('data', e.target.value)}
              onBlur={(e) => commit('data', e.target.value)}
              placeholder="https://example.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ColorField label="Foreground" value={settings.fgColor ?? '#000000'} onCommit={(v) => onCommit({ fgColor: v })} />
            <ColorField label="Background" value={settings.bgColor ?? '#ffffff'} onCommit={(v) => onCommit({ bgColor: v })} />
          </div>
          <Row label="Error correction">
            <Select value={settings.errorLevel ?? 'M'} onValueChange={(v) => onCommit({ errorLevel: v })}>
              <SelectTrigger className="h-7 text-xs w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="L">L (7%)</SelectItem>
                <SelectItem value="M">M (15%)</SelectItem>
                <SelectItem value="Q">Q (25%)</SelectItem>
                <SelectItem value="H">H (30%)</SelectItem>
              </SelectContent>
            </Select>
          </Row>
        </div>
      );

    /* ---- SLIDESHOW ---- */
    case 'slideshow':
      return <UrlListSettings label="Image URLs" settingKey="urls" settings={settings} onCommit={onCommit} onOpenLibrary={onOpenMediaLibrary}>
        <SliderRow
          label={`Interval: ${settings.interval ?? 5}s`}
          value={settings.interval ?? 5}
          min={1} max={60}
          onChange={(v) => set('interval', v)}
          onCommit={(v) => commit('interval', v)}
        />
        <Row label="Transition">
          <Select value={settings.transition ?? 'fade'} onValueChange={(v) => onCommit({ transition: v })}>
            <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="fade">Fade</SelectItem>
              <SelectItem value="cut">Cut</SelectItem>
              <SelectItem value="slide">Slide</SelectItem>
            </SelectContent>
          </Select>
        </Row>
      </UrlListSettings>;

    /* ---- VIDEO PLAYLIST ---- */
    case 'videoPlaylist':
      return <UrlListSettings label="Video URLs" settingKey="urls" settings={settings} onCommit={onCommit} onOpenLibrary={onOpenMediaLibrary}>
        <Row label="Loop"><Switch checked={settings.loop !== false} onCheckedChange={(v) => onCommit({ loop: v })} /></Row>
        <Row label="Shuffle"><Switch checked={settings.shuffle === true} onCheckedChange={(v) => onCommit({ shuffle: v })} /></Row>
      </UrlListSettings>;

    /* ---- AUDIO PLAYLIST ---- */
    case 'audioPlaylist':
      return <UrlListSettings label="Audio URLs" settingKey="urls" settings={settings} onCommit={onCommit} onOpenLibrary={onOpenMediaLibrary}>
        <Row label="Loop"><Switch checked={settings.loop !== false} onCheckedChange={(v) => onCommit({ loop: v })} /></Row>
        <Row label="Shuffle"><Switch checked={settings.shuffle === true} onCheckedChange={(v) => onCommit({ shuffle: v })} /></Row>
      </UrlListSettings>;

    /* ---- PDF ---- */
    case 'pdf':
      return (
        <div className="space-y-3">
          <UrlFieldWithPicker label="PDF URL" settingKey="url" settings={settings} commit={commit} onOpenLibrary={onOpenMediaLibrary} />
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground uppercase">Start page</Label>
            <Input
              type="number"
              className="h-7 text-xs"
              value={settings.startPage ?? 1}
              min={1}
              onChange={(e) => set('startPage', Number(e.target.value))}
              onBlur={(e) => commit('startPage', Number(e.target.value))}
            />
          </div>
        </div>
      );

    /* ---- LOGO ---- */
    case 'logo':
      return (
        <div className="space-y-3">
          <UrlFieldWithPicker label="Logo URL" settingKey="url" settings={settings} commit={commit} onOpenLibrary={onOpenMediaLibrary} />
          <SliderRow
            label={`Opacity: ${Math.round((settings.opacity ?? 1) * 100)}%`}
            value={(settings.opacity ?? 1) * 100}
            min={0} max={100}
            onChange={(v) => set('opacity', v / 100)}
            onCommit={(v) => commit('opacity', v / 100)}
          />
        </div>
      );

    /* ---- RTMP INPUT (DJI Fly / OBS) ---- */
    case 'rtmp':
      return <RtmpSettings settings={settings} />;

    /* ---- WATERMARK ---- */
    case 'watermark':
      return (
        <div className="space-y-3">
          <UrlFieldWithPicker label="Image URL" settingKey="url" settings={settings} commit={commit} onOpenLibrary={onOpenMediaLibrary} />
          <Row label="Position">
            <Select value={settings.position ?? 'bottom-right'} onValueChange={(v) => onCommit({ position: v })}>
              <SelectTrigger className="h-7 text-xs w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['top-left','top-center','top-right','center-left','center','center-right','bottom-left','bottom-center','bottom-right'].map((p) => (
                  <SelectItem key={p} value={p}>{p.replace(/-/g, ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Row>
          <SliderRow
            label={`Opacity: ${Math.round((settings.opacity ?? 0.5) * 100)}%`}
            value={(settings.opacity ?? 0.5) * 100}
            min={0} max={100}
            onChange={(v) => set('opacity', v / 100)}
            onCommit={(v) => commit('opacity', v / 100)}
          />
        </div>
      );

    default:
      return (
        <p className="text-xs text-muted-foreground italic">
          No additional settings for <strong>{type}</strong>.
        </p>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Reusable small sub-components                                        */
/* ------------------------------------------------------------------ */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-[10px] text-muted-foreground uppercase shrink-0">{label}</Label>
      {children}
    </div>
  );
}

function SliderRow({
  label, value, min, max, step = 1, onChange, onCommit,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; onCommit: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between">
        <Label className="text-[10px] text-muted-foreground uppercase">{label}</Label>
      </div>
      <Slider
        value={[value]}
        min={min} max={max} step={step}
        onValueChange={([v]) => onChange(v)}
        onValueCommit={([v]) => onCommit(v)}
        className="h-4"
      />
    </div>
  );
}

function ColorField({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground uppercase">{label}</Label>
      <div className="flex gap-1.5 items-center">
        <input
          type="color"
          className="w-7 h-7 rounded cursor-pointer border border-border bg-transparent p-0.5"
          value={local.startsWith('#') ? local : '#ffffff'}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
        />
        <Input
          className="h-7 text-xs flex-1 font-mono"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={(e) => onCommit(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onCommit(local); }}
        />
      </div>
    </div>
  );
}

function UrlFieldWithPicker({
  label, settingKey, settings, commit, onOpenLibrary,
}: {
  label: string; settingKey: string; settings: Record<string, any>;
  commit: (k: string, v: any) => void;
  onOpenLibrary?: (onSelect: (url: string) => void) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] text-muted-foreground uppercase">{label}</Label>
      <div className="flex gap-1.5">
        <Input
          className="h-7 text-xs flex-1 font-mono"
          onChange={(e) => {/* local only */}}
          onBlur={(e) => commit(settingKey, e.target.value)}
          placeholder="https://... or pick from library"
          defaultValue={settings[settingKey] ?? ''}
          key={settings[settingKey]}
        />
        {onOpenLibrary && (
          <Button
            variant="outline" size="icon" className="h-7 w-7 shrink-0"
            onClick={() => onOpenLibrary((url) => commit(settingKey, url))}
            title="Pick from Media Library"
          >
            <FolderOpen className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function UrlListSettings({
  label, settingKey, settings, onCommit, onOpenLibrary, children,
}: {
  label: string; settingKey: string; settings: Record<string, any>;
  onCommit: (patch: Record<string, any>) => void;
  onOpenLibrary?: (onSelect: (url: string) => void) => void;
  children?: React.ReactNode;
}) {
  const urls: string[] = settings[settingKey] ?? [];
  const update = (newUrls: string[]) => onCommit({ [settingKey]: newUrls });

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-[10px] text-muted-foreground uppercase">{label}</Label>
        {urls.map((url, i) => (
          <div key={i} className="flex gap-1.5">
            <Input
              className="h-7 text-xs flex-1 font-mono"
              defaultValue={url}
              onBlur={(e) => {
                const next = [...urls];
                next[i] = e.target.value;
                update(next);
              }}
            />
            {onOpenLibrary && (
              <Button
                variant="outline" size="icon" className="h-7 w-7 shrink-0"
                onClick={() => onOpenLibrary((picked) => {
                  const next = [...urls];
                  next[i] = picked;
                  update(next);
                })}
                title="Pick from Media Library"
              >
                <FolderOpen className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
              onClick={() => update(urls.filter((_, j) => j !== i))}
            >
              <Minus className="w-3.5 h-3.5" />
            </Button>
          </div>
        ))}
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 h-7 text-xs"
            onClick={() => update([...urls, ''])}
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" /> Add URL
          </Button>
          {onOpenLibrary && (
            <Button
              variant="outline" size="sm" className="h-7 text-xs"
              onClick={() => onOpenLibrary((picked) => update([...urls, picked]))}
              title="Add from Media Library"
            >
              <FolderOpen className="w-3.5 h-3.5 mr-1.5" /> Library
            </Button>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* RTMP Input (DJI Fly / external encoder)                             */
/* ------------------------------------------------------------------ */

function RtmpSettings({ settings }: { settings: Record<string, any> }) {
  const streamKey = settings.streamKey as string | undefined;
  const [rtmpStatus, setRtmpStatus] = useState<{
    publicUrl: string | null;
    tunnelStatus: string;
    activeStreams: string[];
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const res = await fetch('/api/rtmp/status');
        if (res.ok && mounted) {
          const data = await res.json();
          setRtmpStatus(data);
        }
      } catch { /* ignore */ }
      if (mounted) timer = setTimeout(poll, 5000);
    };

    poll();
    return () => { mounted = false; clearTimeout(timer); };
  }, []);

  const isLive = streamKey
    ? (rtmpStatus?.activeStreams ?? []).some(
        (p) => p === `live/${streamKey}` || p === streamKey
      )
    : false;

  // Full RTMP URL for DJI Fly: "rtmp://bore.pub:PORT/live/STREAMKEY"
  const serverBase = rtmpStatus?.publicUrl ?? null;          // "rtmp://bore.pub:PORT/live"
  const fullRtmpUrl = serverBase && streamKey
    ? `${serverBase}/${streamKey}`
    : null;

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  };

  return (
    <div className="space-y-3">
      {/* Live status */}
      <Row label="Trạng thái">
        <div className={`flex items-center gap-1.5 text-xs font-medium ${isLive ? 'text-green-400' : 'text-muted-foreground'}`}>
          {isLive ? <Wifi className="w-3.5 h-3.5" /> : <WifiOff className="w-3.5 h-3.5" />}
          {isLive ? 'Đang phát sóng' : 'Chờ tín hiệu'}
        </div>
      </Row>

      {/* Stream Key */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground uppercase">Stream Key</Label>
        <div className="flex gap-1.5">
          <Input className="h-7 text-xs flex-1 font-mono" value={streamKey ?? ''} readOnly />
          {streamKey && (
            <Button
              variant="outline" size="icon" className="h-7 w-7 shrink-0"
              onClick={() => copyText(streamKey, 'key')}
              title="Copy stream key"
            >
              {copied === 'key' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          )}
        </div>
      </div>

      {/* Full RTMP URL for DJI Fly */}
      <div className="space-y-1">
        <Label className="text-[10px] text-muted-foreground uppercase">URL RTMP (nhập vào DJI Fly)</Label>
        {fullRtmpUrl ? (
          <div className="flex gap-1.5">
            <Input className="h-7 text-xs flex-1 font-mono" value={fullRtmpUrl} readOnly />
            <Button
              variant="outline" size="icon" className="h-7 w-7 shrink-0"
              onClick={() => copyText(fullRtmpUrl, 'url')}
              title="Copy RTMP URL"
            >
              {copied === 'url' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
        ) : (
          <div className="text-xs text-muted-foreground italic flex items-center gap-1.5">
            <RefreshCw className="w-3 h-3 animate-spin" />
            {rtmpStatus?.tunnelStatus === 'starting' ? 'Đang kết nối tunnel…' : 'Chưa kết nối tunnel'}
          </div>
        )}
      </div>

      {/* Instructions */}
      <div className="rounded-md bg-muted/50 border border-border/50 p-2.5 space-y-2">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
          Hướng dẫn DJI Fly
        </p>
        <ol className="text-[11px] text-muted-foreground space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>Mở DJI Fly → vào <strong className="text-foreground">Live</strong></li>
          <li>Chọn <strong className="text-foreground">Custom RTMP</strong></li>
          <li>Dán <strong className="text-foreground">URL RTMP</strong> ở trên vào ô Server</li>
          <li>Nhấn <strong className="text-foreground">Go Live</strong></li>
        </ol>
        <p className="text-[10px] text-muted-foreground/70 leading-relaxed mt-1">
          Nếu DJI Fly yêu cầu Server và Stream Key riêng: dùng <code className="text-foreground/70">{serverBase ?? '—'}</code> làm server và <code className="text-foreground/70">{streamKey ? `live/${streamKey}` : '—'}</code> làm stream key.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Camera device picker (live enumeration)                              */
/* ------------------------------------------------------------------ */
function CameraSettings({
  settings, set, commit,
}: {
  settings: Record<string, any>;
  set: (k: string, v: any) => void;
  commit: (k: string, v: any) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        // Request permission first so labels are populated
        await navigator.mediaDevices.getUserMedia({ video: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === 'videoinput'));
      } catch {
        // Permission denied — try without requesting
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          setDevices(all.filter((d) => d.kind === 'videoinput'));
        } catch {}
      }
    };
    load();
  }, []);

  return (
    <div className="space-y-3">
      <Row label="Device">
        <Select
          value={settings.deviceId ?? 'default'}
          onValueChange={(v) => commit('deviceId', v)}
        >
          <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Select camera" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default camera</SelectItem>
            {devices.map((d) => (
              <SelectItem key={d.deviceId} value={d.deviceId}>
                {d.label || `Camera ${d.deviceId.slice(0, 8)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Mirror image">
        <Switch
          checked={settings.mirror === true}
          onCheckedChange={(v) => commit('mirror', v)}
        />
      </Row>
      <Row label="Flip vertical">
        <Switch
          checked={settings.flipV === true}
          onCheckedChange={(v) => commit('flipV', v)}
        />
      </Row>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Audio input device picker                                            */
/* ------------------------------------------------------------------ */
function AudioInputSettings({
  settings, set, commit,
}: {
  settings: Record<string, any>;
  set: (k: string, v: any) => void;
  commit: (k: string, v: any) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => s.getTracks().forEach((t) => t.stop()));
        const all = await navigator.mediaDevices.enumerateDevices();
        setDevices(all.filter((d) => d.kind === 'audioinput'));
      } catch {
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          setDevices(all.filter((d) => d.kind === 'audioinput'));
        } catch {}
      }
    };
    load();
  }, []);

  return (
    <div className="space-y-3">
      <Row label="Device">
        <Select
          value={settings.deviceId ?? 'default'}
          onValueChange={(v) => commit('deviceId', v)}
        >
          <SelectTrigger className="h-7 text-xs w-40"><SelectValue placeholder="Select mic" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default microphone</SelectItem>
            {devices.map((d) => (
              <SelectItem key={d.deviceId} value={d.deviceId}>
                {d.label || `Mic ${d.deviceId.slice(0, 8)}`}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label="Monitor">
        <Switch
          checked={settings.monitor === true}
          onCheckedChange={(v) => commit('monitor', v)}
        />
      </Row>
    </div>
  );
}
