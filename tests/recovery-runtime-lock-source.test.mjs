import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lockSource = await readFile(new URL("../recovery-lock.ts", import.meta.url), "utf8");
const wrapperSource = await readFile(new URL("../scripts/run-portal-runtime.mjs", import.meta.url), "utf8");
const startupSource = await readFile(new URL("../scripts/start-worker.mjs", import.meta.url), "utf8");
const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");

test("lock adapter invokes GNU flock directly with fail-fast exclusivity", () => {
  assert.match(lockSource, /spawn\s*\(\s*["']\/usr\/bin\/flock["']/u);
  for (const option of ["--exclusive", "--nonblock", "--conflict-exit-code", "75", "--no-fork"]) {
    assert.equal(lockSource.includes(option), true, `missing flock option ${option}`);
  }
  assert.equal(lockSource.includes("--close"), false);
  assert.match(lockSource, /shell:\s*false/u);
});

test("runtime wrapper owns the exact persistent-volume lock and never invokes a shell", () => {
  assert.match(wrapperSource, /\/usr\/bin\/flock/u);
  assert.match(wrapperSource, /--exclusive/u);
  assert.match(wrapperSource, /--nonblock/u);
  assert.match(wrapperSource, /--conflict-exit-code/u);
  assert.match(wrapperSource, /--no-fork/u);
  assert.match(wrapperSource, /shell:\s*false/u);
  assert.doesNotMatch(wrapperSource, /execSync|spawnSync|\bsh\b|-c/u);
});

test("Docker startup routes Wrangler through the runtime lock wrapper", () => {
  assert.match(startupSource, /scripts\/run-portal-runtime\.mjs/u);
  assert.match(startupSource, /\.wrangler\/\.portal-exclusive\.lock/u);
  assert.doesNotMatch(startupSource, /unlinkSync\([^)]*portal-exclusive/u);
  assert.doesNotMatch(startupSource, /rmSync\([^)]*portal-exclusive/u);
});

test("runtime image installs flock before dropping privileges", () => {
  assert.match(dockerfile, /apt-get install[^\n\\]*(?:\\\n[^\n]*)*util-linux/u);
  assert.ok(dockerfile.indexOf("util-linux") < dockerfile.indexOf("USER dashboard"));
});
