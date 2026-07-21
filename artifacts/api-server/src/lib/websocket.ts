import { WebSocketServer, WebSocket } from "ws";
import { IncomingMessage } from "http";
import { logger } from "./logger";
import { streamManager } from "./streamManager";

export function createWebSocketServer(server: import("http").Server) {
  const wss = new WebSocketServer({ server, path: "/ws" });

  logger.info("WebSocket server created on /ws");

  // WebSocket-level ping/pong keepalive — without this, idle connections can be
  // silently dropped by proxies or the Replit edge layer, causing the browser to
  // lose stream status updates or (worse) the FFmpeg pipe to break mid-stream.
  const PING_INTERVAL_MS = 20_000;

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    logger.info({ url: req.url }, "WebSocket client connected");

    // Check if this is a browser stream client (canvas → FFmpeg pipe)
    const url = new URL(req.url ?? "", "http://localhost");
    const isStreamClient = url.searchParams.get("role") === "stream";

    // Start WS-level ping so the connection stays alive through any proxy.
    let pingTimer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, PING_INTERVAL_MS);

    const clearPing = () => {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
    };

    if (isStreamClient) {
      // Hand off to stream manager which spawns FFmpeg and pipes binary data from this ws
      streamManager.attachStreamClient(ws);
      ws.on("close", clearPing);
      ws.on("error", clearPing);
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
      clearPing();
      unsub();
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
      clearPing();
      unsub();
    });
  });

  return wss;
}
