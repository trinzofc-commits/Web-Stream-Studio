import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { createWebSocketServer } from "./lib/websocket";
import { seedInitialData } from "./lib/seed";
import { createRtmpServer } from "./lib/rtmpServer";
import { startBoreTunnel } from "./lib/boreTunnel";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

// Attach WebSocket server
createWebSocketServer(server);

server.listen(port, async (err?: Error) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }
  logger.info({ port }, "Server listening");
  await seedInitialData();
  createRtmpServer(1935);
  startBoreTunnel(1935);

  // Self-ping every 10 minutes so cloud platforms (Render, etc.) never sleep
  // the server mid-stream. The interval is deliberatly shorter than most
  // platforms' idle-timeout (usually 15–30 min).
  const KEEP_ALIVE_MS = 10 * 60 * 1000;
  setInterval(async () => {
    try {
      await fetch(`http://localhost:${port}/api/healthz`);
      logger.debug("Keep-alive ping OK");
    } catch (e) {
      logger.warn({ err: e }, "Keep-alive ping failed");
    }
  }, KEEP_ALIVE_MS);
});
