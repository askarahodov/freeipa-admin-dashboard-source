import assert from "node:assert/strict";
import test from "node:test";

import {
  MaintenanceRepositoryError,
  cancelMaintenance,
  completeMaintenance,
  enterMaintenance,
  exitMaintenance,
  loadMaintenanceState,
  prepareMaintenance,
  startMaintenanceVerification,
} from "../maintenance-repository.ts";

const operationId = "maintenance_11111111-1111-4111-8111-111111111111";
const secret = "A".repeat(43);
const secretHash = "1".repeat(64);
const actor = { identity: "admin@example.test", groups: ["portal-admins", "ops"] };
const verification = {
  integrity: "ok",
  schema: "ok",
  administratorAccess: "ok",
  settingsDecryption: "ok",
  auditWrite: "ok",
};

function result(changes = 0) {
  return { success: true, meta: { changes } };
}

class MaintenanceD1 {
  row = null;
  sessions = new Set(["session-1", "session-2"]);
  batchCalls = [];
  fail = false;

  prepare(sql) {
    let values = [];
    const normalized = sql.replace(/\s+/g, " ").trim();
    const statement = {
      sql: normalized,
      values: () => [...values],
      bind: (...args) => { values = args; return statement; },
      first: async () => {
        if (this.fail) throw new Error("raw D1 connection and secret detail");
        if (!normalized.startsWith("SELECT id, state, operation_id")) throw new Error(`Unsupported first SQL: ${normalized}`);
        return this.row ? { ...this.row } : null;
      },
      run: async () => this.run(normalized, values),
    };
    return statement;
  }

  async batch(statements) {
    if (this.fail) throw new Error("raw D1 batch and secret detail");
    this.batchCalls.push(statements.map((statement) => ({ sql: statement.sql, values: statement.values() })));
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }

  async run(sql, values) {
    if (this.fail) throw new Error("raw D1 statement and secret detail");
    if (sql.startsWith("INSERT OR IGNORE INTO portal_maintenance_state")) {
      if (!this.row) {
        this.row = {
          id: "main",
          state: "inactive",
          operation_id: null,
          actor_identity: null,
          actor_groups_json: "[]",
          controller_secret_hash: null,
          created_at: null,
          updated_at: values[0],
          expires_at: null,
          completed_at: null,
          failure_code: null,
          verification_json: "{}",
        };
        return result(1);
      }
      return result(0);
    }
    if (sql.startsWith("UPDATE portal_maintenance_state SET state = 'entering'")) {
      if (this.row?.state !== "inactive") return result(0);
      const [id, identity, groupsJson, hash, createdAt, updatedAt, expiresAt] = values;
      Object.assign(this.row, {
        state: "entering",
        operation_id: id,
        actor_identity: identity,
        actor_groups_json: groupsJson,
        controller_secret_hash: hash,
        created_at: createdAt,
        updated_at: updatedAt,
        expires_at: expiresAt,
        completed_at: null,
        failure_code: null,
        verification_json: "{}",
      });
      return result(1);
    }
    if (sql.startsWith("UPDATE portal_maintenance_state SET state = 'active'")) {
      const [updatedAt, id, hash, now] = values;
      if (this.row?.state !== "entering" || this.row.operation_id !== id
          || this.row.controller_secret_hash !== hash || !(this.row.expires_at > now)) return result(0);
      Object.assign(this.row, { state: "active", updated_at: updatedAt, expires_at: null });
      return result(1);
    }
    if (sql.startsWith("DELETE FROM portal_sessions WHERE EXISTS")) {
      if (this.row?.state !== "active") return result(0);
      const changes = this.sessions.size;
      this.sessions.clear();
      return result(changes);
    }
    if (sql.startsWith("UPDATE portal_maintenance_state SET state = 'verifying'")) {
      const [updatedAt, id, hash] = values;
      if (this.row?.state !== "active" || this.row.operation_id !== id || this.row.controller_secret_hash !== hash) return result(0);
      Object.assign(this.row, { state: "verifying", updated_at: updatedAt });
      return result(1);
    }
    if (sql.startsWith("UPDATE portal_maintenance_state SET state = 'exiting'")) {
      const [verificationJson, updatedAt, id, hash] = values;
      if (this.row?.state !== "verifying" || this.row.operation_id !== id || this.row.controller_secret_hash !== hash) return result(0);
      Object.assign(this.row, { state: "exiting", verification_json: verificationJson, updated_at: updatedAt });
      return result(1);
    }
    if (sql.startsWith("UPDATE portal_maintenance_state SET state = 'inactive'")) {
      const isCancel = sql.includes("AND state = 'entering'");
      const [updatedAt, completedAt, id, hash, ...(tail)] = values;
      const expectedState = isCancel ? "entering" : "exiting";
      const now = tail[0];
      if (this.row?.state !== expectedState || this.row.operation_id !== id || this.row.controller_secret_hash !== hash) return result(0);
      if (isCancel && !(this.row.expires_at > now)) return result(0);
      Object.assign(this.row, {
        state: "inactive",
        operation_id: null,
        actor_identity: null,
        actor_groups_json: "[]",
        controller_secret_hash: null,
        created_at: null,
        updated_at: updatedAt,
        expires_at: null,
        completed_at: completedAt,
        failure_code: null,
        verification_json: "{}",
      });
      return result(1);
    }
    throw new Error(`Unsupported run SQL: ${sql}`);
  }
}

