import path from "path";
import { fileURLToPath } from "url";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { HLS_ROOT } from "./lib/rtmpServer";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Serve HLS segments for RTMP input sources.
// Must come before the /api router so Express resolves it first.
app.use(
  "/api/hls",
  (_req, res, next) => {
    res.setHeader("Cache-Control", "no-cache, no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    next();
  },
  express.static(HLS_ROOT),
);

// Health check — must be before the main router
app.get("/api/healthz", (_req, res) => {
  res.json({ ok: true });
});

app.use("/api", router);

// In production, serve the built frontend and handle SPA client-side routing.
// This must come AFTER all /api routes so the API takes priority.
if (process.env.NODE_ENV === "production") {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.join(__dirname, "public");
  app.use(express.static(publicDir));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

export default app;
