---
name: FFmpeg streaming race condition fix
description: Root causes of "LIVE but 0 fps 0 kb/s" and Facebook not receiving stream
---

## Problem
Browser showed "LIVE" timer but FFmpeg reported 0 fps / 0 kb/s, and Facebook never received video.

## Root Causes

### 1. Race condition — frames lost before ws.on("message") is registered
`_doAttach()` used to register `ws.on("message")` AFTER the async `publisher.connect()` call (which takes 2–5 seconds to do TLS handshake + RTMP commands with Facebook). During those seconds, the browser was already sending JPEG frames (it starts immediately on ws.onopen). In Node.js EventEmitter, events emitted before a listener is registered are silently discarded. By the time the handler was registered, the initial burst of frames was lost. FFmpeg then had no frames to probe (analyzeduration), so it would never start encoding.

**Fix**: Register `ws.on("message")` IMMEDIATELY when ws is attached, before `publisher.connect()`. Buffer arriving frames in a ring buffer (max 150 frames). Flush to FFmpeg stdin right after FFmpeg spawns.

### 2. `-use_wallclock_as_timestamps 1` sets analyzeduration=0
This FFmpeg option internally sets `analyzeduration=0`, which means FFmpeg doesn't wait for any data during the probing phase. With `image2pipe`, FFmpeg needs at least one complete JPEG to determine frame dimensions. With analyzeduration=0 and no frames arriving (due to race condition), FFmpeg would fail probing.

**Fix**: Remove `-use_wallclock_as_timestamps 1` entirely. With `-framerate INPUT_FPS`, FFmpeg correctly assigns timestamps based on frame index without needing wall clock.

### 3. `-vsync cfr` deprecated in FFmpeg 6.x
FFmpeg 6.1.2 deprecates `-vsync` in favor of `-fps_mode`.

**Fix**: Use `-fps_mode cfr` instead of `-vsync cfr`.

### 4. `aevalsrc=0:s=44100` generates mono audio
The `:s=` shorthand generates mono. For stereo output, use `anullsrc=channel_layout=stereo:sample_rate=44100`.

## Constants that must stay in sync
- `INPUT_FPS = 24` in `streamManager.ts` MUST match `TARGET_FPS = 24` in `useCanvasStream.ts`
- FFmpeg `-framerate` uses INPUT_FPS; output `-r fps` uses the configured fps (default 30)

## How to apply
Any time the streaming pipeline is modified, ensure:
1. ws.on("message") is registered before any async operation in _doAttach()
2. No -use_wallclock_as_timestamps flag
3. Use -fps_mode cfr (not -vsync cfr) for FFmpeg 6.x
4. INPUT_FPS matches TARGET_FPS in the browser hook
