import { pgTable, text, serial, timestamp, integer, real, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sourcesTable = pgTable("sources", {
  id: serial("id").primaryKey(),
  sceneId: integer("scene_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  settings: jsonb("settings").default({}),
  x: real("x").notNull().default(0),
  y: real("y").notNull().default(0),
  width: real("width").notNull().default(640),
  height: real("height").notNull().default(360),
  rotation: real("rotation").notNull().default(0),
  opacity: real("opacity").notNull().default(100),
  visible: boolean("visible").notNull().default(true),
  locked: boolean("locked").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSourceSchema = createInsertSchema(sourcesTable).omit({ id: true, createdAt: true });
export type InsertSource = z.infer<typeof insertSourceSchema>;
export type Source = typeof sourcesTable.$inferSelect;
