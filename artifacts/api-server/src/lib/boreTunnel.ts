import { spawn, type ChildProcess } from "child_process";
import { execSync } from "child_process";
import fs from "fs";
import { logger } from "./logger";

/**
 * Bore binary resolution order:
 *   1. BORE_BIN env var (explicit override)
 *   2. "bore" in system PATH (Docker image installs it to /usr/local/bin/bore)
 *   3. /tmp/bore (downloaded at runtime on Replit / bare Node)
 */
const BORE_BIN = process.env.BORE_BIN ?? resolveSystemBore();
const BORE_HOST = "bore.pub";
const BORE_DOWNLOAD_URL =
  "https://github.com/ekzhang/bore/releases/download/v0.5.0/bore-v0.5.0-x86_64-unknown-linux-musl.tar.gz";

function resolveSystemBore(): string {
  try {
    execSync("bore --version", { stdio: "pipe", timeout: 3_000 });
    return "bore"; // in PATH
  } catch {
    return "/tmp/bore"; // fall back to runtime-downloaded path
  }
}

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
  if (BORE_BIN === "bore") return; // system PATH — always available
  if (fs.existsSync(BORE_BIN)) return;

  logger.info("bore binary not found — downloading…");
  execSync(
    `wget -q "${BORE_DOWNLOAD_URL}" -O /tmp/bore.tar.gz && ` +
    `tar -xzf /tmp/bore.tar.gz -C /tmp/ && ` +
    `chmod +x "${BORE_BIN}"`,
    { timeout: 60_000, stdio: "pipe" },
  );
  logger.info("bore binary downloaded successfully");
}

export function startBoreTunnel(localPort = 1935): void {
  try {
    ensureBoreBinary();
  } catch (err) {
    logger.error({ err }, "Cannot start bore tunnel — retrying in 15 s");
    // Retry after delay so transient download failures recover automatically
    setTimeout(() => startBoreTunnel(localPort), 15_000);
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
      logger.error({ err }, "Bore tunnel error — retrying in 5 s");
      publicUrl = null;
      publicPort = null;
      tunnelProcess = null;
      setTimeout(() => startBoreTunnel(localPort), 5_000);
    });

    logger.info({ localPort }, "Starting bore tunnel for RTMP…");
  } catch (err) {
    logger.error({ err }, "Failed to spawn bore tunnel — retrying in 5 s");
    tunnelProcess = null;
    setTimeout(() => startBoreTunnel(localPort), 5_000);
  }
}
