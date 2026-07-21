#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push

# Download mediamtx if not already present
MEDIAMTX_BIN="${MEDIAMTX_BIN:-/home/runner/workspace/bin/mediamtx}"
if [ ! -f "$MEDIAMTX_BIN" ]; then
  echo "Downloading mediamtx..."
  mkdir -p "$(dirname "$MEDIAMTX_BIN")"
  wget -q https://github.com/bluenviron/mediamtx/releases/download/v1.12.2/mediamtx_v1.12.2_linux_amd64.tar.gz -O /tmp/mediamtx.tar.gz
  tar -xzf /tmp/mediamtx.tar.gz -C "$(dirname "$MEDIAMTX_BIN")" mediamtx
  chmod +x "$MEDIAMTX_BIN"
  echo "mediamtx installed at $MEDIAMTX_BIN"
fi
