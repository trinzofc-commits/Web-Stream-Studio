import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useGetStreamConfig, useSaveStreamConfig, useGetOutputConfig, useSaveOutputConfig } from '@workspace/api-client-react';

export function SettingsModal({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const { data: streamConfig } = useGetStreamConfig({ query: { enabled: open } });
  const { data: outputConfig } = useGetOutputConfig({ query: { enabled: open } });
  
  const saveStreamConfig = useSaveStreamConfig();
  const saveOutputConfig = useSaveOutputConfig();

  const [streamData, setStreamData] = useState<any>({ platform: 'twitch', rtmpUrl: '', streamKey: '' });
  const [outputData, setOutputData] = useState<any>({
    resolution: '1080p',
    fps: 60,
    videoBitrate: 6000,
    audioBitrate: 160,
    encoder: 'H264',
    recordingEnabled: false,
    recordingFormat: 'mp4'
  });

  // Sync when data loads
  React.useEffect(() => {
    if (streamConfig) setStreamData(streamConfig);
  }, [streamConfig]);

  React.useEffect(() => {
    if (outputConfig) setOutputData(outputConfig);
  }, [outputConfig]);

  const handleSave = () => {
    saveStreamConfig.mutate({ data: streamData });
    saveOutputConfig.mutate({ data: outputData });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl h-[600px] flex flex-col p-0 gap-0 overflow-hidden bg-background">
        <DialogHeader className="p-4 border-b border-border bg-card">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-1 overflow-hidden">
          <Tabs defaultValue="stream" className="flex w-full">
            <TabsList className="flex flex-col h-full w-48 bg-card border-r border-border rounded-none justify-start p-2 gap-1 items-stretch">
              <TabsTrigger value="general" className="justify-start data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-medium">General</TabsTrigger>
              <TabsTrigger value="stream" className="justify-start data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-medium">Stream</TabsTrigger>
              <TabsTrigger value="output" className="justify-start data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-medium">Output</TabsTrigger>
              <TabsTrigger value="audio" className="justify-start data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-medium">Audio</TabsTrigger>
              <TabsTrigger value="video" className="justify-start data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-medium">Video</TabsTrigger>
              <TabsTrigger value="hotkeys" className="justify-start data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-medium">Hotkeys</TabsTrigger>
              <TabsTrigger value="advanced" className="justify-start data-[state=active]:bg-primary/20 data-[state=active]:text-primary font-medium">Advanced</TabsTrigger>
            </TabsList>
            
            <div className="flex-1 p-6 overflow-y-auto">
              <TabsContent value="general" className="mt-0 space-y-6">
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg border-b border-border pb-2">General Settings</h3>
                  <div className="flex items-center justify-between">
                    <Label>Theme</Label>
                    <Select defaultValue="dark" disabled>
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value="dark">Dark (Default)</SelectItem></SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="stream" className="mt-0 space-y-6">
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg border-b border-border pb-2">Stream Settings</h3>
                  
                  <div className="grid gap-2">
                    <Label>Service</Label>
                    <Select 
                      value={streamData.platform} 
                      onValueChange={(val) => setStreamData({...streamData, platform: val})}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="twitch">Twitch</SelectItem>
                        <SelectItem value="youtube">YouTube - RTMPS</SelectItem>
                        <SelectItem value="facebook">Facebook Live</SelectItem>
                        <SelectItem value="custom">Custom...</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2">
                    <Label>Server / RTMP URL</Label>
                    <Input 
                      value={streamData.rtmpUrl} 
                      onChange={(e) => setStreamData({...streamData, rtmpUrl: e.target.value})}
                      placeholder="rtmp://live.twitch.tv/app"
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label>Stream Key</Label>
                    <div className="flex gap-2">
                      <Input 
                        type="password" 
                        value={streamData.streamKey}
                        onChange={(e) => setStreamData({...streamData, streamKey: e.target.value})}
                      />
                      <Button variant="outline">Show</Button>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="output" className="mt-0 space-y-6">
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg border-b border-border pb-2">Streaming</h3>
                  
                  <div className="grid grid-cols-[1fr_2fr] gap-4 items-center">
                    <Label className="text-right pr-4">Video Bitrate</Label>
                    <div className="flex items-center gap-2">
                      <Input 
                        type="number" 
                        className="w-32" 
                        value={outputData.videoBitrate}
                        onChange={(e) => setOutputData({...outputData, videoBitrate: Number(e.target.value)})}
                      />
                      <span className="text-sm text-muted-foreground">Kbps</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-[1fr_2fr] gap-4 items-center">
                    <Label className="text-right pr-4">Audio Bitrate</Label>
                    <Select 
                      value={String(outputData.audioBitrate)}
                      onValueChange={(val) => setOutputData({...outputData, audioBitrate: Number(val)})}
                    >
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="96">96</SelectItem>
                        <SelectItem value="128">128</SelectItem>
                        <SelectItem value="160">160</SelectItem>
                        <SelectItem value="320">320</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-[1fr_2fr] gap-4 items-center">
                    <Label className="text-right pr-4">Encoder</Label>
                    <Select 
                      value={outputData.encoder}
                      onValueChange={(val) => setOutputData({...outputData, encoder: val})}
                    >
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="H264">x264 (Software)</SelectItem>
                        <SelectItem value="H265">Hardware (NVENC/HEVC)</SelectItem>
                        <SelectItem value="VP9">VP9</SelectItem>
                        <SelectItem value="AV1">AV1</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-4 pt-6 border-t border-border">
                  <h3 className="font-semibold text-lg border-b border-border pb-2">Recording</h3>
                  
                  <div className="grid grid-cols-[1fr_2fr] gap-4 items-center">
                    <Label className="text-right pr-4">Enable Recording</Label>
                    <Switch 
                      checked={outputData.recordingEnabled}
                      onCheckedChange={(val) => setOutputData({...outputData, recordingEnabled: val})}
                    />
                  </div>

                  <div className="grid grid-cols-[1fr_2fr] gap-4 items-center">
                    <Label className="text-right pr-4">Recording Format</Label>
                    <Select 
                      disabled={!outputData.recordingEnabled}
                      value={outputData.recordingFormat}
                      onValueChange={(val) => setOutputData({...outputData, recordingFormat: val})}
                    >
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mkv">mkv</SelectItem>
                        <SelectItem value="mp4">mp4</SelectItem>
                        <SelectItem value="mov">mov</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </TabsContent>
              
              <TabsContent value="video" className="mt-0 space-y-6">
                 <div className="space-y-4">
                  <h3 className="font-semibold text-lg border-b border-border pb-2">Video</h3>
                  
                  <div className="grid grid-cols-[1fr_2fr] gap-4 items-center">
                    <Label className="text-right pr-4">Base (Canvas) Resolution</Label>
                    <Select 
                      value={outputData.resolution}
                      onValueChange={(val) => setOutputData({...outputData, resolution: val})}
                    >
                      <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="720p">1280x720</SelectItem>
                        <SelectItem value="1080p">1920x1080</SelectItem>
                        <SelectItem value="1440p">2560x1440</SelectItem>
                        <SelectItem value="4K">3840x2160</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-[1fr_2fr] gap-4 items-center">
                    <Label className="text-right pr-4">Common FPS Values</Label>
                    <Select 
                      value={String(outputData.fps)}
                      onValueChange={(val) => setOutputData({...outputData, fps: Number(val)})}
                    >
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="24">24</SelectItem>
                        <SelectItem value="30">30</SelectItem>
                        <SelectItem value="60">60</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                 </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <DialogFooter className="p-4 border-t border-border bg-card flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={saveStreamConfig.isPending || saveOutputConfig.isPending}>
            Apply
          </Button>
          <Button onClick={handleSave}>OK</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
