import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { logger } from "./logger";
import { streamManager } from "./streamManager";

export function createWebSocketServer(server: import("http").Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  logger.info("WebSocket server created on /ws");

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    logger.info({ url: req.url }, "WebSocket client connected");

    // Check if this is a browser stream client (canvas → FFmpeg pipe)
    const url = new URL(req.url ?? "", "http://localhost");
    const isStreamClient = url.searchParams.get("role") === "stream";

    if (isStreamClient) {
      // Hand off to stream manager which spawns FFmpeg and pipes binary data from this ws
      streamManager.attachStreamClient(ws);
      return;
    }

    // ── Control client ──────────────────────────────────────────────────────
    // Send current stream status immediately
    const stats = streamManager.getStats();
    ws.send(JSON.stringify({ type: "stream:status", data: stats }));

    // Subscribe to stream status updates
    const unsub = streamManager.subscribe((stats) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "stream:status", data: stats }));
      }
    });

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        logger.debug({ msg }, "WebSocket message received");

        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // ignore parse errors
      }
    });

    ws.on("close", () => {
      logger.info("WebSocket client disconnected");
      unsub();
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
      unsub();
    });
  });

  return wss;
}
