import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, streamConfigTable, outputConfigTable } from "@workspace/db";
import {
  SaveStreamConfigBody,
  StartStreamBody,
  GetStreamConfigResponse,
  SaveStreamConfigResponse,
  StartStreamResponse,
  StopStreamResponse,
  ReconnectStreamResponse,
  GetStreamStatusResponse,
  GetStreamStatsSummaryResponse,
} from "@workspace/api-zod";
import { streamManager } from "../lib/streamManager";
import { getPublicRtmpUrl, getTunnelStatus } from "../lib/boreTunnel";
import { getActiveStreams } from "../lib/rtmpServer";

const router: IRouter = Router();

// Ensure default config exists helper
async function getOrCreateStreamConfig() {
  const [config] = await db.select().from(streamConfigTable).limit(1);
  if (config) return config;
  const [created] = await db.insert(streamConfigTable).values({}).returning();
  return created;
}

router.get("/stream/config", async (req, res): Promise<void> => {
  const config = await getOrCreateStreamConfig();
  res.json(GetStreamConfigResponse.parse(config));
});

router.put("/stream/config", async (req, res): Promise<void> => {
  const parsed = SaveStreamConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(streamConfigTable).limit(1);
  let config;
  if (existing) {
    [config] = await db.update(streamConfigTable).set(parsed.data).where(eq(streamConfigTable.id, existing.id)).returning();
  } else {
    [config] = await db.insert(streamConfigTable).values(parsed.data).returning();
  }
  res.json(SaveStreamConfigResponse.parse(config));
});

router.post("/stream/start", async (req, res): Promise<void> => {
  const parsed = StartStreamBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    // Read output config so FFmpeg uses the user-configured fps and bitrate
    const [outputConfig] = await db.select().from(outputConfigTable).limit(1);
    const fps = outputConfig?.fps ?? 30;
    const videoBitrate = outputConfig?.videoBitrate ?? 1500;
    await streamManager.start(parsed.data.rtmpUrl, parsed.data.streamKey, fps, videoBitrate);
    const stats = streamManager.getStats();
    res.json(StartStreamResponse.parse(stats));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Failed to start stream" });
  }
});

/**
 * Start streaming in server-side compositing mode.
 * FFmpeg reads video/image files from uploads/ directly — no browser needed.
 * The stream continues even when the studio tab is closed.
 */
router.post("/stream/start-server", async (req, res): Promise<void> => {
  const { sceneId } = req.body as { sceneId?: number };
  if (!sceneId || typeof sceneId !== "number") {
    res.status(400).json({ error: "sceneId is required" });
    return;
  }
  try {
    const parsed = StartStreamBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [outputConfig] = await db.select().from(outputConfigTable).limit(1);
    const fps = outputConfig?.fps ?? 24;
    const videoBitrate = outputConfig?.videoBitrate ?? 1500;
    await streamManager.startServerSide(
      sceneId,
      parsed.data.rtmpUrl,
      parsed.data.streamKey,
      fps,
      videoBitrate,
    );
    const stats = streamManager.getStats();
    res.json(StartStreamResponse.parse(stats));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Failed to start server-side stream" });
  }
});

router.post("/stream/stop", async (_req, res): Promise<void> => {
  streamManager.stop();
  const stats = streamManager.getStats();
  res.json(StopStreamResponse.parse(stats));
});

router.post("/stream/reconnect", async (req, res): Promise<void> => {
  const config = await getOrCreateStreamConfig();
  await streamManager.reconnect(config.rtmpUrl, config.streamKey);
  const stats = streamManager.getStats();
  res.json(ReconnectStreamResponse.parse(stats));
});

router.get("/stream/status", async (_req, res): Promise<void> => {
  const stats = streamManager.getStats();
  res.json(GetStreamStatusResponse.parse(stats));
});

router.get("/stream/stats/summary", async (_req, res): Promise<void> => {
  res.json(GetStreamStatsSummaryResponse.parse(streamManager.getSummary()));
});

/** Returns the public RTMP ingress URL for external sources (DJI Fly, OBS, etc.) */
router.get("/stream/rtmp-ingress", async (_req, res): Promise<void> => {
  const url = getPublicRtmpUrl();
  const status = getTunnelStatus();
  const activeKeys = await getActiveStreams();
  res.json({ url, status, activeKeys });
});

export default router;
