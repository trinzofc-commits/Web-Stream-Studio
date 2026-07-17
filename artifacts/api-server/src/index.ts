import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { createWebSocketServer } from "./lib/websocket";
import { seedInitialData } from "./lib/seed";
import { createRtmpServer } from "./lib/rtmpServer";

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
});
