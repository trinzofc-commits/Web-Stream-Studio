---
name: RTMP Input Source
description: Full architecture for receiving DJI Fly RTMP stream → HLS → canvas preview
---

# RTMP Input Source Architecture

**Flow:** DJI Fly → bore tunnel :1935 → MediaMTX → FFmpeg → HLS files → `/api/hls/` → hls.js in frontend canvas

## MediaMTX config (per-stream-key HLS)
`runOnReady` in mediamtx.yml uses `sh -c 'mkdir -p /tmp/hls/$MTX_PATH && ffmpeg ...'` so each stream gets its own HLS directory at `/tmp/hls/$MTX_PATH/`. `$MTX_PATH` is expanded by the shell (e.g. `live/abc123`). This was changed from a hardcoded `/tmp/hls/live/index.m3u8` to support multiple simultaneous streams.

**Why:** Hardcoded path meant only one stream at a time and `isStreamActive` was always checking the same file regardless of stream key.

## HLS URL pattern
`/api/hls/live/<streamKey>/index.m3u8` — served by express.static on HLS_ROOT in app.ts.

## Bore tunnel
`boreTunnel.ts` exposes `getPublicRtmpUrl()` → `rtmp://bore.pub:PORT/live`. Full stream URL for DJI Fly: `rtmp://bore.pub:PORT/live/<streamKey>`.

## API endpoint
`GET /api/rtmp/status` → `{ publicUrl, tunnelStatus, activeStreams[] }` — used by PropertiesPanel.

## Frontend
- `SourcePanel.tsx`: `rtmp: Wifi` icon added to `sourceIcons`
- `CanvasPreview.tsx`: `RtmpSource` component polls HLS URL (HEAD request every 3s), loads with hls.js on MANIFEST_PARSED, shows "Chờ tín hiệu…" placeholder until stream connects
- `PropertiesPanel.tsx`: `RtmpSettings` component shows stream key, full RTMP URL, live status, DJI Fly instructions in Vietnamese

## DJI Fly setup
- Server URL: `rtmp://bore.pub:PORT` (without `/live`)
- Stream key: `live/<streamKey>`
- Or full URL field: `rtmp://bore.pub:PORT/live/<streamKey>`
