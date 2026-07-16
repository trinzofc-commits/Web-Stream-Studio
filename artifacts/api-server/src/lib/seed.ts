import { db, projectsTable, scenesTable, audioTracksTable, outputConfigTable, streamConfigTable } from "@workspace/db";
import { logger } from "./logger";

export async function seedInitialData() {
  try {
    // Check if already seeded
    const existing = await db.select().from(projectsTable).limit(1);
    if (existing.length > 0) return;

    logger.info("Seeding initial data...");

    // Create default project
    const [project] = await db.insert(projectsTable).values({
      name: "My Livestream",
      description: "Default livestream project",
    }).returning();

    // Create default scenes
    const sceneNames = [
      { name: "Starting Soon", sortOrder: 0, transitionType: "fade" },
      { name: "Main Camera", sortOrder: 1, transitionType: "fade" },
      { name: "Screen Share", sortOrder: 2, transitionType: "cut" },
      { name: "BRB", sortOrder: 3, transitionType: "fade" },
      { name: "Ending", sortOrder: 4, transitionType: "dissolve" },
    ];

    const scenes = [];
    for (const s of sceneNames) {
      const [scene] = await db.insert(scenesTable).values({
        projectId: project.id,
        name: s.name,
        sortOrder: s.sortOrder,
        transitionType: s.transitionType,
        transitionDurationMs: 300,
      }).returning();
      scenes.push(scene);
    }

    // Set first scene as active
    await db.update(projectsTable).set({ activeSceneId: scenes[0].id });

    // Create default audio tracks
    await db.insert(audioTracksTable).values([
      { name: "Microphone", gain: 1.0, volume: 0.8, balance: 0.0, muted: false, solo: false },
      { name: "Desktop Audio", gain: 1.0, volume: 0.5, balance: 0.0, muted: false, solo: false },
      { name: "Music", gain: 0.8, volume: 0.3, balance: 0.0, muted: false, solo: false },
    ]);

    // Create default output config
    const existingOutput = await db.select().from(outputConfigTable).limit(1);
    if (existingOutput.length === 0) {
      await db.insert(outputConfigTable).values({
        resolution: "1080p",
        fps: 30,
        videoBitrate: 4000,
        audioBitrate: 128,
        encoder: "H264",
        recordingEnabled: false,
        recordingFormat: "mp4",
      });
    }

    // Create default stream config
    const existingStream = await db.select().from(streamConfigTable).limit(1);
    if (existingStream.length === 0) {
      await db.insert(streamConfigTable).values({
        rtmpUrl: "rtmps://live-api-s.facebook.com:443/rtmp/",
        streamKey: "",
        platform: "facebook",
      });
    }

    logger.info({ projectId: project.id, scenes: scenes.length }, "Seeding complete");
  } catch (err) {
    logger.error({ err }, "Seeding failed");
  }
}
