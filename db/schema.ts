import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const appSettings = sqliteTable("app_settings", {
  id: text("id").primaryKey(),
  configJson: text("config_json").notNull(),
  encryptedSecrets: text("encrypted_secrets").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const operationRuns = sqliteTable("operation_runs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").notNull(),
  eventId: text("event_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull(),
  mode: text("mode").notNull(),
  status: text("status").notNull(),
  actor: text("actor").notNull(),
  subject: text("subject").notNull(),
  error: text("error"),
  stagesJson: text("stages_json").notNull().default("[]"),
  startedAt: integer("started_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at"),
});

export const xyopsCatalogSnapshot = sqliteTable("xyops_catalog_snapshot", {
  id: text("id").primaryKey(),
  catalogJson: text("catalog_json").notNull(),
  syncedAt: integer("synced_at").notNull(),
});

export const xyopsCatalogHistory = sqliteTable("xyops_catalog_history", {
  id: text("id").primaryKey(),
  syncedAt: integer("synced_at").notNull(),
  changesJson: text("changes_json").notNull(),
  catalogJson: text("catalog_json").notNull(),
});
