import { Router } from "express";
import { getActiveStreams, isStreamActive } from "../lib/rtmpServer";
import { getPublicRtmpUrl, getTunnelStatus } from "../lib/boreTunnel";

const router = Router();

/** List currently live RTMP streams */
router.get("/rtmp/streams", async (_req, res) => {
  const streams = await getActiveStreams();
  res.json({ streams });
});

/** Check if a specific stream path is live (e.g. key = "live/abc123") */
router.get("/rtmp/streams/:key", async (req, res) => {
  const { key } = req.params;
  const streams = await getActiveStreams();
  res.json({ key, live: streams.includes(key!) });
});

/**
 * Public RTMP ingest status — called by the frontend PropertiesPanel
 * to display connection info for DJI Fly / OBS.
 */
router.get("/rtmp/status", async (_req, res) => {
  const [activeStreams, publicUrl, tunnelStatus] = await Promise.all([
    getActiveStreams(),
    Promise.resolve(getPublicRtmpUrl()),
    Promise.resolve(getTunnelStatus()),
  ]);

  res.json({
    publicUrl,      // e.g. "rtmp://bore.pub:12345/live"
    tunnelStatus,   // "starting" | "connected" | "disconnected"
    activeStreams,  // e.g. ["live/abc123"]
  });
});

export default router;
