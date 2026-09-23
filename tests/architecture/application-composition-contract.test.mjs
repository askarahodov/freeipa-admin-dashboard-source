import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  portalApplicationComposition,
  portalCentralCompatibilityTail,
  portalCompatibilityAdapters,
} from "../../worker/application-composition-contract.ts";

const root = new URL("../../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

test("application composition contract matches the production build entry and explicit owners", () => {
  assert.equal(portalApplicationComposition.productionBuildEntry, "worker/http-security-root-entry.ts");
  assert.equal(portalApplicationComposition.httpApplication, "worker/application.ts");
  assert.equal(portalApplicationComposition.scheduledOwner, "worker/application-scheduled.ts");
  assert.equal(portalApplicationComposition.frameworkOwner, "worker/framework-http-entry.ts");
  assert.equal(portalApplicationComposition.frameworkDispatchMode, "explicit-owner");
  assert.equal(portalApplicationComposition.centralCompatibilityTail, null);

  const vite = read("vite.config.ts");
  assert.match(vite, /main:\s*"\.\/worker\/http-security-root-entry\.ts"/);

  const outer = read(portalApplicationComposition.httpSecurityBoundary);
  assert.match(outer, /from "\.\/schema-migrations-entry\.ts"/);

  const schema = read(portalApplicationComposition.schemaBoundary);
  assert.match(schema, /from "\.\/application\.ts"/);

  const application = read(portalApplicationComposition.httpApplication);
  assert.match(application, /from "\.\/security-composition\.ts"/);
  assert.match(application, /from "\.\/application-scheduled\.ts"/);

  assert.equal(portalCentralCompatibilityTail, null);
  assert.equal(fs.existsSync(new URL("worker/index.ts", root)), false);

  const operations = read("worker/operations-http-entry.ts");
  assert.match(operations, /from "\.\/framework-http-entry\.ts"/);
  assert.match(operations, /handleFrameworkRequest\(request, sourceEnv, ctx\)/);
});

test("remaining compatibility adapters are explicit, unique and actionable", () => {
  const paths = portalCompatibilityAdapters.map((adapter) => adapter.path);
  assert.equal(new Set(paths).size, paths.length);

  for (const adapter of portalCompatibilityAdapters) {
    assert.match(adapter.path, /^worker\/.+\.ts$/);
    assert.ok(adapter.responsibility.trim().length > 20, adapter.path);
    assert.ok(adapter.reason.trim().length > 20, adapter.path);
    assert.ok(adapter.removalCondition.trim().length > 20, adapter.path);
    assert.doesNotThrow(() => read(adapter.path), adapter.path);
  }

  assert.equal(portalCentralCompatibilityTail, null);
});

test("composition contract stays metadata-only and does not become a second route/security registry", () => {
  const source = read("worker/application-composition-contract.ts");
  assert.equal(/^import\s/m.test(source), false);
  assert.equal(source.includes("/api/"), false);
  assert.equal(source.includes("permission:"), false);
  assert.equal(source.includes("mutation:"), false);
  assert.equal(source.includes("auth:"), false);
  assert.equal(source.includes("portalRouteContracts"), false);
});
