from pathlib import Path

AUTH = [
    "admin-session-authorization",
    "local-auth",
    "local-session-management",
    "portal-permissions",
    "portal-route-contract",
    "stable-error-contract",
]

for root in ("app", "worker", "tests"):
    for path in Path(root).rglob("*"):
        if not path.is_file() or path.suffix not in {".ts", ".tsx", ".mjs"}:
            continue
        text = path.read_text()
        updated = text
        for name in AUTH:
            if root == "app":
                updated = updated.replace(f'../{name}"', f'../src/auth/{name}"').replace(f"../{name}'", f"../src/auth/{name}'")
            elif root == "worker":
                updated = updated.replace(f'../{name}.ts"', f'../src/auth/{name}.ts"').replace(f"../{name}.ts'", f"../src/auth/{name}.ts'")
                updated = updated.replace(f'../{name}"', f'../src/auth/{name}"').replace(f"../{name}'", f"../src/auth/{name}'")
            else:
                updated = updated.replace(f'../{name}.ts"', f'../src/auth/{name}.ts"').replace(f"../{name}.ts'", f"../src/auth/{name}.ts'")
        if updated != text:
            path.write_text(updated)

Path("tests/auth-runtime-domain-path-contract.test.mjs").write_text('''import assert from "node:assert/strict";\nimport { access, readFile } from "node:fs/promises";\nimport test from "node:test";\n\nconst canonicalPaths = [\n  "src/auth/local-auth.ts",\n  "src/auth/local-session-management.ts",\n  "src/auth/admin-session-authorization.ts",\n];\n\ntest("runtime auth implementations live only under src/auth", async () => {\n  for (const canonicalPath of canonicalPaths) {\n    const canonical = await readFile(new URL(`../${canonicalPath}`, import.meta.url), "utf8");\n    assert.ok(canonical.length > 100, `${canonicalPath} must own the implementation`);\n    const rootPath = canonicalPath.replace("src/auth/", "");\n    await assert.rejects(access(new URL(`../${rootPath}`, import.meta.url)), { code: "ENOENT" });\n  }\n});\n''')

Path("tests/auth-canonical-source-contract.test.mjs").write_text('''import assert from "node:assert/strict";\nimport { access, readFile } from "node:fs/promises";\nimport test from "node:test";\n\nconst owners = ["portal-permissions", "portal-route-contract", "stable-error-contract"];\n\ntest("declarative auth contracts live only under src/auth", async () => {\n  for (const owner of owners) {\n    const canonical = await readFile(new URL(`../src/auth/${owner}.ts`, import.meta.url), "utf8");\n    assert.ok(canonical.length > 100, owner);\n    await assert.rejects(access(new URL(`../${owner}.ts`, import.meta.url)), { code: "ENOENT" });\n  }\n});\n''')

path = Path("tests/auth-e2e-routing.test.mjs")
text = path.read_text().replace('  assert.deepEqual(categoriesForPath("local-auth.ts"), ["auth"]);\n', '')
text = text.replace('  for (const path of ["portal-permissions.ts", "src/auth/portal-permissions.ts", "src/auth/portal-route-contract.ts"]) {', '  for (const path of ["src/auth/portal-permissions.ts", "src/auth/portal-route-contract.ts"]) {')
path.write_text(text)

path = Path("tests/portal-permissions-ui-integration.test.mjs")
text = path.read_text().replace('assert.match(page, /from\\s+["\']\\.\\.\\/portal-permissions["\']/u);', 'assert.match(page, /from\\s+["\']\\.\\.\\/src\\/auth\\/portal-permissions["\']/u);')
path.write_text(text)

path = Path("scripts/auth-e2e-scope.mjs")
text = path.read_text()
text = text.replace(r'^(?:local-auth\.ts|admin-session-authorization\.ts|src\/auth\/(?:local-auth|local-session-management|admin-session-authorization)\.ts', r'^(?:src\/auth\/(?:local-auth|local-session-management|admin-session-authorization)\.ts')
text = text.replace(r'^(?:portal-permissions\.ts|admin-session-authorization\.ts|src\/auth\/(?:portal-permissions|portal-route-contract|admin-session-authorization)\.ts', r'^(?:src\/auth\/(?:portal-permissions|portal-route-contract|admin-session-authorization)\.ts')
path.write_text(text)