function prepareOptions(now = 1_000) {
  return {
    now: () => now,
    createOperationId: () => operationId,
    createSecret: () => secret,
    hashSecret: async (value) => {
      assert.equal(value, secret);
      return secretHash;
    },
  };
}

function transitionInput(action, now = 2_000, extra = {}) {
  const prefixes = { enter: "ENTER", verify: "VERIFY", exit: "EXIT", complete: "RESUME", cancel: "CANCEL" };
  return {
    operationId,
    controllerSecret: secret,
    confirmation: `${prefixes[action]}:${operationId}`,
    now,
    ...extra,
  };
}

function transitionDependencies() {
  return {
    hashSecret: async (value) => {
      assert.equal(value, secret);
      return secretHash;
    },
  };
}

test("allows exactly one concurrent prepare and stores only the controller hash", async () => {
  const db = new MaintenanceD1();
  const [first, second] = await Promise.allSettled([
    prepareMaintenance(db, actor, prepareOptions()),
    prepareMaintenance(db, actor, prepareOptions()),
  ]);
  assert.equal([first, second].filter((item) => item.status === "fulfilled").length, 1);
  const rejected = [first, second].find((item) => item.status === "rejected");
  assert.equal(rejected.reason instanceof MaintenanceRepositoryError, true);
  assert.equal(rejected.reason.code, "maintenance_operation_conflict");

  const prepared = [first, second].find((item) => item.status === "fulfilled").value;
  assert.equal(prepared.secret, secret);
  assert.equal(prepared.row.state, "entering");
  assert.equal(db.row.controller_secret_hash, secretHash);
  assert.equal(JSON.stringify(db.batchCalls).includes(secret), false);
  assert.equal(JSON.stringify(db.row).includes(secret), false);
});

test("enters maintenance and revokes every session in one guarded D1 batch", async () => {
  const db = new MaintenanceD1();
  await prepareMaintenance(db, actor, prepareOptions());
  const resultValue = await enterMaintenance(db, transitionInput("enter"), transitionDependencies());
  assert.equal(resultValue.state, "active");
  assert.equal(db.sessions.size, 0);
  assert.equal(db.batchCalls.length, 2);
  assert.equal(db.batchCalls[1].length, 2);
  assert.match(db.batchCalls[1][0].sql, /state = 'active'/);
  assert.match(db.batchCalls[1][1].sql, /^DELETE FROM portal_sessions WHERE EXISTS/);
});

