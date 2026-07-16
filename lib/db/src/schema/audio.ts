import { pgTable, text, serial, timestamp, integer, real, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const audioTracksTable = pgTable("audio_tracks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  sourceId: integer("source_id"),
  gain: real("gain").notNull().default(1.0),
  volume: real("volume").notNull().default(1.0),
  balance: real("balance").notNull().default(0.0),
  muted: boolean("muted").notNull().default(false),
  solo: boolean("solo").notNull().default(false),
  filters: jsonb("filters").default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAudioTrackSchema = createInsertSchema(audioTracksTable).omit({ id: true, createdAt: true });
export type InsertAudioTrack = z.infer<typeof insertAudioTrackSchema>;
export type AudioTrack = typeof audioTracksTable.$inferSelect;
