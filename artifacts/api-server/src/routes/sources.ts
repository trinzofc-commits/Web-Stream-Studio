import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db, sourcesTable } from "@workspace/db";
import { serialize } from "../lib/serialize";
import {
  ListSourcesParams,
  CreateSourceParams,
  CreateSourceBody,
  UpdateSourceParams,
  UpdateSourceBody,
  DeleteSourceParams,
  UpdateSourceLayerParams,
  UpdateSourceLayerBody,
  ListSourcesResponse,
  CreateSourceResponse,
  UpdateSourceResponse,
  UpdateSourceLayerResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/scenes/:sceneId/sources", async (req, res): Promise<void> => {
  const params = ListSourcesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const sources = await db
    .select()
    .from(sourcesTable)
    .where(eq(sourcesTable.sceneId, params.data.sceneId))
    .orderBy(asc(sourcesTable.sortOrder));
  res.json(ListSourcesResponse.parse(serialize(sources)));
});

router.post("/scenes/:sceneId/sources", async (req, res): Promise<void> => {
  const params = CreateSourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateSourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const existing = await db.select().from(sourcesTable).where(eq(sourcesTable.sceneId, params.data.sceneId));
  const sortOrder = existing.length;

  // Auto-generate a fixed stream key for RTMP sources if not provided
  let settings = (parsed.data.settings ?? {}) as Record<string, unknown>;
  if (parsed.data.type === "rtmp" && !settings.streamKey) {
    settings = { ...settings, streamKey: randomBytes(4).toString("hex") };
  }

  const [source] = await db
    .insert(sourcesTable)
    .values({ ...parsed.data, sceneId: params.data.sceneId, sortOrder, settings })
    .returning();
  res.status(201).json(CreateSourceResponse.parse(serialize(source)));
});

router.patch("/sources/:id", async (req, res): Promise<void> => {
  const params = UpdateSourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateSourceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [source] = await db.update(sourcesTable).set(parsed.data).where(eq(sourcesTable.id, params.data.id)).returning();
  if (!source) {
    res.status(404).json({ error: "Source not found" });
    return;
  }
  res.json(UpdateSourceResponse.parse(serialize(source)));
});

router.delete("/sources/:id", async (req, res): Promise<void> => {
  const params = DeleteSourceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(sourcesTable).where(eq(sourcesTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Source not found" });
    return;
  }
  res.sendStatus(204);
});

router.patch("/sources/:id/layer", async (req, res): Promise<void> => {
  const params = UpdateSourceLayerParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateSourceLayerBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [source] = await db.select().from(sourcesTable).where(eq(sourcesTable.id, params.data.id));
  if (!source) {
    res.status(404).json({ error: "Source not found" });
    return;
  }

  const siblings = await db
    .select()
    .from(sourcesTable)
    .where(eq(sourcesTable.sceneId, source.sceneId))
    .orderBy(asc(sourcesTable.sortOrder));

  const idx = siblings.findIndex((s) => s.id === source.id);
  const action = parsed.data.action;
  let newOrder = source.sortOrder;

  if (action === "bringToFront") {
    newOrder = siblings.length - 1;
  } else if (action === "sendToBack") {
    newOrder = 0;
  } else if (action === "bringForward" && idx < siblings.length - 1) {
    // Swap with next
    const next = siblings[idx + 1];
    await db.update(sourcesTable).set({ sortOrder: source.sortOrder }).where(eq(sourcesTable.id, next.id));
    newOrder = next.sortOrder;
  } else if (action === "sendBackward" && idx > 0) {
    // Swap with previous
    const prev = siblings[idx - 1];
    await db.update(sourcesTable).set({ sortOrder: source.sortOrder }).where(eq(sourcesTable.id, prev.id));
    newOrder = prev.sortOrder;
  }

  if (action === "bringToFront" || action === "sendToBack") {
    // Re-assign all sort orders
    const filtered = siblings.filter((s) => s.id !== source.id);
    if (action === "bringToFront") {
      for (let i = 0; i < filtered.length; i++) {
        await db.update(sourcesTable).set({ sortOrder: i }).where(eq(sourcesTable.id, filtered[i].id));
      }
    } else {
      for (let i = 0; i < filtered.length; i++) {
        await db.update(sourcesTable).set({ sortOrder: i + 1 }).where(eq(sourcesTable.id, filtered[i].id));
      }
    }
  }

  const [updated] = await db.update(sourcesTable).set({ sortOrder: newOrder }).where(eq(sourcesTable.id, params.data.id)).returning();
  res.json(UpdateSourceLayerResponse.parse(serialize(updated)));
});

export default router;
