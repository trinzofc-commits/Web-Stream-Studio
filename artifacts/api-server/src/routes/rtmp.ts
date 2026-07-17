import { Router } from "express";
import { getActiveStreams, isStreamActive } from "../lib/rtmpServer";

const router = Router();

/** List currently live RTMP streams */
router.get("/rtmp/streams", (_req, res) => {
  res.json({ streams: getActiveStreams() });
});

/** Check if a specific stream key is live */
router.get("/rtmp/streams/:key", (req, res) => {
  const { key } = req.params;
  res.json({ key, live: isStreamActive(key!) });
});

export default router;
