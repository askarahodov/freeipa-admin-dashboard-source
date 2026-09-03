from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

ROOT = Path.cwd().resolve()
MOVES = {
    "recovery-candidate.ts": "src/recovery/orchestration/recovery-candidate.ts",
    "recovery-preflight.ts": "src/recovery/orchestration/recovery-preflight.ts",
    "recovery-reconcile.ts": "src/recovery/orchestration/recovery-reconcile.ts",
    "recovery-swap.ts": "src/recovery/orchestration/recovery-swap.ts",
    "recovery-point.ts": "src/recovery/artifacts/recovery-point.ts",
}
PATTERN = re.compile(r'(["\'])(\.{1,2}/[^"\']+?\.ts)\1')
TEXT_SUFFIXES = {".ts", ".tsx", ".js", ".mjs", ".cjs"}
old_abs = {(ROOT / old).resolve(): (ROOT / new).resolve() for old, new in MOVES.items()}

for old, new in MOVES.items():
    source = ROOT / old
    target = ROOT / new
    if not source.is_file():
        raise SystemExit(f"missing source: {old}")
    if target.exists():
        raise SystemExit(f"target already exists: {new}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(source, target)

# Rebase every relative TS import inside moved implementations against its original root location.
for old, new in MOVES.items():
    path = ROOT / new
    text = path.read_text()

    def rebase_moved(match: re.Match[str]) -> str:
        quote, spec = match.groups()
        original_target = ((ROOT / old).parent / spec).resolve()
        target = old_abs.get(original_target, original_target)
        new_spec = os.path.relpath(target, path.parent).replace(os.sep, "/")
        if not new_spec.startswith("."):
            new_spec = "./" + new_spec
        return f"{quote}{new_spec}{quote}"

    path.write_text(PATTERN.sub(rebase_moved, text))

# Update all active consumers, including source-reading tests and dynamic imports.
for path in ROOT.rglob("*"):
    if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
        continue
    relative = path.relative_to(ROOT)
    if any(part in {"node_modules", "dist", ".git"} for part in relative.parts):
        continue
    if relative.parts[:2] == ("docs", "superpowers"):
        continue
    if relative.as_posix() in MOVES.values():
        continue
    text = path.read_text()

    def rewrite_consumer(match: re.Match[str]) -> str:
        quote, spec = match.groups()
        resolved = (path.parent / spec).resolve()
        target = old_abs.get(resolved)
        if target is None:
            return match.group(0)
        new_spec = os.path.relpath(target, path.parent).replace(os.sep, "/")
        if not new_spec.startswith("."):
            new_spec = "./" + new_spec
        return f"{quote}{new_spec}{quote}"

    updated = PATTERN.sub(rewrite_consumer, text)
    if updated != text:
        path.write_text(updated)

ownership = ROOT / "tests/recovery-orchestration-domain-path-contract.test.mjs"
ownership.write_text('''import assert from "node:assert/strict";\nimport { access } from "node:fs/promises";\nimport test from "node:test";\n\nconst moved = [\n  ["../src/recovery/orchestration/recovery-candidate.ts", "../recovery-candidate.ts"],\n  ["../src/recovery/orchestration/recovery-preflight.ts", "../recovery-preflight.ts"],\n  ["../src/recovery/artifacts/recovery-point.ts", "../recovery-point.ts"],\n  ["../src/recovery/orchestration/recovery-reconcile.ts", "../recovery-reconcile.ts"],\n  ["../src/recovery/orchestration/recovery-swap.ts", "../recovery-swap.ts"],\n];\n\ntest("recovery destructive core is canonical under src/recovery with no root copies", async () => {\n  for (const [canonical, legacy] of moved) {\n    await access(new URL(canonical, import.meta.url));\n    await assert.rejects(access(new URL(legacy, import.meta.url)));\n  }\n});\n''')

migration_map = ROOT / "docs/development/ROOT_MODULE_MIGRATION_MAP.md"
text = migration_map.read_text()
old_checkpoint = "Current #266 foundation checkpoint: shared recovery errors, path validation, receipts, bounded SQLite access, lock handling, restore policy, discovery, secret input handling and backup-source ownership are canonical under `src/recovery/foundation/`; schema/local restore adapters are canonical under `src/recovery/adapters/`. Their active CLI/script/runtime/test consumers use canonical paths and the corresponding root implementations are removed. Destructive orchestration, swap/reconcile and maintenance modules remain explicit follow-up slices."
new_checkpoint = "Current #266 checkpoint: shared recovery errors, path validation, receipts, bounded SQLite access, lock handling, restore policy, discovery, secret input handling and backup-source ownership are canonical under `src/recovery/foundation/`; schema/local restore adapters are canonical under `src/recovery/adapters/`. The destructive-core slice is also canonical: candidate construction, preflight, reconcile and atomic swap live under `src/recovery/orchestration/`, while encrypted raw SQLite recovery-point ownership lives under `src/recovery/artifacts/`. Their active command-handler/test consumers use canonical paths and the corresponding root implementations are removed. CLI/runtime composition, online verification and maintenance state/orchestration remain explicit follow-up slices."
if old_checkpoint not in text:
    raise SystemExit("migration-map checkpoint not found")
migration_map.write_text(text.replace(old_checkpoint, new_checkpoint))

# Fail on active imports that still resolve to a removed root module.
for path in ROOT.rglob("*"):
    if not path.is_file() or path.suffix not in TEXT_SUFFIXES:
        continue
    relative = path.relative_to(ROOT)
    if any(part in {"node_modules", "dist", ".git"} for part in relative.parts):
        continue
    if relative.parts[:2] == ("docs", "superpowers"):
        continue
    if relative == Path("tests/recovery-orchestration-domain-path-contract.test.mjs"):
        continue
    for match in PATTERN.finditer(path.read_text()):
        if (path.parent / match.group(2)).resolve() in old_abs:
            raise SystemExit(f"legacy root import remains: {relative}: {match.group(2)}")

for old in MOVES:
    if (ROOT / old).exists():
        raise SystemExit(f"legacy root implementation remains: {old}")

print("recovery destructive-core codemod completed")
