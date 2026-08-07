import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("overview model reuses canonical portal health check names", async () => {
  const source = await read("app/overview/operational-overview-model.ts");
  for (const name of ["database", "schema", "encryption", "gateway"]) assert.ok(source.includes(`"${name}"`));
  assert.equal(source.includes("buildVersion"), false);
  assert.equal(source.includes("schemaVersion"), false);
  assert.equal(source.includes("latestSchemaVersion"), false);
});

test("operational overview prioritizes attention, health, recent operations and quick actions", async () => {
  const source = await read("app/overview/OperationalOverview.tsx");
  for (const label of ["Требует внимания", "Состояние системы", "Последние операции", "Быстрые действия"]) assert.ok(source.includes(label), label);
  assert.match(source, /PageHeader/);
  assert.match(source, /StatusBadge/);
});

test("integration degradation is modeled separately from portal-core readiness", async () => {
  const source = await read("app/overview/operational-overview-model.ts");
  assert.match(source, /freeipaReachable/);
  assert.match(source, /xyopsReachable/);
  assert.match(source, /portalCore/);
});

test("privileged attention destinations remain caller-owned instead of inferred from health", async () => {
  const model = await read("app/overview/operational-overview-model.ts");
  const component = await read("app/overview/OperationalOverview.tsx");
  assert.match(model, /attentionTargets\?:/u);
  assert.match(model, /target\?: OverviewTarget/u);
  assert.match(model, /attentionTargets\?\.\["portal-unready"\]/u);
  assert.match(model, /attentionTargets\?\.\["freeipa-degraded"\]/u);
  assert.match(model, /attentionTargets\?\.\["xyops-degraded"\]/u);
  assert.match(component, /const target = item\.target;/u);
  assert.match(component, /return target \?/u);
  assert.match(component, /props\.onNavigate\(target\)/u);
});

test("overview component does not expose diagnostics metadata, raw errors or internal URLs", async () => {
  const source = await read("app/overview/OperationalOverview.tsx");
  for (const forbidden of ["buildVersion", "schemaVersion", "latestSchemaVersion", "rawError", "internalUrl", "fetch(", "/api/"]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

test("overview styling is calm and avoids decorative dashboard card effects", async () => {
  const css = await read("app/overview/operational-overview.module.css");
  assert.match(css, /@import\s+["']\.\.\/styles\/tokens\.css["']/);
  assert.equal(css.includes("linear-gradient"), false);
  assert.equal(css.includes("translateY("), false);
  assert.equal(css.includes("box-shadow"), false);
});
