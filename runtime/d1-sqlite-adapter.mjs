function baseMeta(values = {}) {
  return {
    duration: 0,
    changes: 0,
    last_row_id: 0,
    rows_read: 0,
    rows_written: 0,
    ...values,
  };
}

function safeLastRowId(value) {
  if (typeof value === "bigint") {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new Error("SQLite last insert row id exceeds the safe integer range");
    return number;
  }
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

export function createD1SqliteAdapter(database) {
  if (!database || typeof database.prepare !== "function" || typeof database.transaction !== "function") {
    throw new Error("SQLite driver must provide prepare() and transaction()");
  }

  const states = new WeakMap();

  function execute(state) {
    if (state.statement.reader === true) {
      const rows = state.statement.all(...state.params);
      return {
        success: true,
        results: Array.isArray(rows) ? rows : [],
        meta: baseMeta({ rows_read: Array.isArray(rows) ? rows.length : 0 }),
      };
    }

    const result = state.statement.run(...state.params) ?? {};
    const changes = Number(result.changes ?? 0);
    return {
      success: true,
      results: [],
      meta: baseMeta({
        changes: Number.isFinite(changes) ? changes : 0,
        last_row_id: safeLastRowId(result.lastInsertRowid),
        rows_written: Number.isFinite(changes) ? changes : 0,
      }),
    };
  }

  function wrap(statement, params = []) {
    const prepared = {
      bind(...values) {
        return wrap(statement, values);
      },
      async first(columnName) {
        const row = statement.get(...params);
        if (row == null) return null;
        if (columnName === undefined) return row;
        return Object.prototype.hasOwnProperty.call(row, columnName) ? row[columnName] : null;
      },
      async all() {
        if (statement.reader !== true) throw new Error("all() requires a row-returning SQLite statement");
        return execute({ statement, params });
      },
      async run() {
        if (statement.reader === true) throw new Error("run() requires a mutating SQLite statement");
        return execute({ statement, params });
      },
    };
    states.set(prepared, { statement, params: [...params] });
    return prepared;
  }

  return {
    prepare(sql) {
      if (typeof sql !== "string" || !sql.trim()) throw new Error("SQL statement must be a non-empty string");
      return wrap(database.prepare(sql));
    },
    async batch(preparedStatements) {
      if (!Array.isArray(preparedStatements)) throw new Error("batch() requires an array of prepared statements");
      const batchStates = preparedStatements.map((prepared) => {
        const state = states.get(prepared);
        if (!state) throw new Error("batch() accepts only statements prepared by this adapter");
        return state;
      });
      const transaction = database.transaction(() => batchStates.map(execute));
      return transaction();
    },
  };
}
