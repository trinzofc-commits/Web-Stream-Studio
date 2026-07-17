import { Router } from "express";
import os from "os";

const router = Router();

router.get("/server/info", (_req, res) => {
  const interfaces = os.networkInterfaces();
  const localIps: string[] = [];

  for (const iface of Object.values(interfaces)) {
    for (const addr of iface ?? []) {
      // IPv4, not loopback
      if (addr.family === "IPv4" && !addr.internal) {
        localIps.push(addr.address);
      }
    }
  }

  res.json({ localIps, rtmpPort: 1935 });
});

export default router;
