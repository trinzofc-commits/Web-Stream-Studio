import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, audioTracksTable } from "@workspace/db";
import { serialize } from "../lib/serialize";
import {
  UpdateAudioTrackParams,
  UpdateAudioTrackBody,
  DeleteAudioTrackParams,
  CreateAudioTrackBody,
  ListAudioTracksResponse,
  CreateAudioTrackResponse,
  UpdateAudioTrackResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/audio/tracks", async (req, res): Promise<void> => {
  const tracks = await db.select().from(audioTracksTable).orderBy(audioTracksTable.id);
  res.json(ListAudioTracksResponse.parse(serialize(tracks)));
});

router.post("/audio/tracks", async (req, res): Promise<void> => {
  const parsed = CreateAudioTrackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [track] = await db.insert(audioTracksTable).values({ ...parsed.data, filters: {} }).returning();
  res.status(201).json(CreateAudioTrackResponse.parse(serialize(track)));
});

router.patch("/audio/tracks/:id", async (req, res): Promise<void> => {
  const params = UpdateAudioTrackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateAudioTrackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [track] = await db.update(audioTracksTable).set(parsed.data).where(eq(audioTracksTable.id, params.data.id)).returning();
  if (!track) {
    res.status(404).json({ error: "Audio track not found" });
    return;
  }
  res.json(UpdateAudioTrackResponse.parse(serialize(track)));
});

router.delete("/audio/tracks/:id", async (req, res): Promise<void> => {
  const params = DeleteAudioTrackParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db.delete(audioTracksTable).where(eq(audioTracksTable.id, params.data.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Audio track not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
