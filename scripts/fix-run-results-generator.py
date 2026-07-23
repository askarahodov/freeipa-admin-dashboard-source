from pathlib import Path

patcher_path = Path("scripts/apply-run-results-patch.py")
patcher = patcher_path.read_text()
lines = patcher.splitlines()
changed = False
for index, line in enumerate(lines):
    if "const fallbackName = file.filename.replace" in line:
        lines[index] = '      const fallbackName = file.filename.replace(/[^\\x20-\\x7e]/g, "_").replaceAll(String.fromCharCode(34), "_").replaceAll(String.fromCharCode(92), "_") || "result.bin";'
        changed = True
if not changed:
    raise RuntimeError("fallbackName generator line not found")
patcher_path.write_text("\n".join(lines) + "\n")

results_path = Path("run-results.ts")
results = results_path.read_text()
old = '  const files = storedFiles.slice(0, 20).map(({ path: _path, ...file }) => ({ ...file, downloadUrl: `/api/integrations/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(file.id)}` }));'
new = '  const files = storedFiles.slice(0, 20).map((file) => ({ id: file.id, filename: file.filename, size: file.size, mimeType: file.mimeType, downloadUrl: `/api/integrations/runs/${encodeURIComponent(runId)}/files/${encodeURIComponent(file.id)}` }));'
if results.count(old) != 1:
    raise RuntimeError(f"run-results public file mapping: expected one match, found {results.count(old)}")
results_path.write_text(results.replace(old, new, 1))
