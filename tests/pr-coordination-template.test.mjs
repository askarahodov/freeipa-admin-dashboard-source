import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const template = fs.readFileSync(".github/pull_request_template.md", "utf8");

function markdownSection(source, heading) {
  const startMarker = `## ${heading}`;
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing ${startMarker} section`);
  const rest = source.slice(start + startMarker.length);
  const next = rest.search(/^## /m);
  return next === -1 ? rest : rest.slice(0, next);
}

test("pull requests expose ownership and overlap decisions before review", () => {
  const coordination = markdownSection(template, "Coordination");

  for (const field of [
    "Owning issue",
    "Canonical domain / contract",
    "High-conflict paths",
    "Dependencies / merge order",
    "Parallel-safe with",
    "Explicitly out of scope",
  ]) {
    assert.match(coordination, new RegExp(`^${field}:`, "m"), `Missing contributor field: ${field}`);
  }

  assert.match(coordination, /^- \[ \] Active pull requests and branches were inspected before implementation$/m);
  assert.match(
    coordination,
    /^- \[ \] Overlaps are absent or documented above with explicit ownership and merge order$/m,
  );
});