test("rejects expired prepare, wrong secret and wrong confirmation without session mutation", async () => {
  for (const kind of ["expired", "secret", "confirmation"]) {
    const db = new MaintenanceD1();
    await prepareMaintenance(db, actor, prepareOptions());
    const input = kind === "expired"
      ? transitionInput("enter", 901_001)
      : kind === "secret"
        ? { ...transitionInput("enter"), controllerSecret: "B".repeat(43) }
        : { ...transitionInput("enter"), confirmation: "ENTER:wrong" };
    await assert.rejects(
      () => enterMaintenance(db, input, transitionDependencies()),
      (error) => error instanceof MaintenanceRepositoryError
        && ["maintenance_prepare_expired", "maintenance_controller_invalid", "maintenance_confirmation_required"].includes(error.code),
    );
    assert.equal(db.sessions.size, 2);
  }
});

test("persists active verifying and exiting states across repository instances", async () => {
  const db = new MaintenanceD1();
  await prepareMaintenance(db, actor, prepareOptions());
  await enterMaintenance(db, transitionInput("enter"), transitionDependencies());
  assert.equal((await loadMaintenanceState(db)).state, "active");

  await startMaintenanceVerification(db, transitionInput("verify", 3_000), transitionDependencies());
  assert.equal((await loadMaintenanceState(db)).state, "verifying");

  await exitMaintenance(
    db,
    transitionInput("exit", 4_000, { verification }),
    transitionDependencies(),
  );
  const freshRead = await loadMaintenanceState(db);
  assert.equal(freshRead.state, "exiting");
  assert.deepEqual(freshRead.verification, verification);
});

test("completes verified maintenance and clears operation credentials and actor metadata", async () => {
  const db = new MaintenanceD1();
  await prepareMaintenance(db, actor, prepareOptions());
  await enterMaintenance(db, transitionInput("enter"), transitionDependencies());
  await startMaintenanceVerification(db, transitionInput("verify", 3_000), transitionDependencies());
  await exitMaintenance(db, transitionInput("exit", 4_000, { verification }), transitionDependencies());
  const completed = await completeMaintenance(db, transitionInput("complete", 5_000), transitionDependencies());
  assert.equal(completed.state, "inactive");
  assert.equal(completed.operationId, null);
  assert.equal(completed.actorIdentity, null);
  assert.deepEqual(completed.actorGroups, []);
  assert.equal(completed.controllerSecretHash, null);
  assert.deepEqual(completed.verification, {});
  assert.equal(completed.completedAt, 5_000);
});

test("cancels only an unexpired entering operation", async () => {
  const db = new MaintenanceD1();
  await prepareMaintenance(db, actor, prepareOptions());
  const cancelled = await cancelMaintenance(db, transitionInput("cancel", 2_000), transitionDependencies());
  assert.equal(cancelled.state, "inactive");

  await prepareMaintenance(db, actor, prepareOptions(3_000));
  await enterMaintenance(db, transitionInput("enter", 4_000), transitionDependencies());
  await assert.rejects(
    () => cancelMaintenance(db, transitionInput("cancel", 5_000), transitionDependencies()),
    (error) => error instanceof MaintenanceRepositoryError && error.code === "maintenance_transition_invalid",
  );
});

test("normalizes load and transition failures without raw D1 details", async () => {
  const loadDb = new MaintenanceD1();
  loadDb.fail = true;
  await assert.rejects(
    () => loadMaintenanceState(loadDb),
    (error) => error instanceof MaintenanceRepositoryError
      && error.code === "maintenance_state_unavailable"
      && error.status === 503
      && !error.message.includes("raw D1"),
  );

  const transitionDb = new MaintenanceD1();
  await prepareMaintenance(transitionDb, actor, prepareOptions());
  transitionDb.fail = true;
  await assert.rejects(
    () => enterMaintenance(transitionDb, transitionInput("enter"), transitionDependencies()),
    (error) => error instanceof MaintenanceRepositoryError
      && error.code === "maintenance_transition_failed"
      && !error.message.includes("raw D1"),
  );
});