path = Path("scripts/pr-collision-guard.mjs")
text = path.read_text()
for line in ('  "portal-permissions.ts",\n', '  "local-auth.ts",\n', '  "local-session-management.ts",\n', '  "admin-session-authorization.ts",\n'):
    text = text.replace(line, '')
path.write_text(text)

path = Path("tests/pr-collision-guard.test.mjs")
text = path.read_text()
text = text.replace('    "portal-permissions.ts", "src/auth/portal-permissions.ts", "src/auth/portal-route-contract.ts",', '    "src/auth/portal-permissions.ts", "src/auth/portal-route-contract.ts",')
text = text.replace('    "local-auth.ts", "src/auth/local-auth.ts", "local-session-management.ts", "src/auth/local-session-management.ts", "admin-session-authorization.ts", "src/auth/admin-session-authorization.ts", "docs/SOURCE_OF_TRUTH.md",', '    "src/auth/local-auth.ts", "src/auth/local-session-management.ts", "src/auth/admin-session-authorization.ts", "docs/SOURCE_OF_TRUTH.md",')
path.write_text(text)

active_docs = [
    "docs/reference/API.md", "docs/reference/PERMISSIONS.md", "docs/reference/ERROR_CODES.md",
    "docs/ERROR_CODE_OWNERSHIP.md", "docs/SOURCE_OF_TRUTH.md", "docs/README.md",
    "docs/DOCUMENTATION_REAUDIT_2026-08-27.md", "docs/DOCUMENTATION_INVENTORY.md",
    "docs/ai/README.md", "docs/development/REQUIRED_CHECKS.md",
    "docs/development/ROOT_MODULE_MIGRATION_MAP.md",
]
for filename in active_docs:
    path = Path(filename)
    text = path.read_text()
    for name in AUTH:
        text = text.replace(f'`{name}.ts`', f'`src/auth/{name}.ts`')
    text = text.replace('[`../../portal-permissions.ts`](../../portal-permissions.ts)', '[`../../src/auth/portal-permissions.ts`](../../src/auth/portal-permissions.ts)')
    path.write_text(text)

path = Path("docs/development/ROOT_MODULE_MIGRATION_MAP.md")
text = path.read_text()
marker = "Risk: **high**. These modules participate in authorization, session and route contracts. Move only after all `app/`, `worker/`, `runtime/`, tests and scripts importing them are enumerated. Do not combine this move with auth/RBAC behavior changes.\n"
note = "\nCurrent #267 checkpoint: all six auth/access/contract implementations are canonical under `src/auth/`; active app/Worker/test/script consumers use canonical paths directly, auth/RBAC E2E routing and collision ownership are keyed to `src/auth/`, and the temporary root compatibility shims are removed. Authorization, cookie/session, RBAC, route metadata and stable-error semantics are unchanged.\n"
if note.strip() not in text:
    text = text.replace(marker, marker + note)
path.write_text(text)

path = Path("tests/documentation-reference-layer.test.mjs")
text = path.read_text()
text = text.replace(r'/`portal-route-contract\.ts` is the canonical machine-readable owner/', r'/`src\/auth\/portal-route-contract\.ts` is the canonical machine-readable owner/')
text = text.replace(r'/HTTP\/API route metadata[^\n]+`portal-route-contract\.ts`/', r'/HTTP\/API route metadata[^\n]+`src\/auth\/portal-route-contract\.ts`/')
text = text.replace(r'/Canonical machine-readable HTTP route metadata.*`portal-route-contract\.ts`/', r'/Canonical machine-readable HTTP route metadata.*`src\/auth\/portal-route-contract\.ts`/')
text = text.replace(r'/`stable-error-contract\.ts` is the normalized machine-readable ownership and verification surface/', r'/`src\/auth\/stable-error-contract\.ts` is the normalized machine-readable ownership and verification surface/')
path.write_text(text)

for name in AUTH:
    root = Path(f"{name}.ts")
    if root.exists():
        root.unlink()
