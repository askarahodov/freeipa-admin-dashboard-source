import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const appSettings = sqliteTable("app_settings", {
  id: text("id").primaryKey(),
  configJson: text("config_json").notNull(),
  encryptedSecrets: text("encrypted_secrets").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
