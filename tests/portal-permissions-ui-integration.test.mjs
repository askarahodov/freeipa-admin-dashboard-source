import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Home consumes canonical portal RBAC types and labels", () => {
  assert.match(page, /from\s+["']\.\.\/portal-permissions["']/u);
  assert.match(page, /type\s+PortalRole/u);
  assert.match(page, /type\s+PortalPermission/u);
  assert.match(page, /\bportalRoleLabels\b/u);

  assert.doesNotMatch(page, /\btype\s+PortalRole\s*=\s*["']viewer["']/u);
  assert.doesNotMatch(page, /\btype\s+PortalPermission\s*=\s*["']directory\.read["']/u);
  assert.doesNotMatch(page, /\bconst\s+roleLabels\b/u);
});

test("Home keeps existing client-side permission gates while centralizing definitions", () => {
  for (const permission of ["freeipa.write", "freeipa.delete", "xyops.run", "xyops.approve", "settings.manage"]) {
    assert.match(page, new RegExp(`permissions\\.includes\\(["']${permission.replace(".", "\\.")}["']\\)`, "u"));
  }
  assert.match(page, /portalRoleLabels\[integration\.access\.role\]/u);
});
