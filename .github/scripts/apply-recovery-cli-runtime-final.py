from pathlib import Path
import os,re,shutil
R=Path.cwd().resolve()
MOVES={
 'recovery-cli.ts':'src/recovery/cli/recovery-cli.ts',
 'recovery-cli-runtime.ts':'src/recovery/cli/recovery-cli-runtime.ts',
 'recovery-command-handlers.ts':'src/recovery/cli/recovery-command-handlers.ts',
 'recovery-runtime-command-handlers.ts':'src/recovery/cli/recovery-runtime-command-handlers.ts',
 'recovery-maintenance.ts':'src/recovery/maintenance/recovery-maintenance.ts',
 'recovery-online-verification.ts':'src/recovery/verification/recovery-online-verification.ts',
}
PAT=re.compile(r'(["\'])(\.{1,2}/[^"\']+?\.ts)\1')
TEXT={'.ts','.tsx','.js','.mjs','.cjs'}
OLD={(R/o).resolve():(R/n).resolve() for o,n in MOVES.items()}
for o,n in MOVES.items():
 s,t=R/o,R/n
 if not s.is_file() or t.exists(): raise SystemExit(f'invalid move {o} -> {n}')
 t.parent.mkdir(parents=True,exist_ok=True);shutil.move(s,t)
for o,n in MOVES.items():
 p=R/n;txt=p.read_text()
 def reb(m):
  q,s=m.groups();orig=((R/o).parent/s).resolve();tgt=OLD.get(orig,orig);ns=os.path.relpath(tgt,p.parent).replace(os.sep,'/');ns=ns if ns.startswith('.') else './'+ns;return f'{q}{ns}{q}'
 p.write_text(PAT.sub(reb,txt))
for p in R.rglob('*'):
 if not p.is_file() or p.suffix not in TEXT: continue
 rel=p.relative_to(R)
 if any(x in rel.parts for x in ['node_modules','dist','.git']) or rel.parts[:2]==('docs','superpowers') or rel.as_posix() in MOVES.values(): continue
 txt=p.read_text(errors='ignore')
 def rw(m):
  q,s=m.groups();tgt=OLD.get((p.parent/s).resolve())
  if not tgt:return m.group(0)
  ns=os.path.relpath(tgt,p.parent).replace(os.sep,'/');ns=ns if ns.startswith('.') else './'+ns;return f'{q}{ns}{q}'
 new=PAT.sub(rw,txt)
 if new!=txt:p.write_text(new)
contract=R/'tests/recovery-cli-runtime-domain-path-contract.test.mjs'
contract.write_text('''import assert from "node:assert/strict";\nimport { access } from "node:fs/promises";\nimport test from "node:test";\n\nconst moved = [\n  ["../src/recovery/cli/recovery-cli.ts", "../recovery-cli.ts"],\n  ["../src/recovery/cli/recovery-cli-runtime.ts", "../recovery-cli-runtime.ts"],\n  ["../src/recovery/cli/recovery-command-handlers.ts", "../recovery-command-handlers.ts"],\n  ["../src/recovery/cli/recovery-runtime-command-handlers.ts", "../recovery-runtime-command-handlers.ts"],\n  ["../src/recovery/maintenance/recovery-maintenance.ts", "../recovery-maintenance.ts"],\n  ["../src/recovery/verification/recovery-online-verification.ts", "../recovery-online-verification.ts"],\n];\n\ntest("recovery CLI/runtime ownership is canonical under src/recovery with no root copies", async () => {\n  for (const [canonical, legacy] of moved) {\n    await access(new URL(canonical, import.meta.url));\n    await assert.rejects(access(new URL(legacy, import.meta.url)));\n  }\n});\n''')
mp=R/'docs/development/ROOT_MODULE_MIGRATION_MAP.md';text=mp.read_text()
old='CLI/runtime composition, offline maintenance recovery and online recovery verification remain explicit follow-up slices.'
new='The final #266 CLI/runtime slice is canonical: CLI parsing/runtime dependencies and command-handler composition live under `src/recovery/cli/`, offline failed-maintenance recovery lives under `src/recovery/maintenance/`, and online verification lives under `src/recovery/verification/`. All active script/test consumers use canonical paths, root `recovery-*.ts`/`maintenance-*.ts` production implementations are removed, and recovery production ownership is fully canonical under `src/recovery/`.'
if old not in text: raise SystemExit('migration map checkpoint missing')
mp.write_text(text.replace(old,new))
# active stale imports are forbidden
for p in R.rglob('*'):
 if not p.is_file() or p.suffix not in TEXT: continue
 rel=p.relative_to(R)
 if any(x in rel.parts for x in ['node_modules','dist','.git']) or rel.parts[:2]==('docs','superpowers') or rel==Path('tests/recovery-cli-runtime-domain-path-contract.test.mjs'): continue
 for m in PAT.finditer(p.read_text(errors='ignore')):
  if (p.parent/m.group(2)).resolve() in OLD: raise SystemExit(f'legacy root import remains: {rel}: {m.group(2)}')
for o in MOVES:
 if (R/o).exists(): raise SystemExit(f'legacy root remains: {o}')
remaining=sorted([p.name for p in R.glob('recovery-*.ts')]+[p.name for p in R.glob('maintenance-*.ts')])
if remaining: raise SystemExit(f'root recovery production modules remain: {remaining}')
print('final recovery CLI/runtime codemod completed')
