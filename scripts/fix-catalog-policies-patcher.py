from pathlib import Path

path = Path("scripts/apply-catalog-policies-patch.py")
text = path.read_text()

status_block = '''worker = replace_once(
    worker,
    'access: { identity: access.identity, role: access.role, permissions: access.permissions }',
    'access: { identity: access.identity, role: access.role, groups: access.groups, permissions: access.permissions }',
    "status groups",
)
'''
if text.count(status_block) != 1:
    raise RuntimeError("status compatibility block not found")
text = text.replace(status_block, "", 1)

history_block = '''worker = replace_once(
    worker,
    '''  if (request.method === "GET" && url.pathname === "/api/integrations/catalog/history") {
    const limit = Number(url.searchParams.get("limit") ?? 20);''',
    '''  if (request.method === "GET" && url.pathname === "/api/integrations/catalog/history") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    const limit = Number(url.searchParams.get("limit") ?? 20);''',
    "history admin visibility",
)
'''
if text.count(history_block) != 1:
    raise RuntimeError("history compatibility block not found")
text = text.replace(history_block, "", 1)

path.write_text(text)
