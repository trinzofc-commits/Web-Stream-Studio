# Livestream Studio

A full-stack browser-based livestreaming compositor with scene management, multi-source mixing, RTMP ingest, and HLS playback.

## Stack

- **Frontend** (`artifacts/livestream-studio`): React + Vite + Tailwind CSS + shadcn/ui + hls.js
- **API server** (`artifacts/api-server`): Express 5 + node-media-server (RTMP) / mediamtx + FFmpeg + WebSockets + Drizzle ORM
- **Database**: PostgreSQL (Replit built-in, via Drizzle)
- **Shared libs**: `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`, `lib/db`

## How to run

Dependencies are managed with pnpm (monorepo). Install once:
```
pnpm install
```

The two workflows that need to run:
- **`artifacts/api-server: API Server`** — Express API + RTMP ingest on port 8080
- **`artifacts/livestream-studio: web`** — Vite dev server (React frontend)

On startup the API server:
1. Seeds the database with a default project and scenes (if empty)
2. Starts an RTMP ingest server on port 1935 (mediamtx)
3. Downloads and starts a `bore` tunnel to expose RTMP publicly (bore.pub)

## Environment variables

| Key | Notes |
|-----|-------|
| `DATABASE_URL` | Auto-provided by Replit — do not set manually |
| `SESSION_SECRET` | Already configured as a Replit secret |
| `PORT` | Set automatically per-artifact by Replit |
| `MEDIAMTX_BIN` | Path to mediamtx binary — set to `/home/runner/workspace/bin/mediamtx` (downloaded on first setup; **note:** this binary is not committed to git and must be re-downloaded after a fresh clone — run `wget https://github.com/bluenviron/mediamtx/releases/download/v1.12.2/mediamtx_v1.12.2_linux_amd64.tar.gz -O /tmp/mediamtx.tar.gz && tar -xzf /tmp/mediamtx.tar.gz -C bin mediamtx` from the workspace root) |

## Schema

Push schema to the dev database:
```
pnpm --filter @workspace/db run push-force
```

## RTMP streaming

Stream from DJI Fly, OBS, or any RTMP client to the public bore URL shown in the API server logs on startup, e.g.:
```
rtmp://bore.pub:<port>/live/<stream-key>
```

The stream key is configured in the app's source panel.

## User preferences

- Keep the existing monorepo structure (pnpm workspace)
- Do not restructure or migrate to a different stack without asking
