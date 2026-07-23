from pathlib import Path

path = Path("scripts/apply-extended-audit-patch.py")
text = path.read_text()
old = 'roadmap_path = Path("docs/ROADMAP.md")'
new = 'roadmap_path = Path("docs/PRODUCT_ROADMAP.md")'
if old not in text:
    raise RuntimeError("roadmap path anchor not found")
path.write_text(text.replace(old, new, 1))
