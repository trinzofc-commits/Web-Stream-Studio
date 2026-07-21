import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Eye, EyeOff, Monitor, Smartphone, Copy, Check, Wifi, WifiOff, Loader2, Signal } from 'lucide-react';
import {
  useGetStreamConfig, useSaveStreamConfig,
  useGetOutputConfig, useSaveOutputConfig,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

/** Polls /api/stream/rtmp-ingress every 3 s while the modal is open */
function useRtmpIngress(enabled: boolean) {
  const [data, setData] = useState<{ url: string | null; status: string; activeKeys: string[] }>({
    url: null, status: 'disconnected', activeKeys: [],
  });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const fetchStatus = async () => {
      try {
        const res = await fetch('/api/stream/rtmp-ingress');
        if (res.ok) setData(await res.json());
      } catch { /* ignore */ }
    };
    fetchStatus();
    timerRef.current = setInterval(fetchStatus, 3000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [enabled]);

  return data;
}

const PLATFORM_RTMP: Record<string, string> = {
  facebook: 'rtmps://live-api-s.facebook.com:443/rtmp/',
  youtube: 'rtmp://a.rtmp.youtube.com/live2',
  twitch: 'rtmp://live.twitch.tv/app',
  custom: '',
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function SettingsModal({ open, onOpenChange }: Props) {
  const queryClient = useQueryClient();
  const { data: streamConfig } = useGetStreamConfig({ query: { enabled: open } });
  const { data: outputConfig } = useGetOutputConfig({ query: { enabled: open } });

  const saveStreamConfig = useSaveStreamConfig();
  const saveOutputConfig = useSaveOutputConfig();

  const [streamData, setStreamData] = useState({
    platform: 'facebook',
    rtmpUrl: 'rtmps://live-api-s.facebook.com:443/rtmp/',
    streamKey: '',
  });
  const [outputData, setOutputData] = useState({
    resolution: '1080p',
    aspectRatio: 'landscape' as 'landscape' | 'portrait',
    fps: 30,
    videoBitrate: 2500,
    audioBitrate: 128,
    encoder: 'H264',
    recordingEnabled: false,
    recordingFormat: 'mp4',
  });
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ingressKey, setIngressKey] = useState('live');
  const ingress = useRtmpIngress(open);

  const ingressUrl = ingress.url ? `${ingress.url}/${ingressKey}` : null;

  const copyUrl = () => {
    if (!ingressUrl) return;
    navigator.clipboard.writeText(ingressUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  useEffect(() => {
    if (streamConfig) {
      setStreamData({
        platform: (streamConfig as any).platform ?? 'custom',
        rtmpUrl: streamConfig.rtmpUrl ?? '',
        streamKey: streamConfig.streamKey ?? '',
      });
    }
  }, [streamConfig]);

  useEffect(() => {
    if (outputConfig) {
      setOutputData({
        resolution: (outputConfig as any).resolution ?? '1080p',
        aspectRatio: ((outputConfig as any).aspectRatio ?? 'landscape') as 'landscape' | 'portrait',
        fps: outputConfig.fps ?? 30,
        videoBitrate: outputConfig.videoBitrate ?? 2500,
        audioBitrate: outputConfig.audioBitrate ?? 128,
        encoder: outputConfig.encoder ?? 'H264',
        recordingEnabled: outputConfig.recordingEnabled ?? false,
        recordingFormat: (outputConfig as any).recordingFormat ?? 'mp4',
      });
    }
  }, [outputConfig]);

  const handlePlatformChange = (platform: string) => {
    const url = PLATFORM_RTMP[platform] ?? '';
    setStreamData((prev) => ({ ...prev, platform, rtmpUrl: url || prev.rtmpUrl }));
  };

  const handleSave = () => {
    const p1 = saveStreamConfig.mutateAsync({ data: streamData as any });
    const p2 = saveOutputConfig.mutateAsync({ data: outputData as any });
    Promise.all([p1, p2])
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['/api/stream/config'] });
        queryClient.invalidateQueries({ queryKey: ['/api/output/config'] });
        toast.success('Settings saved');
        onOpenChange(false);
      })
      .catch(() => toast.error('Failed to save settings'));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[600px] flex flex-col p-0 gap-0 overflow-hidden bg-background">
        <DialogHeader className="p-4 border-b border-border bg-card shrink-0">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden min-h-0">
          <Tabs defaultValue="stream" className="flex w-full min-h-0">
            <TabsList className="flex flex-col h-full w-44 bg-card border-r border-border rounded-none justify-start p-2 gap-0.5 items-stretch shrink-0">
              {['general', 'stream', 'output', 'video', 'rtmp-in'].map((tab) => (
                <TabsTrigger
                  key={tab}
                  value={tab}
                  className="justify-start capitalize data-[state=active]:bg-primary/20 data-[state=active]:text-primary rounded px-3 py-1.5 text-sm"
                >
                  {tab === 'rtmp-in' ? 'RTMP Input' : tab}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="flex-1 p-6 overflow-y-auto min-h-0">
              {/* GENERAL */}
              <TabsContent value="general" className="mt-0 space-y-4">
                <h3 className="font-semibold text-base border-b border-border pb-2">General</h3>
                <div className="flex items-center justify-between">
                  <Label>Theme</Label>
                  <Select defaultValue="dark" disabled>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="dark">Dark</SelectItem></SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between">
                  <Label>Language</Label>
                  <Select defaultValue="en" disabled>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="en">English</SelectItem></SelectContent>
                  </Select>
                </div>
              </TabsContent>

              {/* STREAM */}
              <TabsContent value="stream" className="mt-0 space-y-5">
                <h3 className="font-semibold text-base border-b border-border pb-2">Stream Settings</h3>

                <div className="space-y-1.5">
                  <Label>Service</Label>
                  <Select value={streamData.platform} onValueChange={handlePlatformChange}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="facebook">Facebook Live</SelectItem>
                      <SelectItem value="youtube">YouTube Live</SelectItem>
                      <SelectItem value="twitch">Twitch</SelectItem>
                      <SelectItem value="custom">Custom RTMP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label>RTMP Server URL</Label>
                  <Input
                    value={streamData.rtmpUrl}
                    onChange={(e) => setStreamData({ ...streamData, platform: 'custom', rtmpUrl: e.target.value })}
                    placeholder="rtmp://..."
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Stream Key</Label>
                  <div className="flex gap-2">
                    <Input
                      type={showKey ? 'text' : 'password'}
                      value={streamData.streamKey}
                      onChange={(e) => setStreamData({ ...streamData, streamKey: e.target.value })}
                      placeholder="Your stream key"
                      className="font-mono text-sm flex-1"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() => setShowKey((v) => !v)}
                      type="button"
                    >
                      {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {streamData.platform === 'facebook' && 'Get from Facebook Live Producer → Stream Keys'}
                    {streamData.platform === 'youtube' && 'Get from YouTube Studio → Go Live → Stream Key'}
                    {streamData.platform === 'twitch' && 'Get from Twitch Dashboard → Settings → Stream'}
                  </p>
                </div>
              </TabsContent>

              {/* OUTPUT */}
              <TabsContent value="output" className="mt-0 space-y-5">
                <h3 className="font-semibold text-base border-b border-border pb-2">Streaming Output</h3>
                <div className="space-y-4">
                  <Row label="Video Bitrate (kbps)">
                    <Input
                      type="number"
                      className="w-32 h-8 text-sm"
                      value={outputData.videoBitrate}
                      min={500} max={50000} step={100}
                      onChange={(e) => setOutputData({ ...outputData, videoBitrate: Number(e.target.value) })}
                    />
                  </Row>
                  <Row label="Audio Bitrate (kbps)">
                    <Select
                      value={String(outputData.audioBitrate)}
                      onValueChange={(v) => setOutputData({ ...outputData, audioBitrate: Number(v) })}
                    >
                      <SelectTrigger className="w-32 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {[96, 128, 160, 192, 320].map((b) => (
                          <SelectItem key={b} value={String(b)}>{b}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Row>
                  <Row label="Encoder">
                    <Select
                      value={outputData.encoder}
                      onValueChange={(v) => setOutputData({ ...outputData, encoder: v })}
                    >
                      <SelectTrigger className="w-48 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="H264">x264 (Software H.264)</SelectItem>
                        <SelectItem value="H265">HEVC (H.265)</SelectItem>
                        <SelectItem value="VP9">VP9</SelectItem>
                        <SelectItem value="AV1">AV1</SelectItem>
                      </SelectContent>
                    </Select>
                  </Row>
                </div>

                <h3 className="font-semibold text-base border-b border-border pb-2 pt-4">Recording</h3>
                <div className="space-y-4">
                  <Row label="Enable Recording">
                    <Switch
                      checked={outputData.recordingEnabled}
                      onCheckedChange={(v) => setOutputData({ ...outputData, recordingEnabled: v })}
                    />
                  </Row>
                  <Row label="Recording Format">
                    <Select
                      disabled={!outputData.recordingEnabled}
                      value={outputData.recordingFormat}
                      onValueChange={(v) => setOutputData({ ...outputData, recordingFormat: v })}
                    >
                      <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mkv">mkv</SelectItem>
                        <SelectItem value="mp4">mp4</SelectItem>
                        <SelectItem value="mov">mov</SelectItem>
                        <SelectItem value="ts">ts</SelectItem>
                      </SelectContent>
                    </Select>
                  </Row>
                </div>
              </TabsContent>

              {/* RTMP INPUT */}
              <TabsContent value="rtmp-in" className="mt-0 space-y-5">
                <h3 className="font-semibold text-base border-b border-border pb-2">RTMP Input (DJI Fly / OBS / etc.)</h3>

                {/* Tunnel status */}
                <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border">
                  {ingress.status === 'connected'
                    ? <Wifi className="w-5 h-5 text-green-400 shrink-0" />
                    : ingress.status === 'starting'
                    ? <Loader2 className="w-5 h-5 text-yellow-400 animate-spin shrink-0" />
                    : <WifiOff className="w-5 h-5 text-red-400 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">
                      {ingress.status === 'connected' ? 'Tunnel sẵn sàng' :
                       ingress.status === 'starting'  ? 'Đang kết nối tunnel…' :
                       'Tunnel chưa kết nối'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {ingress.status === 'connected'
                        ? 'Máy chủ đang nhận RTMP qua bore.pub'
                        : 'Server tự động kết nối lại sau vài giây'}
                    </p>
                  </div>
                  <Badge variant={ingress.status === 'connected' ? 'default' : 'secondary'} className="shrink-0 text-xs">
                    {ingress.status}
                  </Badge>
                </div>

                {/* Stream key field */}
                <div className="space-y-1.5">
                  <Label>Stream Key (tuỳ chọn)</Label>
                  <Input
                    value={ingressKey}
                    onChange={(e) => setIngressKey(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                    placeholder="live"
                    className="font-mono text-sm w-48"
                  />
                  <p className="text-xs text-muted-foreground">Nhập bất kỳ ký tự nào bạn muốn — dùng trong RTMP URL bên dưới</p>
                </div>

                {/* Public RTMP URL */}
                <div className="space-y-1.5">
                  <Label>RTMP URL để nhập vào DJI Fly / OBS</Label>
                  <div className="flex gap-2">
                    <Input
                      readOnly
                      value={ingressUrl ?? (ingress.status === 'starting' ? 'Đang lấy URL…' : 'Chưa có — đang kết nối tunnel')}
                      className="font-mono text-xs flex-1 text-muted-foreground bg-muted"
                    />
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      disabled={!ingressUrl}
                      onClick={copyUrl}
                      title="Copy URL"
                    >
                      {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                {/* Active streams */}
                {ingress.activeKeys.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="flex items-center gap-1.5">
                      <Signal className="w-3.5 h-3.5 text-green-400" />
                      Đang nhận stream
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {ingress.activeKeys.map((k) => (
                        <Badge key={k} variant="default" className="font-mono text-xs bg-green-600">
                          {k}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                {/* How-to instructions */}
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-sm">
                  <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">Hướng dẫn</p>
                  <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                    <li>Chờ trạng thái <span className="text-green-400 font-medium">connected</span></li>
                    <li>Copy URL phía trên</li>
                    <li>Mở <strong>DJI Fly</strong> → Camera → Live → Custom RTMP → dán URL vào</li>
                    <li>Hoặc mở <strong>OBS</strong> → Settings → Stream → Custom → Server = URL trên, Stream Key = để trống</li>
                    <li>Bắt đầu stream từ thiết bị — ứng dụng sẽ nhận tín hiệu qua RTMP source</li>
                  </ol>
                  <p className="text-xs text-muted-foreground pt-1 border-t border-border">
                    ⚠️ Port ngẫu nhiên, thay đổi mỗi lần server restart. Luôn copy URL mới từ đây.
                  </p>
                </div>
              </TabsContent>

              {/* VIDEO */}
              <TabsContent value="video" className="mt-0 space-y-5">
                <h3 className="font-semibold text-base border-b border-border pb-2">Video Settings</h3>
                <Row label="Orientation">
                  <div className="flex gap-2">
                    {(['landscape', 'portrait'] as const).map((ar) => {
                      const isActive = outputData.aspectRatio === ar;
                      return (
                        <button
                          key={ar}
                          type="button"
                          onClick={() => setOutputData({ ...outputData, aspectRatio: ar })}
                          className={`flex flex-col items-center gap-1.5 px-4 py-2 rounded border text-xs font-medium transition-colors ${
                            isActive
                              ? 'border-primary bg-primary/15 text-primary'
                              : 'border-border bg-background text-muted-foreground hover:border-muted-foreground'
                          }`}
                        >
                          {ar === 'landscape'
                            ? <Monitor className="w-5 h-5" />
                            : <Smartphone className="w-5 h-5" />}
                          <span className="capitalize">{ar}</span>
                          <span className="text-[10px] opacity-70">{ar === 'landscape' ? '16:9' : '9:16'}</span>
                        </button>
                      );
                    })}
                  </div>
                </Row>
                <Row label="Canvas Resolution">
                  <Select
                    value={outputData.resolution}
                    onValueChange={(v) => setOutputData({ ...outputData, resolution: v })}
                  >
                    <SelectTrigger className="w-48 h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {outputData.aspectRatio === 'portrait' ? (
                        <>
                          <SelectItem value="720p">720×1280 (720p)</SelectItem>
                          <SelectItem value="1080p">1080×1920 (1080p)</SelectItem>
                          <SelectItem value="1440p">1440×2560 (1440p)</SelectItem>
                          <SelectItem value="4K">2160×3840 (4K)</SelectItem>
                        </>
                      ) : (
                        <>
                          <SelectItem value="720p">1280×720 (720p)</SelectItem>
                          <SelectItem value="1080p">1920×1080 (1080p)</SelectItem>
                          <SelectItem value="1440p">2560×1440 (1440p)</SelectItem>
                          <SelectItem value="4K">3840×2160 (4K)</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                </Row>
                <Row label="FPS">
                  <Select
                    value={String(outputData.fps)}
                    onValueChange={(v) => setOutputData({ ...outputData, fps: Number(v) })}
                  >
                    <SelectTrigger className="w-28 h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">24</SelectItem>
                      <SelectItem value="30">30</SelectItem>
                      <SelectItem value="60">60</SelectItem>
                    </SelectContent>
                  </Select>
                </Row>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <DialogFooter className="p-3 border-t border-border bg-card flex justify-end gap-2 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={handleSave}
            disabled={saveStreamConfig.isPending || saveOutputConfig.isPending}
          >
            {saveStreamConfig.isPending || saveOutputConfig.isPending ? 'Saving…' : 'Apply & Close'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <Label className="text-sm min-w-[160px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
