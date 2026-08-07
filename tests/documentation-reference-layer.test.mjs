import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

function permissionCodes(source) {
  const match = source.match(/export const portalPermissionOrder:[\s\S]*?= \[([\s\S]*?)\];/);
  assert.ok(match, "portalPermissionOrder must remain discoverable");
  return [...match[1].matchAll(/"([a-z0-9.]+)"/g)].map((item) => item[1]);
}

function exportedPath(source, constant) {
  const match = source.match(new RegExp(`export const ${constant} = ["']([^"']+)["']`));
  assert.ok(match, `${constant} must remain a literal path constant`);
  return match[1];
}

function tableCodes(markdown) {
  const codes = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\| `([a-z0-9_.-]+)` \|/);
    if (match) codes.push(match[1]);
  }
  return codes;
}

test("reference layer contains all four normalized entrypoints and limitation follow-ups", async () => {
  const [api, permissions, configuration, errors] = await Promise.all([
    read("docs/reference/API.md"),
    read("docs/reference/PERMISSIONS.md"),
    read("docs/reference/CONFIGURATION.md"),
    read("docs/reference/ERROR_CODES.md"),
  ]);

  assert.match(api, /^# API reference/m);
  assert.match(permissions, /^# Permissions reference/m);
  assert.match(configuration, /^# Configuration reference/m);
  assert.match(errors, /^# Error-code reference/m);

  assert.match(api, /#121/);
  assert.match(permissions, /#119/);
  assert.match(configuration, /#123/);
  assert.match(errors, /#124/);
});

test("documentation navigation exposes the normalized reference layer as current state", async () => {
  const [index, inventory, ai] = await Promise.all([
    read("docs/README.md"),
    read("docs/DOCUMENTATION_INVENTORY.md"),
    read("docs/ai/README.md"),
  ]);

  for (const name of ["API", "PERMISSIONS", "CONFIGURATION", "ERROR_CODES"]) {
    assert.match(index, new RegExp(`reference/${name}\\.md`));
    assert.match(inventory, new RegExp(`docs/reference/${name}\\.md[^\\n]+verified-active`));
    assert.match(ai, new RegExp(`reference/${name}\\.md`));
  }

  assert.doesNotMatch(index, /normalized API\/permissions\/error-code\/configuration reference;/);
  assert.match(ai, /not a second runtime source of truth|не создавать второй API\/RBAC\/config\/error-code registry/iu);
});

test("permissions reference tracks the canonical built-in permission order", async () => {
  const [source, reference] = await Promise.all([
    read("portal-permissions.ts"),
    read("docs/reference/PERMISSIONS.md"),
  ]);

  const codes = permissionCodes(source);
  assert.equal(codes.length, 14, "unexpected canonical permission count; review this contract intentionally");
  for (const code of codes) assert.match(reference, new RegExp(`\\\`${code.replaceAll(".", "\\.")}\\\``));

  assert.ok(codes.includes("backup.restore.preview"));
  assert.match(reference, /backup\.restore\.preview/);
  assert.match(reference, /canonical|канонич/iu);
  assert.doesNotMatch(reference, /backup\.restore\.preview[^\n]{0,180}(not canonical|not promoted|orphan)/iu);
});

test("API reference tracks known literal storage route constants", async () => {
  const [api, status, integrity, preflight, apply] = await Promise.all([
    read("docs/reference/API.md"),
    read("storage-status-contract.ts"),
    read("storage-integrity-contract.ts"),
    read("storage-migration-preflight-contract.ts"),
    read("storage-migration-apply-contract.ts"),
  ]);

  const paths = [
    exportedPath(status, "STORAGE_STATUS_PATH"),
    exportedPath(integrity, "STORAGE_INTEGRITY_PATH"),
    exportedPath(preflight, "STORAGE_MIGRATION_PREFLIGHT_PATH"),
    exportedPath(apply, "STORAGE_MIGRATION_APPLY_PATH"),
    exportedPath(apply, "STORAGE_MIGRATION_APPLY_STATUS_PATH"),
    exportedPath(apply, "STORAGE_MIGRATION_RECONCILE_PATH"),
  ];

  for (const path of paths) assert.ok(api.includes(`\`${path}\``), `missing API reference path: ${path}`);
  assert.match(api, /\/api\/integrations\/routes.*not.*HTTP API registry/is);
});

test("configuration reference separates operator settings from ephemeral Gateway credentials", async () => {
  const [example, configuration] = await Promise.all([
    read(".env.example"),
    read("docs/reference/CONFIGURATION.md"),
  ]);

  for (const name of [
    "ADMIN_TOKEN",
    "CONFIG_ENCRYPTION_KEY",
    "PORTAL_IDENTITY_MODE",
    "PORTAL_BOOTSTRAP_ADMIN_PASSWORD",
    "IPA_URL",
    "IPA_USERNAME",
    "IPA_PASSWORD",
    "XYOPS_URL",
    "XYOPS_API_KEY",
  ]) {
    assert.ok(example.includes(`${name}=`), `.env.example no longer documents ${name}`);
    assert.match(configuration, new RegExp(`\\\`${name}\\\``));
  }

  assert.match(configuration, /`IPA_NODE_GATEWAY_TOKEN`.*internal ephemeral runtime values/is);
  assert.match(configuration, /Do not add these values to `\.env\.example` as persistent operator secrets/);
});

test("error reference has no duplicate table-row machine codes", async () => {
  const errors = await read("docs/reference/ERROR_CODES.md");
  const codes = tableCodes(errors);
  const duplicates = codes.filter((code, index) => codes.indexOf(code) !== index);
  assert.deepEqual([...new Set(duplicates)], []);

  for (const code of [
    "health_live",
    "dependencies_degraded",
    "storage_status_unavailable",
    "storage_integrity_forbidden",
    "migration_preflight_request_invalid",
    "maintenance_transition_failed",
    "backup_restore_commit_failed",
    "settings_revision_conflict",
  ]) assert.ok(errors.includes(`\`${code}\``), `missing stable machine code: ${code}`);

  assert.match(errors, /Audit `action` values[\s\S]{0,160}\*\*not\*\* API error codes/);
});
