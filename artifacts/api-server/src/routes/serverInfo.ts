import { Router } from "express";
import os from "os";
import { getPublicRtmpUrl } from "../lib/boreTunnel";

const router = Router();

router.get("/server/info", (_req, res) => {
  const interfaces = os.networkInterfaces();
  const localIps: string[] = [];

  for (const iface of Object.values(interfaces)) {
    for (const addr of iface ?? []) {
      if (addr.family === "IPv4" && !addr.internal) {
        localIps.push(addr.address);
      }
    }
  }

  res.json({
    localIps,
    rtmpPort: 1935,
    publicRtmpUrl: getPublicRtmpUrl(),
  });
});

export default router;
