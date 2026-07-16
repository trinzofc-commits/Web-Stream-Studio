import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const outputConfigTable = pgTable("output_config", {
  id: serial("id").primaryKey(),
  resolution: text("resolution").notNull().default("1080p"),
  aspectRatio: text("aspect_ratio").notNull().default("landscape"),
  fps: integer("fps").notNull().default(30),
  videoBitrate: integer("video_bitrate").notNull().default(4000),
  audioBitrate: integer("audio_bitrate").notNull().default(128),
  encoder: text("encoder").notNull().default("H264"),
  recordingEnabled: boolean("recording_enabled").notNull().default(false),
  recordingFormat: text("recording_format").notNull().default("mp4"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertOutputConfigSchema = createInsertSchema(outputConfigTable).omit({ id: true, updatedAt: true });
export type InsertOutputConfig = z.infer<typeof insertOutputConfigSchema>;
export type OutputConfig = typeof outputConfigTable.$inferSelect;
