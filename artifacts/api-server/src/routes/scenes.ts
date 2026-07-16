import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, scenesTable, sourcesTable } from "@workspace/db";
import { serialize } from "../lib/serialize";
import {
  ListScenesParams,
  CreateSceneParams,
  CreateSceneBody,
  UpdateSceneParams,
  UpdateSceneBody,
  DeleteSceneParams,
  DuplicateSceneParams,
  ReorderScenesBody,
  ListScenesResponse,
  CreateSceneResponse,
  UpdateSceneResponse,
  DuplicateSceneResponse,
  ReorderScenesResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/projects/:projectId/scenes", async (req, res): Promise<void> => {
  const params = ListScenesParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const scenes = await db
    .select()
    .from(scenesTable)
    .where(eq(scenesTable.projectId, params.data.projectId))
    .orderBy(asc(scenesTable.sortOrder));
  res.json(ListScenesResponse.parse(serialize(scenes)));
});

router.post("/projects/:projectId/scenes", async (req, res): Promise<void> => {
  const params = CreateSceneParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateSceneBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Get next sort order
  const existing = await db.select().from(scenesTable).where(eq(scenesTable.projectId, params.data.projectId));
  const sortOrder = existing.length;
  const [scene] = await db
    .insert(scenesTable)
    .values({ ...parsed.data, projectId: params.data.projectId, sortOrder })
    .returning();
  res.status(201).json(CreateSceneResponse.parse(serialize(scene)));
});

router.patch("/scenes/:id", async (req, res): Promise<void> => {
  const params = UpdateSceneParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateSceneBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [scene] = await db.update(scenesTable).set(parsed.data).where(eq(scenesTable.id, params.data.id)).returning();
  if (!scene) {
    res.status(404).json({ error: "Scene not found" });
    return;
  }
  res.json(UpdateSceneResponse.parse(serialize(scene)));
});

router.delete("/scenes/:id", async (req, res): Promise<void> => {
  const params = DeleteSceneParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(scenesTable).where(eq(scenesTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Scene not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/scenes/:id/duplicate", async (req, res): Promise<void> => {
  const params = DuplicateSceneParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [original] = await db.select().from(scenesTable).where(eq(scenesTable.id, params.data.id));
  if (!original) {
    res.status(404).json({ error: "Scene not found" });
    return;
  }
  const existing = await db.select().from(scenesTable).where(eq(scenesTable.projectId, original.projectId));
  const { id: _id, createdAt: _ca, ...rest } = original;
  const [copy] = await db
    .insert(scenesTable)
    .values({ ...rest, name: `${original.name} (Copy)`, sortOrder: existing.length })
    .returning();

  // Duplicate sources too
  const sources = await db.select().from(sourcesTable).where(eq(sourcesTable.sceneId, params.data.id));
  for (const src of sources) {
    const { id: _sid, createdAt: _sca, ...srcRest } = src;
    await db.insert(sourcesTable).values({ ...srcRest, sceneId: copy.id });
  }

  res.status(201).json(DuplicateSceneResponse.parse(serialize(copy)));
});

router.post("/scenes/reorder", async (req, res): Promise<void> => {
  const parsed = ReorderScenesBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { projectId, sceneIds } = parsed.data;
  for (let i = 0; i < sceneIds.length; i++) {
    await db.update(scenesTable).set({ sortOrder: i }).where(eq(scenesTable.id, sceneIds[i]));
  }
  const scenes = await db
    .select()
    .from(scenesTable)
    .where(eq(scenesTable.projectId, projectId))
    .orderBy(asc(scenesTable.sortOrder));
  res.json(ReorderScenesResponse.parse(serialize(scenes)));
});

export default router;
