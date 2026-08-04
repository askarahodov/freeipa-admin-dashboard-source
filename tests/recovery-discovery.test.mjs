import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import test from "node:test";

import {
  discoverPortalDatabase,
} from "../recovery-discovery.ts";

const sqliteHeader = Buffer.from("SQLite format 3\0", "binary");

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "portal-recovery-discovery-"));
  return { root };
}

async function sqliteFile(path, suffix = "fixture") {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.concat([sqliteHeader, Buffer.from(suffix)]), { mode: 0o600 });
}

function inspector(matches) {
  return {
    async inspectPortalDatabase(path) {
      return matches.has(path)
        ? { matches: true, schemaVersion: 3 }
        : { matches: false, schemaVersion: 0 };
    },
  };
}

async function expectCode(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

test("discovers one canonical portal database without relying on its extension", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const candidate = join(value.root, "state", "v3", "d1", "opaque-hash");
  await sqliteFile(candidate);

  assert.equal(await discoverPortalDatabase({
    dataRoot: value.root,
    sqlite: inspector(new Set([candidate])),
  }), candidate);
});

test("ignores fake sqlite extensions nonmatching databases and symlinks", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const canonical = join(value.root, "canonical.db");
  const other = join(value.root, "other.sqlite");
  const fake = join(value.root, "fake.sqlite");
  const linked = join(value.root, "linked.sqlite");
  await sqliteFile(canonical);
  await sqliteFile(other);
  await writeFile(fake, "not sqlite", { mode: 0o600 });
  await symlink(canonical, linked);

  assert.equal(await discoverPortalDatabase({
    dataRoot: value.root,
    sqlite: inspector(new Set([canonical])),
  }), canonical);
});

test("returns safe not-found and ambiguous errors", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const left = join(value.root, "left.db");
  const right = join(value.root, "nested", "right.db");
  await sqliteFile(left);
  await sqliteFile(right);

  await expectCode(discoverPortalDatabase({
    dataRoot: value.root,
    sqlite: inspector(new Set()),
  }), "recovery_database_not_found");

  await assert.rejects(discoverPortalDatabase({
    dataRoot: value.root,
    sqlite: inspector(new Set([left, right])),
  }), (error) => {
    assert.equal(error.code, "recovery_database_ambiguous");
    assert.deepEqual(error.candidates, [relative(value.root, left), relative(value.root, right)].sort());
    assert.equal(error.candidates.every((path) => !path.startsWith("/")), true);
    return true;
  });
});

test("bounds recursive depth and total regular files", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const deep = join(value.root, "a", "b", "c", "candidate.db");
  await sqliteFile(deep);
  await expectCode(discoverPortalDatabase({
    dataRoot: value.root,
    maxDepth: 2,
    sqlite: inspector(new Set([deep])),
  }), "recovery_scan_limit_exceeded");

  const manyRoot = join(value.root, "many");
  await mkdir(manyRoot);
  await Promise.all(Array.from({ length: 4 }, (_, index) => writeFile(join(manyRoot, `file-${index}`), "x")));
  await expectCode(discoverPortalDatabase({
    dataRoot: manyRoot,
    maxFiles: 3,
    sqlite: inspector(new Set()),
  }), "recovery_scan_limit_exceeded");
});

test("caps disclosed ambiguous candidates", async (t) => {
  const value = await fixture();
  t.after(() => rm(value.root, { recursive: true, force: true }));
  const paths = [];
  for (let index = 0; index < 14; index += 1) {
    const path = join(value.root, `candidate-${String(index).padStart(2, "0")}`);
    paths.push(path);
    await sqliteFile(path);
  }
  await assert.rejects(discoverPortalDatabase({
    dataRoot: value.root,
    sqlite: inspector(new Set(paths)),
  }), (error) => error.code === "recovery_database_ambiguous" && error.candidates.length === 10);
});

test("source does not hardcode Wrangler D1 paths or filename extensions", async () => {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../recovery-discovery.ts", import.meta.url), "utf8"));
  assert.equal(source.includes(".wrangler/state/v3/d1"), false);
  assert.doesNotMatch(source, /endsWith\([^)]*\.sqlite/u);
  assert.doesNotMatch(source, /glob|fast-glob/u);
});
