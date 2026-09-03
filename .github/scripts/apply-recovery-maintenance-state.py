from pathlib import Path
import os,re,shutil
R=Path.cwd().resolve()
MOVES={
 'maintenance-mode.ts':'src/recovery/maintenance/maintenance-mode.ts',
 'maintenance-repository.ts':'src/recovery/maintenance/maintenance-repository.ts',
 'maintenance-verification-smoke.ts':'src/recovery/maintenance/maintenance-verification-smoke.ts',
}
PAT=re.compile(r'(["\'])(\.{1,2}/[^"\']+?\.ts)\1')
TEXT={'.ts','.tsx','.js','.mjs','.cjs'}
OLD={(R/o).resolve():(R/n).resolve() for o,n in MOVES.items()}
for o,n in MOVES.items():
 s,t=R/o,R/n
 if not s.is_file() or t.exists(): raise SystemExit(f'invalid move {o} -> {n}')
 t.parent.mkdir(parents=True,exist_ok=True); shutil.move(s,t)
for o,n in MOVES.items():
 p=R/n; txt=p.read_text()
 def reb(m):
  q,s=m.groups(); orig=((R/o).parent/s).resolve(); tgt=OLD.get(orig,orig)
  ns=os.path.relpath(tgt,p.parent).replace(os.sep,'/'); ns=ns if ns.startswith('.') else './'+ns
  return f'{q}{ns}{q}'
 p.write_text(PAT.sub(reb,txt))
for p in R.rglob('*'):
 if not p.is_file() or p.suffix not in TEXT: continue
 rel=p.relative_to(R)
 if any(x in rel.parts for x in ['node_modules','dist','.git']) or rel.parts[:2]==('docs','superpowers') or rel.as_posix() in MOVES.values(): continue
 txt=p.read_text(errors='ignore')
 def rw(m):
  q,s=m.groups(); tgt=OLD.get((p.parent/s).resolve())
  if not tgt:return m.group(0)
  ns=os.path.relpath(tgt,p.parent).replace(os.sep,'/'); ns=ns if ns.startswith('.') else './'+ns
  return f'{q}{ns}{q}'
 new=PAT.sub(rw,txt)
 if new!=txt:p.write_text(new)
contract=R/'tests/recovery-maintenance-domain-path-contract.test.mjs'
contract.write_text('''import assert from "node:assert/strict";\nimport { access } from "node:fs/promises";\nimport test from "node:test";\n\nconst moved = [\n  ["../src/recovery/maintenance/maintenance-mode.ts", "../maintenance-mode.ts"],\n  ["../src/recovery/maintenance/maintenance-repository.ts", "../maintenance-repository.ts"],\n  ["../src/recovery/maintenance/maintenance-verification-smoke.ts", "../maintenance-verification-smoke.ts"],\n];\n\ntest("maintenance state ownership is canonical under src/recovery with no root copies", async () => {\n  for (const [canonical, legacy] of moved) {\n    await access(new URL(canonical, import.meta.url));\n    await assert.rejects(access(new URL(legacy, import.meta.url)));\n  }\n});\n''')
mp=R/'docs/development/ROOT_MODULE_MIGRATION_MAP.md'; text=mp.read_text()
old='CLI/runtime composition, online verification and maintenance state/orchestration remain explicit follow-up slices.'
new='Maintenance mode, repository persistence and online verification-smoke ownership are canonical under `src/recovery/maintenance/` with active Worker/storage/recovery/test consumers migrated and root implementations removed. CLI/runtime composition, offline maintenance recovery and online recovery verification remain explicit follow-up slices.'
if old not in text: raise SystemExit('migration map checkpoint missing')
mp.write_text(text.replace(old,new))
for p in R.rglob('*'):
 if not p.is_file() or p.suffix not in TEXT: continue
 rel=p.relative_to(R)
 if any(x in rel.parts for x in ['node_modules','dist','.git']) or rel.parts[:2]==('docs','superpowers') or rel==Path('tests/recovery-maintenance-domain-path-contract.test.mjs'): continue
 for m in PAT.finditer(p.read_text(errors='ignore')):
  if (p.parent/m.group(2)).resolve() in OLD: raise SystemExit(f'legacy root import remains: {rel}: {m.group(2)}')
for o in MOVES:
 if (R/o).exists(): raise SystemExit(f'legacy root remains: {o}')
print('recovery maintenance state codemod completed')
