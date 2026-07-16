import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const streamConfigTable = pgTable("stream_config", {
  id: serial("id").primaryKey(),
  rtmpUrl: text("rtmp_url").notNull().default("rtmps://live-api-s.facebook.com:443/rtmp/"),
  streamKey: text("stream_key").notNull().default(""),
  platform: text("platform").notNull().default("facebook"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertStreamConfigSchema = createInsertSchema(streamConfigTable).omit({ id: true, updatedAt: true });
export type InsertStreamConfig = z.infer<typeof insertStreamConfigSchema>;
export type StreamConfig = typeof streamConfigTable.$inferSelect;
