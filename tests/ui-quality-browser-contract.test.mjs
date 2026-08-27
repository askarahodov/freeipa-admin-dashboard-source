import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("UI browser quality spec covers keyboard focus and the required viewport matrix", async () => {
  const source = await read("e2e/specs/ui-quality.spec.mjs");
  assert.match(source, /keyboard order/iu);
  assert.match(source, /toBeFocused\(\)/u);
  assert.match(source, /outlineWidth/u);
  for (const viewport of ["1440", "1024", "390"]) assert.ok(source.includes(viewport), `missing viewport width ${viewport}`);
});

test("UI browser quality spec protects visible artifacts from credentials and internal-host fixtures", async () => {
  const source = await read("e2e/specs/ui-quality.spec.mjs");
  assert.match(source, /not\.toContainText\(adminPassword\)/u);
  assert.match(source, /not\.toContainText\(\/\(\?:ldap\|pg\\d\+\)\\\.softrust\\\.ru\/iu\)/u);
  assert.match(source, /local-auth-toolbar.*toBeVisible/u);
});

test("phase 1 does not create fake screenshot showcase routes", async () => {
  const source = await read("e2e/specs/ui-quality.spec.mjs");
  assert.equal(source.includes("toHaveScreenshot"), false);
  assert.equal(source.includes("/__ui"), false);
});