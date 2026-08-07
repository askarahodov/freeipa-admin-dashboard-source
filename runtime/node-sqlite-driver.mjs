import { DatabaseSync } from "node:sqlite";

function assertSinglePragma(value) {
  const source = String(value ?? "").trim();
  if (!source || /[;\r\n]/u.test(source)) {
    throw new Error("SQLite driver pragma() accepts one single PRAGMA expression");
  }
  return source;
}

export function openNodeSqliteDriver(path) {
  const database = new DatabaseSync(path);
  let closed = false;

  function ensureOpen() {
    if (closed) throw new Error("SQLite database is closed");
  }

  return {
    prepare(sql) {
      ensureOpen();
      return database.prepare(sql);
    },
    pragma(expression) {
      ensureOpen();
      const source = assertSinglePragma(expression);
      return database.prepare(`PRAGMA ${source}`).all();
    },
    transaction(run) {
      if (typeof run !== "function") throw new Error("transaction() requires a function");
      return (...args) => {
        ensureOpen();
        database.exec("BEGIN IMMEDIATE");
        try {
          const result = run(...args);
          if (result && typeof result.then === "function") {
            throw new Error("Node SQLite transactions must remain synchronous");
          }
          database.exec("COMMIT");
          return result;
        } catch (error) {
          try {
            database.exec("ROLLBACK");
          } catch {
            // Preserve the original transactional failure.
          }
          throw error;
        }
      };
    },
    close() {
      if (closed) return;
      try {
        database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      } finally {
        database.close();
        closed = true;
      }
    },
  };
}
