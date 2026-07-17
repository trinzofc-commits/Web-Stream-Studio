import { spawn, type ChildProcess } from "child_process";
import { logger } from "./logger";

const BORE_BIN = "/tmp/bore";
const BORE_HOST = "bore.pub";

let tunnelProcess: ChildProcess | null = null;
let publicUrl: string | null = null;

export function getPublicRtmpUrl(): string | null {
  return publicUrl;
}

export function startBoreTunnel(localPort = 1935): void {
  try {
    const proc = spawn(BORE_BIN, ["local", String(localPort), "--to", BORE_HOST], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    tunnelProcess = proc;

    const onData = (data: Buffer) => {
      const text = data.toString();
      // bore outputs: "2024-xx-xx ... listening at bore.pub:NNNNN"
      const match = text.match(/listening at ([^:\s]+):(\d+)/i) ||
                    text.match(/(bore\.pub):(\d+)/i);
      if (match && !publicUrl) {
        const port = match[2];
        publicUrl = `rtmp://${BORE_HOST}:${port}/live`;
        logger.info({ publicUrl }, "Bore tunnel established — RTMP accessible publicly");
      }
      if (text.trim()) logger.debug({ bore: text.trim() }, "bore");
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);

    proc.on("close", (code) => {
      logger.warn({ code }, "Bore tunnel closed — RTMP no longer public");
      publicUrl = null;
      tunnelProcess = null;
      // Auto-restart after 5s
      setTimeout(() => startBoreTunnel(localPort), 5000);
    });

    proc.on("error", (err) => {
      logger.error({ err }, "Bore tunnel error");
      publicUrl = null;
      tunnelProcess = null;
    });

    logger.info({ localPort }, "Starting bore tunnel for RTMP…");
  } catch (err) {
    logger.error({ err }, "Failed to start bore tunnel");
  }
}
