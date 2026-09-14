import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const workerRoot = new URL("../../worker/", import.meta.url);

async function workerSources() {
  const entries = await readdir(workerRoot, { recursive: true, withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => new URL(entry.parentPath ? `${entry.parentPath}/${entry.name}` : entry.name, workerRoot));
  return Promise.all(files.map(async (url) => ({ url, source: await readFile(url, "utf8") })));
}

test("client headers cannot select an internally approved XYOps execution", async () => {
  const offenders = [];
  for (const { url, source } of await workerSources()) {
    if (/headers\.get\(["']x-portal-approved-execution["']\)/u.test(source)) offenders.push(url.pathname);
  }
  assert.deepEqual(offenders, []);
});
