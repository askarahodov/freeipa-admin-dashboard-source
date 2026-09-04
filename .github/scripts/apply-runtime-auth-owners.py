from pathlib import Path

root = Path('.')
(root / 'src/auth').mkdir(parents=True, exist_ok=True)

moves = {
    'local-auth.ts': 'src/auth/local-auth.ts',
    'local-session-management.ts': 'src/auth/local-session-management.ts',
    'admin-session-authorization.ts': 'src/auth/admin-session-authorization.ts',
}

for src, dst in moves.items():
    source = (root / src).read_text()
    if src == 'local-auth.ts':
        source = source.replace('from "./login-rate-limit.ts"', 'from "../../login-rate-limit.ts"')
    elif src == 'admin-session-authorization.ts':
        source = source.replace('from "./src/storage/', 'from "../storage/')
    (root / dst).write_text(source)
    (root / src).write_text(f'export * from "./{dst}";\n')

router = root / 'scripts/auth-e2e-scope.mjs'
s = router.read_text()
s = s.replace('(?:local-auth\\.ts|admin-session-authorization\\.ts|app\\/login\\/.*', '(?:local-auth\\.ts|admin-session-authorization\\.ts|src\\/auth\\/(?:local-auth|local-session-management|admin-session-authorization)\\.ts|app\\/login\\/.*')
s = s.replace('(?:portal-permissions\\.ts|admin-session-authorization\\.ts|src\\/auth\\/(?:portal-permissions|portal-route-contract)\\.ts', '(?:portal-permissions\\.ts|admin-session-authorization\\.ts|src\\/auth\\/(?:portal-permissions|portal-route-contract|admin-session-authorization)\\.ts')
router.write_text(s)

collision = root / 'scripts/pr-collision-guard.mjs'
s = collision.read_text()
s = s.replace('  "local-auth.ts",\n  "admin-session-authorization.ts",', '  "local-auth.ts",\n  "src/auth/local-auth.ts",\n  "local-session-management.ts",\n  "src/auth/local-session-management.ts",\n  "admin-session-authorization.ts",\n  "src/auth/admin-session-authorization.ts",')
collision.write_text(s)

routing_test = root / 'tests/auth-e2e-routing.test.mjs'
s = routing_test.read_text()
s = s.replace('assert.deepEqual(categoriesForPath("local-auth.ts"), ["auth"]);', 'assert.deepEqual(categoriesForPath("local-auth.ts"), ["auth"]);\n  assert.deepEqual(categoriesForPath("src/auth/local-auth.ts"), ["auth"]);\n  assert.deepEqual(categoriesForPath("src/auth/local-session-management.ts"), ["auth"]);\n  assert.deepEqual(categoriesForPath("src/auth/admin-session-authorization.ts"), ["auth", "rbac"]);')
routing_test.write_text(s)

collision_test = root / 'tests/pr-collision-guard.test.mjs'
s = collision_test.read_text()
s = s.replace('"local-auth.ts", "admin-session-authorization.ts", "docs/SOURCE_OF_TRUTH.md",', '"local-auth.ts", "src/auth/local-auth.ts", "local-session-management.ts", "src/auth/local-session-management.ts", "admin-session-authorization.ts", "src/auth/admin-session-authorization.ts", "docs/SOURCE_OF_TRUTH.md",')
collision_test.write_text(s)

admin_test = root / 'tests/admin-session-settings.test.mjs'
s = admin_test.read_text().replace('new URL("../admin-session-authorization.ts", import.meta.url)', 'new URL("../src/auth/admin-session-authorization.ts", import.meta.url)')
admin_test.write_text(s)

contract = root / 'tests/auth-runtime-domain-path-contract.test.mjs'
contract.write_text('''import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\n\nconst read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");\n\ntest("runtime auth implementations are canonical under src/auth with exact root shims", async () => {\n  const pairs = [\n    ["local-auth.ts", "src/auth/local-auth.ts"],\n    ["local-session-management.ts", "src/auth/local-session-management.ts"],\n    ["admin-session-authorization.ts", "src/auth/admin-session-authorization.ts"],\n  ];\n  for (const [shimPath, canonicalPath] of pairs) {\n    const [shim, canonical] = await Promise.all([read(shimPath), read(canonicalPath)]);\n    assert.equal(shim, `export * from "./${canonicalPath}";\\n`);\n    assert.ok(canonical.length > shim.length, `${canonicalPath} must own the implementation`);\n  }\n});\n''')
