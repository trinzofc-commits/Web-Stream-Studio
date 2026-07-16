# Livestream Studio

A professional browser-based livestream application inspired by OBS Studio. Manages scenes and sources on a canvas, mixes audio, and streams live to Facebook/YouTube/Twitch via RTMP + FFmpeg.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `pnpm --filter @workspace/livestream-studio run dev` — run the frontend (port 19108)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite + Tailwind CSS + shadcn/ui + react-resizable-panels
- API: Express 5 + WebSocket (ws)
- DB: PostgreSQL + Drizzle ORM
- Streaming: FFmpeg (fluent-ffmpeg) for RTMP output
- File uploads: multer
- Validation: Zod (zod/v4), drizzle-zod
- API codegen: Orval (from OpenAPI spec)

## Where things live

- `artifacts/livestream-studio/src/` — React frontend (single-page OBS-like layout)
- `artifacts/api-server/src/routes/` — Express routes (projects, scenes, sources, stream, output, audio, uploads)
- `artifacts/api-server/src/lib/streamManager.ts` — FFmpeg process lifecycle manager
- `artifacts/api-server/src/lib/websocket.ts` — WebSocket server for real-time stream stats
- `artifacts/api-server/src/lib/seed.ts` — Initial data seeder (runs on first boot)
- `lib/api-spec/openapi.yaml` — API contract (source of truth)
- `lib/db/src/schema/` — Drizzle table definitions (projects, scenes, sources, stream, output, audio, media)

## Architecture decisions

- **OpenAPI-first**: All API contracts defined in `openapi.yaml`, code-generated with Orval into React Query hooks + Zod schemas
- **Date serialization**: All DB rows are passed through `serialize()` (JSON round-trip) before Zod parsing to convert `Date` objects to ISO strings
- **WebSocket on /ws**: Real-time stream stats pushed to frontend; `/ws` path is registered in `artifact.toml`
- **FFmpeg streaming**: Backend spawns an FFmpeg process that pushes to RTMP endpoint; currently uses test pattern — in production the canvas video stream would be piped in
- **Seeding on startup**: Default project with 5 scenes, 3 audio tracks, default output/stream configs are seeded on first boot

## Product

- Scene management: add/rename/duplicate/delete/reorder scenes
- Source management: 16 source types on a 16:9 canvas (camera, display, image, video, audio, browser, text, QR code, clock, countdown, slideshow, video/audio playlist, PDF, logo, watermark)
- Canvas: drag, resize, layer (z-index), visibility, lock per source
- Audio mixer: per-track volume/gain/mute/solo with animated VU meters
- Stream controls: RTMP URL + stream key, Facebook/YouTube/Twitch/Custom presets, start/stop/reconnect
- Output config: resolution (720p–4K), FPS, bitrate, encoder (H264/H265/VP9/AV1)
- Project management: save/load/export JSON/import JSON
- Media library: upload and manage images, videos, audio, overlays
- Performance stats bar: FPS, bitrate, dropped frames, CPU, memory, uptime

## User preferences

_Populate as needed._

## Gotchas

- Always run `pnpm --filter @workspace/api-spec run codegen` after changing `lib/api-spec/openapi.yaml`
- Run `pnpm run typecheck:libs` after any `lib/*` schema/type changes before building artifacts
- FFmpeg must be installed on the system for streaming to work (`which ffmpeg`)
- WebSocket path `/ws` must stay in the API server's `artifact.toml` paths array
