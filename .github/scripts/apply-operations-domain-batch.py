from pathlib import Path
import shutil

ROOT = Path.cwd()

moves = {
    "approval-gates.ts": "src/operations/approvals/approval-gates.ts",
    "catalog-policies.ts": "src/operations/catalog/catalog-policies.ts",
    "operation-explorer.ts": "src/operations/explorer/operation-explorer.ts",
    "src/operations/operation-explorer-legacy-bridge.ts": "src/operations/explorer/operation-explorer-legacy-bridge.ts",
    "process-presentation.ts": "src/operations/presentation/process-presentation.ts",
    "run-notifications.ts": "src/operations/run/run-notifications.ts",
    "run-replays.ts": "src/operations/run/run-replays.ts",
    "run-results.ts": "src/operations/run/run-results.ts",
}
for source, target in moves.items():
    src = ROOT / source
    dst = ROOT / target
    if not src.exists():
        raise SystemExit(f"missing source: {source}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(src, dst)

legacy_shim = ROOT / "operation-explorer-legacy-bridge.ts"
if legacy_shim.exists():
    legacy_shim.unlink()

for relative in [
    "src/operations/approvals/approval-gates.ts",
    "src/operations/catalog/catalog-policies.ts",
    "src/operations/presentation/process-presentation.ts",
    "src/operations/run/run-replays.ts",
]:
    path = ROOT / relative
    text = path.read_text()
    text = text.replace('./src/automation/', '../../automation/')
    path.write_text(text)

replacements = {
    "worker/index.ts": {
        'from "../approval-gates"': 'from "../src/operations/approvals/approval-gates"',
        'from "../catalog-policies"': 'from "../src/operations/catalog/catalog-policies"',
        'from "../process-presentation"': 'from "../src/operations/presentation/process-presentation"',
        'from "../run-notifications"': 'from "../src/operations/run/run-notifications"',
        'from "../run-replays"': 'from "../src/operations/run/run-replays"',
        'from "../run-results"': 'from "../src/operations/run/run-results"',
    },
    "app/OperationExplorer.tsx": {
        'from "../operation-explorer-legacy-bridge"': 'from "../src/operations/explorer/operation-explorer-legacy-bridge"',
        'from "../operation-explorer"': 'from "../src/operations/explorer/operation-explorer"',
    },
    "tests/operation-explorer-query.test.mjs": {
        'from "../operation-explorer.ts"': 'from "../src/operations/explorer/operation-explorer.ts"',
    },
    "tests/operation-explorer-ui.test.mjs": {
        'new URL("../operation-explorer.ts"': 'new URL("../src/operations/explorer/operation-explorer.ts"',
        'new URL("../src/operations/operation-explorer-legacy-bridge.ts"': 'new URL("../src/operations/explorer/operation-explorer-legacy-bridge.ts"',
    },
    "tests/operation-explorer-legacy-bridge.test.mjs": {
        '../src/operations/operation-explorer-legacy-bridge.ts': '../src/operations/explorer/operation-explorer-legacy-bridge.ts',
    },
}
for relative, mapping in replacements.items():
    path = ROOT / relative
    text = path.read_text()
    for old, new in mapping.items():
        if old not in text:
            raise SystemExit(f"expected literal missing in {relative}: {old}")
        text = text.replace(old, new)
    path.write_text(text)

contract = ROOT / "tests/operation-explorer-domain-path-contract.test.mjs"
text = contract.read_text()
text = text.replace("src/operations/operation-explorer-legacy-bridge.ts", "src/operations/explorer/operation-explorer-legacy-bridge.ts")
old = '''test("operation explorer bridge has a canonical operations implementation and thin root shim", async () => {\n  assert.equal(await exists("src/operations/explorer/operation-explorer-legacy-bridge.ts"), true);\n  assert.equal(\n    await readFile(path.join(repoRoot, "operation-explorer-legacy-bridge.ts"), "utf8"),\n    'export * from "./src/operations/operation-explorer-legacy-bridge";\\n',\n  );\n});'''
new = '''test("operation explorer bridge has a canonical operations implementation with no root shim", async () => {\n  assert.equal(await exists("src/operations/explorer/operation-explorer-legacy-bridge.ts"), true);\n  assert.equal(await exists("operation-explorer-legacy-bridge.ts"), false);\n});'''
if old not in text:
    raise SystemExit("operation explorer root-shim contract block not found")
text = text.replace(old, new)
text = text.replace('test("legacy operation explorer bridge imports are limited to the explicit migration allowlist", async () => {', 'test("legacy operation explorer bridge imports are absent", async () => {')
text = text.replace('assert.deepEqual(offenders.sort(), ["app/OperationExplorer.tsx"]);', 'assert.deepEqual(offenders.sort(), []);')
contract.write_text(text)

router = ROOT / "scripts/auth-e2e-scope.mjs"
text = router.read_text()
needle = 'approval[^/]*\\.(?:ts|tsx|mjs|js)|app\\/'
if needle not in text:
    raise SystemExit("xyops routing rule anchor not found")
text = text.replace(needle, 'approval[^/]*\\.(?:ts|tsx|mjs|js)|src\\/operations\\/.*\\.(?:ts|tsx|mjs|js)|app\\/', 1)
router.write_text(text)

routing_test = ROOT / "tests/auth-e2e-routing.test.mjs"
text = routing_test.read_text()
anchor = '  assert.deepEqual(buildE2ETestPlan(["xyops-client.ts"]).categories, ["xyops"]);\n'
if anchor not in text:
    raise SystemExit("routing-test anchor not found")
text = text.replace(anchor, anchor + '  assert.deepEqual(buildE2ETestPlan(["src/operations/run/run-results.ts"]).categories, ["xyops"]);\n')
routing_test.write_text(text)

ownership = ROOT / "tests/operations-domain-path-contract.test.mjs"
ownership.write_text('''import assert from "node:assert/strict";\nimport { access } from "node:fs/promises";\nimport test from "node:test";\n\nconst moved = [\n  ["../src/operations/approvals/approval-gates.ts", "../approval-gates.ts"],\n  ["../src/operations/catalog/catalog-policies.ts", "../catalog-policies.ts"],\n  ["../src/operations/explorer/operation-explorer.ts", "../operation-explorer.ts"],\n  ["../src/operations/explorer/operation-explorer-legacy-bridge.ts", "../operation-explorer-legacy-bridge.ts"],\n  ["../src/operations/presentation/process-presentation.ts", "../process-presentation.ts"],\n  ["../src/operations/run/run-notifications.ts", "../run-notifications.ts"],\n  ["../src/operations/run/run-replays.ts", "../run-replays.ts"],\n  ["../src/operations/run/run-results.ts", "../run-results.ts"],\n];\n\ntest("operations production modules are canonical under src/operations with no root copies", async () => {\n  for (const [canonical, legacy] of moved) {\n    await access(new URL(canonical, import.meta.url));\n    await assert.rejects(access(new URL(legacy, import.meta.url)));\n  }\n});\n''')

docs = ROOT / "docs/development/ROOT_MODULE_MIGRATION_MAP.md"
text = docs.read_text()
for item in [
    "- `approval-gates.ts`\n",
    "- `catalog-policies.ts`\n",
    "- `operation-explorer-legacy-bridge.ts`\n",
    "- `operation-explorer.ts`\n",
    "- `process-presentation.ts`\n",
    "- `run-notifications.ts`\n",
    "- `run-replays.ts`\n",
    "- `run-results.ts`\n",
]:
    text = text.replace(item, "")
marker = "Risk: **medium-high**. This is not necessarily one final module: approval, catalog/presentation and run lifecycle may become subdomains after import analysis. Keep this grouping provisional rather than forcing unrelated code behind one facade."
replacement = marker + "\n\nCurrent #262 checkpoint: approval gates are canonical under `src/operations/approvals/`; catalog policy ownership under `src/operations/catalog/`; explorer model/legacy bridge under `src/operations/explorer/`; process presentation under `src/operations/presentation/`; and run notifications/replays/results under `src/operations/run/`. Root implementations/shims for these modules are removed. Shared automation contracts remain canonical under `src/automation/`."
if marker not in text:
    raise SystemExit("migration map operations marker missing")
text = text.replace(marker, replacement)
docs.write_text(text)

for legacy in ["approval-gates.ts", "catalog-policies.ts", "operation-explorer.ts", "operation-explorer-legacy-bridge.ts", "process-presentation.ts", "run-notifications.ts", "run-replays.ts", "run-results.ts"]:
    if (ROOT / legacy).exists():
        raise SystemExit(f"legacy operations root remains: {legacy}")

print("operations domain batch codemod completed")
