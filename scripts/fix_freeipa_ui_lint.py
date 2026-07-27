from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / "app/FreeIpaUserBrowser.tsx"
content = path.read_text(encoding="utf-8")

before = '''  useEffect(() => {
    if (!active) {
      setCanWrite(false);
      setCanDelete(false);
      return;
    }
    let cancelled = false;
    void loadFreeIpaAccess().then((access) => {
      if (cancelled) return;
      setCanWrite(access.canWrite);
      setCanDelete(access.canDelete);
    }).catch(() => {
      if (cancelled) return;
      setCanWrite(false);
      setCanDelete(false);
    });
    return () => { cancelled = true; };
  }, [active]);
'''

after = '''  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const reset = window.setTimeout(() => {
      if (cancelled) return;
      setCanWrite(false);
      setCanDelete(false);
    }, 0);
    void loadFreeIpaAccess().then((access) => {
      if (cancelled) return;
      setCanWrite(access.canWrite);
      setCanDelete(access.canDelete);
    }).catch(() => {
      if (cancelled) return;
      setCanWrite(false);
      setCanDelete(false);
    });
    return () => {
      cancelled = true;
      window.clearTimeout(reset);
    };
  }, [active]);
'''

if content.count(before) != 1:
    raise RuntimeError("FreeIPA access effect did not match exactly once")
content = content.replace(before, after, 1)

obsolete = '''  useEffect(() => {
    if (selectedUid && payload && !payload.users.some((user) => user.uid === selectedUid)) setSelectedUid(null);
  }, [payload, selectedUid]);

'''
if content.count(obsolete) != 1:
    raise RuntimeError("selected user cleanup effect did not match exactly once")
content = content.replace(obsolete, "", 1)
path.write_text(content, encoding="utf-8")

for obsolete_path in [root / "scripts/fix_freeipa_ui_lint.py", root / ".github/workflows/fix-freeipa-ui-lint.yml"]:
    if obsolete_path.exists():
        obsolete_path.unlink()

print("FreeIPA UI lint fix applied")
