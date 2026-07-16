import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, outputConfigTable } from "@workspace/db";
import {
  SaveOutputConfigBody,
  GetOutputConfigResponse,
  SaveOutputConfigResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function getOrCreateOutputConfig() {
  const [config] = await db.select().from(outputConfigTable).limit(1);
  if (config) return config;
  const [created] = await db.insert(outputConfigTable).values({}).returning();
  return created;
}

router.get("/output/config", async (req, res): Promise<void> => {
  const config = await getOrCreateOutputConfig();
  res.json(GetOutputConfigResponse.parse(config));
});

router.put("/output/config", async (req, res): Promise<void> => {
  const parsed = SaveOutputConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db.select().from(outputConfigTable).limit(1);
  let config;
  if (existing) {
    [config] = await db.update(outputConfigTable).set(parsed.data).where(eq(outputConfigTable.id, existing.id)).returning();
  } else {
    [config] = await db.insert(outputConfigTable).values(parsed.data).returning();
  }
  res.json(SaveOutputConfigResponse.parse(config));
});

export default router;
