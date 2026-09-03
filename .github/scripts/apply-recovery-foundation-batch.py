from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

ROOT = Path.cwd().resolve()
MOVES = {
    "recovery-errors.ts": "src/recovery/foundation/recovery-errors.ts",
    "recovery-paths.ts": "src/recovery/foundation/recovery-paths.ts",
    "recovery-receipt.ts": "src/recovery/foundation/recovery-receipt.ts",
    "recovery-sqlite.ts": "src/recovery/foundation/recovery-sqlite.ts",
    "recovery-lock.ts": "src/recovery/foundation/recovery-lock.ts",
    "recovery-restore-policy.ts": "src/recovery/foundation/recovery-restore-policy.ts",
    "recovery-discovery.ts": "src/recovery/foundation/recovery-discovery.ts",
    "recovery-secrets.ts": "src/recovery/foundation/recovery-secrets.ts",
    "recovery-backup-source.ts": "src/recovery/foundation/recovery-backup-source.ts",
    "recovery-schema-adapters.ts": "src/recovery/adapters/recovery-schema-adapters.ts",
    "recovery-local-adapters.ts": "src/recovery/adapters/recovery-local-adapters.ts",
}
OLD_TO_NEW = {(ROOT / s).resolve(): (ROOT / t).resolve() for s, t in MOVES.items()}
original = {s: (ROOT / s).read_text() for s in MOVES}

for source, target in MOVES.items():
    src, dst = ROOT / source, ROOT / target
    if not src.is_file(): raise SystemExit(f"missing source: {source}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(src, dst)

quoted = re.compile(r'(["\'])(\.{1,2}/[^"\']+?)\1')
source_exts = {".ts", ".tsx", ".js", ".mjs", ".cjs"}

def target_for(parent: Path, spec: str):
    raw = (parent / spec).resolve()
    candidates = [raw]
    if raw.suffix == "": candidates.append(Path(str(raw) + ".ts"))
    for candidate in candidates:
        if candidate in OLD_TO_NEW: return OLD_TO_NEW[candidate]
    return None

def replacement(spec: str, target: Path, parent: Path) -> str:
    value = os.path.relpath(target, parent).replace(os.sep, "/")
    if not spec.endswith(".ts") and value.endswith(".ts"): value = value[:-3]
    if not value.startswith("."): value = "./" + value
    return value

# Rebase imports inside moved modules against their original root location.
for source, target in MOVES.items():
    path = ROOT / target
    text = original[source]
    def moved_repl(match):
        quote, spec = match.groups()
        target_path = target_for(ROOT, spec)
        if target_path is None:
            raw = (ROOT / spec).resolve()
            candidates = [raw] + ([Path(str(raw) + ".ts")] if raw.suffix == "" else [])
            target_path = next((p for p in candidates if p.exists()), None)
        if target_path is None: return match.group(0)
        return f"{quote}{replacement(spec, target_path, path.parent)}{quote}"
    path.write_text(quoted.sub(moved_repl, text))

# Rewrite every active relative consumer of the moved physical files.
for path in ROOT.rglob("*"):
    if not path.is_file() or path.suffix not in source_exts: continue
    relative = path.relative_to(ROOT)
    if any(part in {"node_modules", "dist", ".git"} for part in relative.parts): continue
    if relative.as_posix() in MOVES.values(): continue
    text = path.read_text()
    def consumer_repl(match):
        quote, spec = match.groups()
        target_path = target_for(path.parent, spec)
        if target_path is None: return match.group(0)
        return f"{quote}{replacement(spec, target_path, path.parent)}{quote}"
    updated = quoted.sub(consumer_repl, text)
    if updated != text: path.write_text(updated)

# Source-reading contract uses path strings rather than import specifiers.
contract = ROOT / "tests/recovery-source-contract.test.mjs"
text = contract.read_text()
for old, new in {
    '"recovery-errors.ts"': '"src/recovery/foundation/recovery-errors.ts"',
    '"recovery-paths.ts"': '"src/recovery/foundation/recovery-paths.ts"',
    '"recovery-secrets.ts"': '"src/recovery/foundation/recovery-secrets.ts"',
}.items():
    if old not in text: raise SystemExit(f"source contract anchor missing: {old}")
    text = text.replace(old, new)
contract.write_text(text)

ownership = ROOT / "tests/recovery-foundation-domain-path-contract.test.mjs"
ownership.write_text('''import assert from "node:assert/strict";\nimport { access } from "node:fs/promises";\nimport test from "node:test";\n\nconst moved = [\n  ["../src/recovery/foundation/recovery-errors.ts", "../recovery-errors.ts"],\n  ["../src/recovery/foundation/recovery-paths.ts", "../recovery-paths.ts"],\n  ["../src/recovery/foundation/recovery-receipt.ts", "../recovery-receipt.ts"],\n  ["../src/recovery/foundation/recovery-sqlite.ts", "../recovery-sqlite.ts"],\n  ["../src/recovery/foundation/recovery-lock.ts", "../recovery-lock.ts"],\n  ["../src/recovery/foundation/recovery-restore-policy.ts", "../recovery-restore-policy.ts"],\n  ["../src/recovery/foundation/recovery-discovery.ts", "../recovery-discovery.ts"],\n  ["../src/recovery/foundation/recovery-secrets.ts", "../recovery-secrets.ts"],\n  ["../src/recovery/foundation/recovery-backup-source.ts", "../recovery-backup-source.ts"],\n  ["../src/recovery/adapters/recovery-schema-adapters.ts", "../recovery-schema-adapters.ts"],\n  ["../src/recovery/adapters/recovery-local-adapters.ts", "../recovery-local-adapters.ts"],\n];\n\ntest("recovery foundation and adapters are canonical under src/recovery with no root copies", async () => {\n  for (const [canonical, legacy] of moved) {\n    await access(new URL(canonical, import.meta.url));\n    await assert.rejects(access(new URL(legacy, import.meta.url)));\n  }\n});\n''')

docs = ROOT / "docs/development/ROOT_MODULE_MIGRATION_MAP.md"
text = docs.read_text()
for name in MOVES:
    text = text.replace(f"- `{name}`\n", "")
marker = "Risk: **high**. Recovery owns destructive/offline flows, atomic swap, locks, maintenance state and secret handling. It should move only after backup/storage boundaries are explicit and recovery container/script entrypoints are mapped."
checkpoint = marker + "\n\nCurrent #266 foundation checkpoint: shared recovery errors, path validation, receipts, bounded SQLite access, lock handling, restore policy, discovery, secret input handling and backup-source ownership are canonical under `src/recovery/foundation/`; schema/local restore adapters are canonical under `src/recovery/adapters/`. Their active CLI/script/runtime/test consumers use canonical paths and the corresponding root implementations are removed. Destructive orchestration, swap/reconcile and maintenance modules remain explicit follow-up slices."
if marker not in text: raise SystemExit("recovery migration-map marker missing")
text = text.replace(marker, checkpoint)
docs.write_text(text)

for source in MOVES:
    if (ROOT / source).exists(): raise SystemExit(f"legacy recovery root remains: {source}")

print("recovery foundation batch codemod completed")
