/**
 * serverCompositor.ts
 *
 * Builds FFmpeg filter_complex arguments for server-side scene compositing.
 * Reads video/image sources directly from the uploads/ directory so the stream
 * continues even when no browser tab is open.
 *
 * Supported source types (server-renderable):
 *   - "video"         — uploaded MP4/WebM, looped infinitely
 *   - "videoPlaylist" — first URL in the playlist, looped
 *   - "image"         — uploaded PNG/JPG, static
 *   - "color"         — solid colour fill (no upload needed)
 *
 * Unsupported (require browser): camera, browser, rtmp
 * Those are silently skipped; if none remain a black frame is used.
 */

import path from "path";
import fs from "fs";
import { db, sourcesTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { logger } from "./logger.js";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

export interface CompositionResult {
  /** Full FFmpeg argument list (inputs + filter_complex + encode + output) */
  args: string[];
}

/**
 * Resolve a /api/uploads/files/<name> URL to an absolute local path.
 * Returns null if the file does not exist on disk.
 */
function resolveUploadPath(url: string): string | null {
  if (!url?.startsWith("/api/uploads/files/")) return null;
  const filename = path.basename(url);
  const filePath = path.join(UPLOADS_DIR, filename);
  return fs.existsSync(filePath) ? filePath : null;
}

export async function buildServerCompositionArgs(
  sceneId: number,
  canvasW = 1280,
  canvasH = 720,
  fps = 24,
  videoBitrate = 1500,
): Promise<CompositionResult> {
  // ── 1. Load visible sources ordered bottom → top ───────────────────────────
  const allSources = await db
    .select()
    .from(sourcesTable)
    .where(eq(sourcesTable.sceneId, sceneId))
    .orderBy(asc(sourcesTable.sortOrder));

  const visibleSources = allSources.filter((s) => s.visible);

  // Keep only sources we can render without a browser
  type RenderableSource = typeof visibleSources[number] & {
    _filePath: string;
    _isVideo: boolean;
  };

  const renderable: RenderableSource[] = [];

  for (const src of visibleSources) {
    const settings = (src.settings ?? {}) as Record<string, unknown>;

    if (src.type === "color") {
      // No file needed — handled in filter as a color source
      renderable.push({ ...src, _filePath: "", _isVideo: false });
      continue;
    }

    let url: string | null = null;
    if (src.type === "video" || src.type === "image") {
      url = (settings.url as string) ?? null;
    } else if (src.type === "videoPlaylist") {
      const urls = (settings.urls as string[]) ?? [];
      url = urls[0] ?? null;
    }

    if (!url) continue;
    const filePath = resolveUploadPath(url);
    if (!filePath) {
      logger.warn({ url, sceneId }, "serverCompositor: upload file not found — skipping source");
      continue;
    }

    const isVideo = src.type === "video" || src.type === "videoPlaylist";
    renderable.push({ ...src, _filePath: filePath, _isVideo: isVideo });
  }

  logger.info(
    { sceneId, total: visibleSources.length, renderable: renderable.length },
    "serverCompositor: building composition",
  );

  // ── 2. Fallback — no renderable sources ───────────────────────────────────
  if (renderable.length === 0) {
    return buildBlackFrame(canvasW, canvasH, fps, videoBitrate);
  }

  // ── 3. Build FFmpeg inputs ─────────────────────────────────────────────────
  const inputArgs: string[] = [];
  const videoInputLabels: string[] = [];
  const audioInputLabels: string[] = [];
  let nextIdx = 0;

  for (const src of renderable) {
    if (src.type === "color") {
      const color = ((src.settings as any)?.color as string) ?? "black";
      inputArgs.push(
        "-f", "lavfi",
        "-i", `color=c=${color}:size=${canvasW}x${canvasH}:r=${fps}`,
      );
    } else if (src._isVideo) {
      inputArgs.push("-stream_loop", "-1", "-i", src._filePath);
    } else {
      inputArgs.push("-loop", "1", "-i", src._filePath);
    }
    videoInputLabels.push(`[${nextIdx}:v]`);
    if (src._isVideo) audioInputLabels.push(`[${nextIdx}:a]`);
    nextIdx++;
  }

  // ── 4. Build filter_complex ───────────────────────────────────────────────
  const filterParts: string[] = [];

  // Black canvas background (always added as the compositing base)
  filterParts.push(`color=c=black:size=${canvasW}x${canvasH}:r=${fps}[_bg]`);

  // Scale + pad each source into its bounding box, then overlay
  let prevLabel = "_bg";

  for (let i = 0; i < renderable.length; i++) {
    const src = renderable[i];
    const sx = Math.round(src.x ?? 0);
    const sy = Math.round(src.y ?? 0);
    const sw = Math.max(1, Math.round(src.width ?? canvasW));
    const sh = Math.max(1, Math.round(src.height ?? canvasH));
    // Clamp opacity to [0,1]
    const alpha = Math.min(1, Math.max(0, (src.opacity ?? 100) / 100)).toFixed(3);

    const scaledLabel = `_s${i}`;
    const isLast = i === renderable.length - 1;
    const outLabel = isLast ? "_vout" : `_t${i}`;

    if (src.type === "color") {
      // Color fill: just scale to bounding box, apply opacity
      filterParts.push(
        `${videoInputLabels[i]}scale=${sw}:${sh},format=rgba,colorchannelmixer=aa=${alpha}[${scaledLabel}]`,
      );
    } else {
      // Scale to fit within bounding box, letterbox with black, apply opacity
      filterParts.push(
        `${videoInputLabels[i]}` +
        `scale=${sw}:${sh}:force_original_aspect_ratio=decrease,` +
        `pad=${sw}:${sh}:(ow-iw)/2:(oh-ih)/2:color=black,` +
        `setpts=PTS-STARTPTS,format=rgba,` +
        `colorchannelmixer=aa=${alpha}[${scaledLabel}]`,
      );
    }

    filterParts.push(
      `[${prevLabel}][${scaledLabel}]overlay=${sx}:${sy}:format=auto[${outLabel}]`,
    );
    prevLabel = outLabel;
  }

  // ── 5. Audio mix ──────────────────────────────────────────────────────────
  let audioMapArg: string;
  if (audioInputLabels.length > 0) {
    if (audioInputLabels.length === 1) {
      filterParts.push(`${audioInputLabels[0]}aresample=44100,aformat=channel_layouts=stereo[_aout]`);
    } else {
      filterParts.push(
        `${audioInputLabels.join("")}amix=inputs=${audioInputLabels.length}:duration=longest,` +
        `aresample=44100,aformat=channel_layouts=stereo[_aout]`,
      );
    }
    audioMapArg = "[_aout]";
  } else {
    // No audio — silent lavfi input
    inputArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100");
    audioMapArg = `${nextIdx}:a`;
  }

  const filterComplex = filterParts.join("; ");

  // ── 6. Encode args ────────────────────────────────────────────────────────
  const bitrateK = `${videoBitrate}k`;
  const maxrateK = `${Math.round(videoBitrate * 1.2)}k`;
  const gop = fps * 2;

  const args = [
    "-probesize", "32",
    "-analyzeduration", "0",
    ...inputArgs,
    "-filter_complex", filterComplex,
    "-map", "[_vout]",
    "-map", audioMapArg,
    "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
    "-b:v", bitrateK, "-minrate", bitrateK, "-maxrate", maxrateK, "-bufsize", bitrateK,
    "-x264-params", "nal-hrd=cbr:force-cfr=1",
    "-pix_fmt", "yuv420p", "-g", String(gop),
    "-fps_mode", "cfr", "-r", String(fps),
    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
    "-f", "flv", "pipe:1",
  ];

  return { args };
}

/** Fallback: black frame + silence — used when no renderable sources found. */
function buildBlackFrame(
  canvasW: number,
  canvasH: number,
  fps: number,
  videoBitrate: number,
): CompositionResult {
  const bitrateK = `${videoBitrate}k`;
  const maxrateK = `${Math.round(videoBitrate * 1.2)}k`;
  const gop = fps * 2;
  return {
    args: [
      "-f", "lavfi", "-i", `color=c=black:size=${canvasW}x${canvasH}:r=${fps}`,
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
      "-map", "0:v", "-map", "1:a",
      "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
      "-b:v", bitrateK, "-minrate", bitrateK, "-maxrate", maxrateK, "-bufsize", bitrateK,
      "-x264-params", "nal-hrd=cbr:force-cfr=1",
      "-pix_fmt", "yuv420p", "-g", String(gop),
      "-fps_mode", "cfr", "-r", String(fps),
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
      "-f", "flv", "pipe:1",
    ],
  };
}
