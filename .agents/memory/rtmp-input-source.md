---
name: RTMP Input Source (DJI Fly)
description: How the RTMP ingest source type works — NMS + HLS transcode pipeline
---

# RTMP Input Source

**Why:** User needs to take DJI Fly drone camera feed as a studio source layer.

**Architecture:**
- `node-media-server` listens on TCP port 1935 for RTMP pushes from DJI Fly
- On `postPublish`: FFmpeg pulls from `rtmp://127.0.0.1:1935{path}`, transcodes to HLS segments at `/tmp/hls/{key}/`
- Express serves HLS at `/api/hls/{key}/index.m3u8` (path `/api` is proxied by Replit to api-server)
- Browser: `hls.js` in `StreamCompositor` plays HLS in a hidden `<video>` element, drawn on canvas

**Key constraint:** Port 1935 is raw TCP — not proxied by Replit's HTTP proxy. DJI Fly device must reach the server directly on port 1935 (same network or publicly exposed).

**How to apply:** Source type string is `'rtmp'`. `streamKey` in source settings selects the stream. HLS URL is `/api/hls/{streamKey}/index.m3u8`.

**Status polling:** PropertiesPanel polls `/api/rtmp/streams/{key}` every 3s to show live indicator.
