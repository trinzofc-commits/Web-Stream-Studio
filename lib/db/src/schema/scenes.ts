import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const scenesTable = pgTable("scenes", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id").notNull(),
  name: text("name").notNull(),
  thumbnail: text("thumbnail"),
  transitionType: text("transition_type").notNull().default("fade"),
  transitionDurationMs: integer("transition_duration_ms").notNull().default(300),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSceneSchema = createInsertSchema(scenesTable).omit({ id: true, createdAt: true });
export type InsertScene = z.infer<typeof insertSceneSchema>;
export type Scene = typeof scenesTable.$inferSelect;
