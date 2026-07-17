import { spawn, type ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { logger } from "./logger";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const NodeMediaServer = require("node-media-server");

export const HLS_ROOT = "/tmp/hls";

interface StreamEntry {
  ffmpeg: ChildProcess;
  startedAt: string;
}

const activeStreams = new Map<string, StreamEntry>();

function keyFromPath(streamPath: string): string {
  const parts = streamPath.split("/");
  return parts[parts.length - 1] || "stream";
}

export function getActiveStreams(): string[] {
  return Array.from(activeStreams.keys());
}

export function isStreamActive(key: string): boolean {
  return activeStreams.has(key);
}

export function createRtmpServer(rtmpPort = 1935): void {
  fs.mkdirSync(HLS_ROOT, { recursive: true });

  const nms = new NodeMediaServer({
    rtmp: {
      port: rtmpPort,
      chunk_size: 60000,
      gop_cache: true,
      ping: 30,
      ping_timeout: 60,
    },
    logType: 3, // verbose — show all connections
  });

  // Fired once the publisher is confirmed live
  nms.on("postPublish", (_id: string, streamPath: string) => {
    const key = keyFromPath(streamPath);
    logger.info({ key, streamPath }, "RTMP stream live — starting HLS transcode");

    const hlsDir = path.join(HLS_ROOT, key);
    fs.mkdirSync(hlsDir, { recursive: true });

    // Pull the stream back from NMS via loopback and transcode to HLS.
    // -c:v copy avoids re-encoding (DJI Fly sends H264); -c:a aac ensures
    // AAC audio for HLS. Segment length 1s + 5-segment rolling window keeps
    // latency around 5s on the viewer side.
    const proc = spawn(
      "ffmpeg",
      [
        "-i", `rtmp://127.0.0.1:${rtmpPort}${streamPath}`,
        "-c:v", "copy",
        "-c:a", "aac",
        "-f", "hls",
        "-hls_time", "1",
        "-hls_list_size", "5",
        "-hls_flags", "delete_segments+append_list",
        "-hls_allow_cache", "0",
        path.join(hlsDir, "index.m3u8"),
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    proc.stderr?.on("data", (d: Buffer) => {
      const line = d.toString().trim();
      if (line && !line.startsWith("frame=")) {
        logger.debug({ key, ffmpeg: line }, "HLS transcode");
      }
    });

    proc.on("close", (code) => {
      logger.info({ key, code }, "HLS transcode process ended");
      activeStreams.delete(key);
    });

    proc.on("error", (err) => {
      logger.error({ key, err }, "HLS transcode process error");
      activeStreams.delete(key);
    });

    activeStreams.set(key, { ffmpeg: proc, startedAt: new Date().toISOString() });
  });

  nms.on("donePublish", (_id: string, streamPath: string) => {
    const key = keyFromPath(streamPath);
    logger.info({ key }, "RTMP publisher disconnected");
    const entry = activeStreams.get(key);
    if (entry) {
      entry.ffmpeg.kill("SIGTERM");
      activeStreams.delete(key);
    }
  });

  try {
    nms.run();
    logger.info({ rtmpPort }, "RTMP ingest server started");
  } catch (err) {
    logger.error({ err }, "Failed to start RTMP ingest server");
  }
}
