import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function text(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("security model documents current trust boundaries and invariants", () => {
  const security = text("docs/SECURITY_MODEL.md");
  assert.match(security, /^# Security model/m);
  assert.match(security, /Portal identity is not FreeIPA identity/);
  assert.match(security, /Server-side authorization is authoritative/);
  assert.match(security, /Service-administrator boundary/);
  assert.match(security, /Secret ownership and handling/);
  assert.match(security, /Offline full restore/);
  assert.match(security, /Fail-closed versus degraded behavior/);
  assert.match(security, /Never create a generic admin bypass/);
  assert.match(security, /Never expose upstream credentials\/session material to the browser/);
});

test("documentation navigation treats the security model as active current state", () => {
  const index = text("docs/README.md");
  const inventory = text("docs/DOCUMENTATION_INVENTORY.md");
  const ai = text("docs/ai/README.md");

  assert.match(index, /\[`SECURITY_MODEL\.md`\]\(SECURITY_MODEL\.md\)/);
  assert.doesNotMatch(index, /SECURITY_MODEL\.md` пока остаётся отдельным gap/);
  assert.match(inventory, /`docs\/SECURITY_MODEL\.md`[^\n]+`verified-active`/);
  assert.match(ai, /\[`SECURITY_MODEL\.md`\]\(\.\.\/SECURITY_MODEL\.md\)/);
  assert.match(ai, /не превращать `ADMIN_TOKEN`[^\n]+generic admin bypass/);
});

test("security model keeps exact owners and operational runbooks authoritative", () => {
  const security = text("docs/SECURITY_MODEL.md");
  assert.match(security, /does not replace exact security\/reference documents or destructive-operation runbooks/);
  assert.match(security, /LOCAL_AUTH_RBAC\.md/);
  assert.match(security, /AUDIT_LOG\.md/);
  assert.match(security, /CONFIG_ENCRYPTION_KEY\.md/);
  assert.match(security, /MAINTENANCE_MODE\.md/);
  assert.match(security, /OFFLINE_FULL_RESTORE\.md/);
  assert.match(security, /DATABASE_MIGRATIONS\.md/);
});
