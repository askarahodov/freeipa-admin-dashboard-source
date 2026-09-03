from __future__ import annotations

import os
import re
import shutil
from pathlib import Path

ROOT = Path.cwd().resolve()

MOVES = {
    ROOT / "backup-manifest.ts": ROOT / "src/backup/backup-manifest.ts",
    ROOT / "backup-export-domains.ts": ROOT / "src/backup/export/backup-export-domains.ts",
    ROOT / "backup-full-domains.ts": ROOT / "src/backup/export/backup-full-domains.ts",
}

for source, target in MOVES.items():
    if not source.is_file():
        raise SystemExit(f"missing source: {source.relative_to(ROOT)}")
    if target.exists():
        raise SystemExit(f"target already exists: {target.relative_to(ROOT)}")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(source, target)

# The two registry implementations moved from root into src/backup/export, so
# their own root-relative imports need explicit rebasing before generic fan-out rewriting.
for relative in [
    "src/backup/export/backup-export-domains.ts",
    "src/backup/export/backup-full-domains.ts",
]:
    path = ROOT / relative
    text = path.read_text()
    text = text.replace('from "./backup-manifest.ts"', 'from "../backup-manifest.ts"')
    text = text.replace('from "./src/backup/export/backup-export.ts"', 'from "./backup-export.ts"')
    path.write_text(text)

old_to_new = {
    (ROOT / "backup-manifest.ts").resolve(): (ROOT / "src/backup/backup-manifest.ts").resolve(),
    (ROOT / "backup-export-domains.ts").resolve(): (ROOT / "src/backup/export/backup-export-domains.ts").resolve(),
    (ROOT / "backup-full-domains.ts").resolve(): (ROOT / "src/backup/export/backup-full-domains.ts").resolve(),
}

quoted_ts = re.compile(r'(["\'])(\.{1,2}/[^"\']+?\.ts)\1')
text_suffixes = {".ts", ".tsx", ".js", ".mjs", ".cjs"}

for path in ROOT.rglob("*"):
    if not path.is_file() or path.suffix not in text_suffixes:
        continue
    relative = path.relative_to(ROOT)
    if any(part in {"node_modules", "dist", ".git"} for part in relative.parts):
        continue
    if relative.parts[:2] == ("docs", "superpowers"):
        continue
    text = path.read_text()

    def replace(match: re.Match[str]) -> str:
        quote, spec = match.groups()
        resolved = (path.parent / spec).resolve()
        target = old_to_new.get(resolved)
        if target is None:
            return match.group(0)
        new_spec = os.path.relpath(target, path.parent).replace(os.sep, "/")
        if not new_spec.startswith("."):
            new_spec = "./" + new_spec
        return f"{quote}{new_spec}{quote}"

    updated = quoted_ts.sub(replace, text)
    if updated != text:
        path.write_text(updated)

special_replacements = {
    "tests/backup-export-source-contract.test.mjs": [
        ('source("backup-export-domains.ts")', 'source("src/backup/export/backup-export-domains.ts")'),
    ],
    "tests/backup-encrypted-source-contract.test.mjs": [
        ('  "backup-full-domains.ts",', '  "src/backup/export/backup-full-domains.ts",'),
    ],
    "tests/product-branding.test.mjs": [
        ('read("backup-manifest.ts")', 'read("src/backup/backup-manifest.ts")'),
    ],
}
for relative, replacements in special_replacements.items():
    path = ROOT / relative
    text = path.read_text()
    for old, new in replacements:
        if old not in text:
            raise SystemExit(f"expected literal not found in {relative}: {old}")
        text = text.replace(old, new)
    path.write_text(text)

# Existing domain-path contracts intentionally asserted the old physical root edges.
# Update only those path expectations; behavior assertions remain untouched.
for path in (ROOT / "tests").glob("*domain-path-contract.test.mjs"):
    text = path.read_text()
    text = text.replace(
        r'/from "\.\.\/\.\.\/\.\.\/backup-manifest\.ts"/',
        r'/from "\.\.\/backup-manifest\.ts"/',
    )
    text = text.replace(
        r'/from "\.\.\/\.\.\/\.\.\/backup-full-domains\.ts"/',
        r'/from "\.\.\/export\/backup-full-domains\.ts"/',
    )
    path.write_text(text)

ownership = ROOT / "tests/backup-root-ownership.test.mjs"
ownership.write_text('''import test from "node:test";\nimport assert from "node:assert/strict";\nimport { access } from "node:fs/promises";\n\nconst moved = [\n  ["../src/backup/backup-manifest.ts", "../backup-manifest.ts"],\n  ["../src/backup/export/backup-export-domains.ts", "../backup-export-domains.ts"],\n  ["../src/backup/export/backup-full-domains.ts", "../backup-full-domains.ts"],\n];\n\ntest("backup core contracts are canonical under src/backup with no root copies", async () => {\n  for (const [canonical, legacy] of moved) {\n    await access(new URL(canonical, import.meta.url));\n    await assert.rejects(access(new URL(legacy, import.meta.url)));\n  }\n});\n''')

docs = ROOT / "docs/development/ROOT_MODULE_MIGRATION_MAP.md"
doc_text = docs.read_text()
marker = "The remaining root `backup-*.ts` modules listed above stay in explicit follow-up scope and must move only in dependency-closed slices."
replacement = "The final backup core-contract batch moves `backup-manifest.ts` to `src/backup/backup-manifest.ts` and both sanitized/full domain registries to `src/backup/export/`, migrates their complete active fan-out together, and removes the last root `backup-*.ts` implementations. After this batch, backup production ownership is fully canonical under `src/backup/`."
if marker in doc_text:
    doc_text = doc_text.replace(marker, replacement)
else:
    # Parallel documentation may have advanced; add a narrow checkpoint without rewriting history.
    anchor = "### Recovery and maintenance → `src/recovery/`"
    if anchor not in doc_text:
        raise SystemExit("migration-map backup checkpoint anchor missing")
    doc_text = doc_text.replace(anchor, replacement + "\n\n" + anchor)
docs.write_text(doc_text)

legacy = sorted(p.name for p in ROOT.glob("backup-*.ts"))
if legacy:
    raise SystemExit(f"legacy root backup modules remain: {legacy}")

# Fail if active source still imports any removed root module. Historical docs are excluded above.
legacy_literals = ["backup-manifest.ts", "backup-export-domains.ts", "backup-full-domains.ts"]
for path in ROOT.rglob("*"):
    if not path.is_file() or path.suffix not in text_suffixes:
        continue
    relative = path.relative_to(ROOT)
    if any(part in {"node_modules", "dist", ".git"} for part in relative.parts):
        continue
    if relative == Path("tests/backup-root-ownership.test.mjs"):
        continue
    text = path.read_text()
    for literal in legacy_literals:
        for match in quoted_ts.finditer(text):
            spec = match.group(2)
            if spec.endswith("/" + literal) or spec in {"./" + literal, "../" + literal}:
                resolved = (path.parent / spec).resolve()
                if resolved == (ROOT / literal).resolve():
                    raise SystemExit(f"legacy root import remains: {relative}: {spec}")

print("backup core final batch codemod completed")
