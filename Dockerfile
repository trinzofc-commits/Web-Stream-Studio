# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Install pnpm (version matching lock file)
RUN npm install -g pnpm@10 --quiet

# Copy workspace manifests first for better layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY lib/db/package.json                  lib/db/
COPY lib/api-zod/package.json             lib/api-zod/
COPY lib/api-spec/package.json            lib/api-spec/
COPY lib/api-client-react/package.json    lib/api-client-react/
COPY artifacts/api-server/package.json    artifacts/api-server/
COPY artifacts/livestream-studio/package.json artifacts/livestream-studio/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy full source
COPY . .

# Build frontend
# BASE_PATH and PORT are required by vite.config.ts at config-evaluation time
ENV BASE_PATH=/ PORT=3000 NODE_ENV=production
RUN pnpm --filter @workspace/livestream-studio run build

# Build backend (esbuild bundles everything into dist/index.mjs)
RUN pnpm --filter @workspace/api-server run build

# ─── Stage 2: Runner ─────────────────────────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

# ffmpeg and wget are required for RTMP → HLS stream encoding and downloading mediamtx
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg wget ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install mediamtx
RUN wget https://github.com/bluenviron/mediamtx/releases/download/v1.12.2/mediamtx_v1.12.2_linux_amd64.tar.gz -O /tmp/mediamtx.tar.gz && \
    tar -xzf /tmp/mediamtx.tar.gz -C /usr/local/bin/ && \
    rm /tmp/mediamtx.tar.gz

# Bundled API server (esbuild output — no node_modules needed)
COPY --from=builder /app/artifacts/api-server/dist ./dist

# Built frontend — Express serves this as static files in production
COPY --from=builder /app/artifacts/livestream-studio/dist/public ./dist/public

# Uploads directory (ephemeral — mount a fly.io volume or use object storage for persistence)
RUN mkdir -p ./uploads

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
