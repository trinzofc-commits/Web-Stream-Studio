# Livestream Studio (OBS Web)

A browser-based livestreaming studio inspired by OBS, with scene management, source control, audio mixing, and stream output.

## Architecture

pnpm monorepo with three artifacts:

| Artifact | Path | Description |
|---|---|---|
| `livestream-studio` | `artifacts/livestream-studio` | React + Vite frontend (Tailwind, shadcn/ui, TanStack Query) |
| `api-server` | `artifacts/api-server` | Express + Node.js REST API with WebSocket support |
| `mockup-sandbox` | `artifacts/mockup-sandbox` | Design/component preview sandbox |

Shared libraries under `lib/`:
- `lib/db` — Drizzle ORM schema + PostgreSQL client (`DATABASE_URL` auto-provisioned)
- `lib/api-zod` — Zod schemas for request/response validation
- `lib/api-client-react` — Auto-generated React Query hooks from the OpenAPI spec
- `lib/api-spec` — OpenAPI spec + Orval codegen config

## How to run

All workflows are pre-configured. The main ones:

- **Livestream Studio (frontend):** `artifacts/livestream-studio: web`
- **API Server (backend):** `artifacts/api-server: API Server`

Both read `PORT` and `DATABASE_URL` from the environment (auto-set by Replit).

## Database

Uses Replit's built-in PostgreSQL. Schema is managed with Drizzle Kit.

To push schema changes:
```bash
cd lib/db && pnpm run push
```

## Stack

- Frontend: React 19, Vite 7, Tailwind CSS 4, shadcn/ui, Wouter, TanStack Query, Framer Motion
- Backend: Express 5, Node.js, WebSocket (ws), Multer (file uploads), Fluent FFmpeg
- DB: PostgreSQL via Drizzle ORM
- Validation: Zod
- Package manager: pnpm workspaces

## User preferences

- Vietnamese preferred for communication
