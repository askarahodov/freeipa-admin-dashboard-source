import { isAbsolute, relative, resolve } from "node:path";

function normalizedAbsoluteDirectory(value) {
  const directory = String(value || "/data").trim() || "/data";
  if (!isAbsolute(directory)) throw new Error("PORTAL_DATA_DIR must be absolute");
  return resolve(directory);
}

function isContained(root, candidate) {
  const relation = relative(root, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

export function resolvePortalDatabasePath(env = {}) {
  const dataDirectory = normalizedAbsoluteDirectory(env.PORTAL_DATA_DIR);
  const configuredPath = String(env.PORTAL_DATABASE_PATH || "").trim();
  if (!configuredPath) return resolve(dataDirectory, "portal.sqlite");
  if (!isAbsolute(configuredPath)) throw new Error("PORTAL_DATABASE_PATH must be absolute");

  const databasePath = resolve(configuredPath);
  if (!isContained(dataDirectory, databasePath)) {
    throw new Error("PORTAL_DATABASE_PATH must remain inside PORTAL_DATA_DIR");
  }
  return databasePath;
}

export function configureSqliteRuntimeDatabase(database) {
  if (!database || typeof database.pragma !== "function") {
    throw new Error("SQLite runtime driver must provide pragma()");
  }

  const journal = database.pragma("journal_mode = WAL");
  const journalMode = Array.isArray(journal)
    ? String(journal[0]?.journal_mode ?? "").toLowerCase()
    : "";
  if (journalMode !== "wal") throw new Error("SQLite runtime requires WAL journal mode");

  database.pragma("synchronous = NORMAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");

  return database;
}
