from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


results_path = Path("run-results.ts")
results = results_path.read_text()
results = replace_once(
    results,
    '  if (!path || path.length > 1000 || /[\\\\?#\\u0000-\\u001f]/.test(path)) return null;',
    '  if (!path || path.length > 1000 || path.includes(":") || /[\\\\?#\\u0000-\\u001f]/.test(path)) return null;',
    "reject scheme-like file paths",
)
results_path.write_text(results)

worker_path = Path("worker/index.ts")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    '      const response = await fetch(new URL(file.path, `${xyopsUrl}/`), {',
    '      const xyopsOrigin = new URL(`${xyopsUrl}/`);\n      const fileUrl = new URL(file.path, xyopsOrigin);\n      if (fileUrl.origin !== xyopsOrigin.origin) return json({ error: "Путь файла результата вышел за пределы XYOps origin" }, 502);\n      const response = await fetch(fileUrl, {',
    "enforce XYOps file origin",
)
worker_path.write_text(worker)

test_path = Path("tests/xyops-run-results.test.mjs")
test = test_path.read_text()
test = replace_once(
    test,
    '          { source: "output", filename: "escape.txt", path: "../secret.txt", size: 5 },',
    '          { source: "output", filename: "escape.txt", path: "../secret.txt", size: 5 },\n          { source: "output", filename: "origin.txt", path: "https:evil.example/secret.txt", size: 5 },',
    "test origin-changing path",
)
test_path.write_text(test)
