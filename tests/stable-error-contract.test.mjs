import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { stableErrorContracts, getStableErrorContract } from "../src/auth/stable-error-contract.ts";

test("stable error registry has unique namespace/code ownership", () => {
  const seen = new Map();
  for (const entry of stableErrorContracts) {
    assert.match(entry.code, /^[a-z0-9]+(?:_[a-z0-9]+)*$/);
    assert.ok(entry.domain.length > 0);
    assert.ok(entry.owner.length > 0);
    const key = `${entry.namespace}:${entry.code}`;
    assert.equal(seen.has(key), false, `duplicate stable error contract: ${key}`);
    seen.set(key, entry);
  }
});

test("same code cannot silently carry conflicting semantics across namespaces", () => {
  const byCode = new Map();
  for (const entry of stableErrorContracts) {
    const existing = byCode.get(entry.code);
    if (!existing) {
      byCode.set(entry.code, entry);
      continue;
    }
    assert.equal(existing.domain, entry.domain, `conflicting domain for ${entry.code}`);
    assert.equal(existing.owner, entry.owner, `conflicting owner for ${entry.code}`);
  }
});

test("registry lookup is namespace aware", () => {
  assert.equal(getStableErrorContract("maintenance_operation_conflict", "api")?.httpStatus, 409);
  assert.equal(getStableErrorContract("maintenance_operation_conflict", "status"), undefined);
});

test("ERROR_CODES reference contains every registered stable code", async () => {
  const reference = await readFile(new URL("../docs/reference/ERROR_CODES.md", import.meta.url), "utf8");
  for (const entry of stableErrorContracts) {
    assert.match(reference, new RegExp(`\\b${entry.code}\\b`), `missing ${entry.code} from ERROR_CODES.md`);
  }
});

test("human messages and audit action names are not registry entries", () => {
  for (const entry of stableErrorContracts) {
    assert.equal(entry.code.includes("."), false, `audit-style action leaked into code registry: ${entry.code}`);
    assert.equal(/\s/.test(entry.code), false, `human text leaked into code registry: ${entry.code}`);
  }
});
