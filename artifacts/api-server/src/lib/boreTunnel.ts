import { spawn, type ChildProcess } from "child_process";
import { execSync } from "child_process";
import fs from "fs";
import { logger } from "./logger";

const BORE_BIN = "/tmp/bore";
const BORE_HOST = "bore.pub";
// Hardcoded download URL for bore v0.5.0 linux x86_64 musl static binary
const BORE_DOWNLOAD_URL =
  "https://github.com/ekzhang/bore/releases/download/v0.5.0/bore-v0.5.0-x86_64-unknown-linux-musl.tar.gz";

let tunnelProcess: ChildProcess | null = null;
let publicUrl: string | null = null;
let publicPort: number | null = null;

export function getPublicRtmpUrl(): string | null {
  return publicUrl;
}

export function getPublicRtmpPort(): number | null {
  return publicPort;
}

export function getTunnelStatus(): "starting" | "connected" | "disconnected" {
  if (publicUrl) return "connected";
  if (tunnelProcess) return "starting";
  return "disconnected";
}

/** Ensure bore binary exists, downloading it if not. Throws on failure. */
function ensureBoreBinary(): void {
  if (fs.existsSync(BORE_BIN)) return;

  logger.info("bore binary not found — downloading…");
  try {
    execSync(
      `curl -fsSL "${BORE_DOWNLOAD_URL}" -o /tmp/bore.tar.gz && ` +
      `tar -xzf /tmp/bore.tar.gz -C /tmp/ && ` +
      `chmod +x "${BORE_BIN}"`,
      { timeout: 60_000, stdio: "pipe" },
    );
    logger.info("bore binary downloaded successfully");
  } catch (err) {
    throw new Error(`Failed to download bore binary: ${err}`);
  }
}

export function startBoreTunnel(localPort = 1935): void {
  try {
    ensureBoreBinary();
  } catch (err) {
    logger.error({ err }, "Cannot start bore tunnel — binary unavailable");
    return;
  }

  try {
    const proc = spawn(BORE_BIN, ["local", String(localPort), "--to", BORE_HOST], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    tunnelProcess = proc;
    publicUrl = null;
    publicPort = null;

    const onData = (data: Buffer) => {
      const text = data.toString();
      // bore outputs: "listening at bore.pub:NNNNN"
      const match =
        text.match(/listening at ([^:\s]+):(\d+)/i) ||
        text.match(/(bore\.pub):(\d+)/i);
      if (match && !publicUrl) {
        const port = Number(match[2]);
        publicPort = port;
        publicUrl = `rtmp://${BORE_HOST}:${port}/live`;
        logger.info({ publicUrl }, "Bore tunnel established — RTMP publicly accessible");
      }
      if (text.trim()) logger.debug({ bore: text.trim() }, "bore");
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onData);

    proc.on("close", (code) => {
      logger.warn({ code }, "Bore tunnel closed — retrying in 5 s");
      publicUrl = null;
      publicPort = null;
      tunnelProcess = null;
      setTimeout(() => startBoreTunnel(localPort), 5_000);
    });

    proc.on("error", (err) => {
      logger.error({ err }, "Bore tunnel error");
      publicUrl = null;
      publicPort = null;
      tunnelProcess = null;
      setTimeout(() => startBoreTunnel(localPort), 5_000);
    });

    logger.info({ localPort }, "Starting bore tunnel for RTMP…");
  } catch (err) {
    logger.error({ err }, "Failed to start bore tunnel");
  }
}
