import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/focus-ring.css", import.meta.url), "utf8");

test("shared keyboard focus ring remains at least 2px", () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /outline:\s*2px\s+solid/);
  assert.match(css, /outline-offset:\s*2px/);
});
