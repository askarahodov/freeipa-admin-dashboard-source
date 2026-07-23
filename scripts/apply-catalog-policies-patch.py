from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


worker_path = Path("worker/index.ts")
worker = worker_path.read_text()
worker = replace_once(
    worker,
    'import { listRunNotifications, markRunNotificationsRead, saveRunNotification } from "../run-notifications";\n',
    'import { listRunNotifications, markRunNotificationsRead, saveRunNotification } from "../run-notifications";\nimport { catalogEventAllowed, readCatalogPolicySet, saveCatalogPolicySet } from "../catalog-policies";\n',
    "worker policy import",
)
worker = replace_once(
    worker,
    '  PORTAL_RBAC_JSON?: string;\n',
    '  PORTAL_RBAC_JSON?: string;\n  PORTAL_CATALOG_POLICIES_JSON?: string;\n',
    "worker policy env",
)
old_access = '''function portalAccess(request: Request, env: Env): { identity: string; role: PortalRole; permissions: PortalPermission[] } {
  const identity = (request.headers.get("oai-authenticated-user-email") || "portal-user").trim().toLowerCase().slice(0, 160);
  let role = portalRole(String(env.PORTAL_DEFAULT_ROLE || "").trim().toLowerCase()) ?? "admin";
  if (env.PORTAL_RBAC_JSON) {
    try {
      const assignments = JSON.parse(env.PORTAL_RBAC_JSON) as unknown;
      if (assignments && typeof assignments === "object" && !Array.isArray(assignments)) {
        const values = assignments as Record<string, unknown>;
        const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.trim().toLowerCase(), value]));
        role = portalRole(normalized[identity]) ?? portalRole(normalized["*"]) ?? role;
      }
    } catch {
      // Invalid RBAC configuration never grants more than the explicit default role.
    }
  }
  return { identity, role, permissions: rolePermissions[role] };
}'''
new_access = '''function portalAccess(request: Request, env: Env): { identity: string; role: PortalRole; groups: string[]; permissions: PortalPermission[] } {
  const identity = (request.headers.get("oai-authenticated-user-email") || "portal-user").trim().toLowerCase().slice(0, 160);
  const groups = Array.from(new Set(String(request.headers.get("oai-authenticated-user-groups") ?? "").split(",").map((value) => value.trim().toLowerCase()).filter((value) => value && value.length <= 120 && !/[\\r\\n]/.test(value)))).slice(0, 100);
  let role = portalRole(String(env.PORTAL_DEFAULT_ROLE || "").trim().toLowerCase()) ?? "admin";
  if (env.PORTAL_RBAC_JSON) {
    try {
      const assignments = JSON.parse(env.PORTAL_RBAC_JSON) as unknown;
      if (assignments && typeof assignments === "object" && !Array.isArray(assignments)) {
        const values = assignments as Record<string, unknown>;
        const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.trim().toLowerCase(), value]));
        role = portalRole(normalized[identity]) ?? portalRole(normalized["*"]) ?? role;
      }
    } catch {
      // Invalid RBAC configuration never grants more than the explicit default role.
    }
  }
  return { identity, role, groups, permissions: rolePermissions[role] };
}'''
worker = replace_once(worker, old_access, new_access, "worker portal access groups")
worker = replace_once(
    worker,
    'access: { identity: access.identity, role: access.role, permissions: access.permissions }',
    'access: { identity: access.identity, role: access.role, groups: access.groups, permissions: access.permissions }',
    "status groups",
)
policy_api = '''  if (url.pathname === "/api/integrations/catalog/policies") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    if (!baseEnv.ADMIN_TOKEN || !await adminAuthorized(request, baseEnv)) return json({ error: "Administrator authorization required" }, 401);
    if (request.method === "GET") {
      try {
        const state = await readCatalogPolicySet(baseEnv);
        return json({ ...state, persistenceAvailable: Boolean(baseEnv.DB) });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Cannot load catalog policies" }, 503);
      }
    }
    if (request.method === "PUT") {
      if (!baseEnv.DB) return json({ error: "Persistent database is unavailable" }, 503);
      try {
        const body = await request.json() as Record<string, unknown>;
        const saved = await saveCatalogPolicySet(baseEnv, body.policy);
        return json({ policy: saved.policy, source: "database", updatedAt: saved.updatedAt, persistenceAvailable: true });
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Cannot save catalog policies" }, 400);
      }
    }
    return json({ error: "Method not allowed" }, 405);
  }

'''
worker = replace_once(
    worker,
    '  if (request.method === "GET" && url.pathname === "/api/integrations/notifications") {\n',
    policy_api + '  if (request.method === "GET" && url.pathname === "/api/integrations/notifications") {\n',
    "policy API",
)
worker = replace_once(
    worker,
    '''      const event = catalog.events.find((item) => item.id === replay.spec?.eventId && item.enabled);
      if (!event) return json({ error: "Исходный процесс отсутствует или отключён" }, 409);''',
    '''      const event = catalog.events.find((item) => item.id === replay.spec?.eventId && item.enabled);
      if (!event) return json({ error: "Исходный процесс отсутствует или отключён" }, 409);
      const access = portalAccess(request, baseEnv);
      const policyState = await readCatalogPolicySet(baseEnv);
      if (!catalogEventAllowed(policyState.policy, access, event)) return json({ error: "Процесс недоступен по политике каталога" }, 404);''',
    "rerun policy enforcement",
)
worker = replace_once(
    worker,
    '''  if (request.method === "GET" && url.pathname === "/api/integrations/routes") {
    const routes = automationRoutes(env);''',
    '''  if (request.method === "GET" && url.pathname === "/api/integrations/routes") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    const routes = automationRoutes(env);''',
    "routes visibility",
)
worker = replace_once(
    worker,
    '''  if (request.method === "GET" && url.pathname === "/api/integrations/catalog") {
    try {
      return json(await portalCatalog(env, xyopsUrl));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "XYOps catalog request failed" }, 502);
    }
  }''',
    '''  if (request.method === "GET" && url.pathname === "/api/integrations/catalog") {
    try {
      const catalog = await portalCatalog(env, xyopsUrl);
      const access = portalAccess(request, baseEnv);
      const policyState = await readCatalogPolicySet(baseEnv);
      const events = catalog.events.filter((event) => catalogEventAllowed(policyState.policy, access, event));
      const visibleIds = new Set(events.map((event) => event.id));
      const changes = catalog.changes.filter((change) => visibleIds.has(change.id) || catalogEventAllowed(policyState.policy, access, { id: change.id, category: "" }));
      return json({ ...catalog, events, changes, policy: { source: policyState.source, filtered: events.length !== catalog.events.length } });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "XYOps catalog request failed" }, 502);
    }
  }''',
    "catalog filtering",
)
worker = replace_once(
    worker,
    '''  if (request.method === "GET" && url.pathname === "/api/integrations/catalog/history") {
    const limit = Number(url.searchParams.get("limit") ?? 20);''',
    '''  if (request.method === "GET" && url.pathname === "/api/integrations/catalog/history") {
    const denied = requirePortalPermission(request, baseEnv, "settings.manage");
    if (denied) return denied;
    const limit = Number(url.searchParams.get("limit") ?? 20);''',
    "history admin visibility",
)
worker = replace_once(
    worker,
    '''      const event = catalog.events.find((item) => item.id === url.searchParams.get("eventId"));
      const field = event?.fields.find((item) => item.key === url.searchParams.get("fieldKey"));''',
    '''      const event = catalog.events.find((item) => item.id === url.searchParams.get("eventId"));
      const access = portalAccess(request, baseEnv);
      const policyState = await readCatalogPolicySet(baseEnv);
      if (!event || !catalogEventAllowed(policyState.policy, access, event)) return json({ error: "XYOps process not found" }, 404);
      const field = event.fields.find((item) => item.key === url.searchParams.get("fieldKey"));''',
    "options policy enforcement",
)
worker = replace_once(
    worker,
    '''      const event = catalog.events.find((item) => item.id === eventId && item.enabled);
      if (!event) return json({ error: "XYOps process not found or disabled" }, 404);
      const requestedTargets = Array.isArray(body.targets) ? body.targets.map(String) : [];''',
    '''      const event = catalog.events.find((item) => item.id === eventId && item.enabled);
      if (!event) return json({ error: "XYOps process not found or disabled" }, 404);
      const access = portalAccess(request, baseEnv);
      const policyState = await readCatalogPolicySet(baseEnv);
      if (!catalogEventAllowed(policyState.policy, access, event)) return json({ error: "XYOps process not found or disabled" }, 404);
      const requestedTargets = Array.isArray(body.targets) ? body.targets.map(String) : [];''',
    "run policy enforcement",
)
worker_path.write_text(worker)


secure_path = Path("worker/secure-entry.ts")
secure = secure_path.read_text()
secure = replace_once(
    secure,
    '  PORTAL_STATIC_NAME?: string;\n',
    '  PORTAL_STATIC_NAME?: string;\n  PORTAL_STATIC_GROUPS?: string;\n  PORTAL_GROUPS_HEADER?: string;\n  PORTAL_GROUPS_JSON?: string;\n',
    "secure group env",
)
group_helpers = '''
function normalizedGroups(value: string | null | undefined): string[] {
  return Array.from(new Set(String(value ?? "").split(/[;,]/).map((item) => item.trim().toLowerCase()).filter((item) => item && item.length <= 120 && !/[\\r\\n]/.test(item)))).slice(0, 100);
}

function mappedGroups(identity: string, value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const entries = Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, groups]) => [key.trim().toLowerCase(), groups]));
    const selected = entries[identity] ?? entries["*"];
    return Array.isArray(selected) ? normalizedGroups(selected.map(String).join(",")) : normalizedGroups(String(selected ?? ""));
  } catch {
    return [];
  }
}
'''
secure = replace_once(
    secure,
    '''function normalizedName(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > 160 || /[\\u0000-\\u001f\\u007f]/.test(normalized)) return null;
  return normalized;
}
''',
    '''function normalizedName(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (!normalized || normalized.length > 160 || /[\\u0000-\\u001f\\u007f]/.test(normalized)) return null;
  return normalized;
}
''' + group_helpers,
    "secure group helpers",
)
secure = replace_once(
    secure,
    '''  headers.delete("oai-authenticated-user-email");
  headers.delete("oai-authenticated-user-full-name");
  headers.delete("oai-authenticated-user-full-name-encoding");

  let identity: string | null = null;
  let displayName: string | null = null;''',
    '''  headers.delete("oai-authenticated-user-email");
  headers.delete("oai-authenticated-user-full-name");
  headers.delete("oai-authenticated-user-full-name-encoding");
  headers.delete("oai-authenticated-user-groups");

  let identity: string | null = null;
  let displayName: string | null = null;
  let groups: string[] = [];''',
    "secure strip groups",
)
secure = replace_once(
    secure,
    '''    const nameHeader = safeHeaderName(sourceEnv.PORTAL_IDENTITY_NAME_HEADER, "x-auth-request-user");
    const secretHeader = safeHeaderName(sourceEnv.PORTAL_PROXY_SECRET_HEADER, "x-portal-proxy-secret");
    const trusted = await secretsMatch(headers.get(secretHeader), sourceEnv.PORTAL_PROXY_SHARED_SECRET);
    if (trusted) {
      identity = normalizedIdentity(headers.get(identityHeader));
      displayName = normalizedName(headers.get(nameHeader));
    }
    headers.delete(identityHeader);
    headers.delete(nameHeader);
    headers.delete(secretHeader);''',
    '''    const nameHeader = safeHeaderName(sourceEnv.PORTAL_IDENTITY_NAME_HEADER, "x-auth-request-user");
    const groupsHeader = safeHeaderName(sourceEnv.PORTAL_GROUPS_HEADER, "x-auth-request-groups");
    const secretHeader = safeHeaderName(sourceEnv.PORTAL_PROXY_SECRET_HEADER, "x-portal-proxy-secret");
    const trusted = await secretsMatch(headers.get(secretHeader), sourceEnv.PORTAL_PROXY_SHARED_SECRET);
    if (trusted) {
      identity = normalizedIdentity(headers.get(identityHeader));
      displayName = normalizedName(headers.get(nameHeader));
      groups = normalizedGroups(headers.get(groupsHeader));
    }
    headers.delete(identityHeader);
    headers.delete(nameHeader);
    headers.delete(groupsHeader);
    headers.delete(secretHeader);''',
    "secure proxy groups",
)
secure = replace_once(
    secure,
    '''  } else if (mode === "static") {
    identity = normalizedIdentity(sourceEnv.PORTAL_STATIC_IDENTITY);
    displayName = normalizedName(sourceEnv.PORTAL_STATIC_NAME);
  }

  if (identity) headers.set("oai-authenticated-user-email", identity);''',
    '''  } else if (mode === "static") {
    identity = normalizedIdentity(sourceEnv.PORTAL_STATIC_IDENTITY);
    displayName = normalizedName(sourceEnv.PORTAL_STATIC_NAME);
    groups = normalizedGroups(sourceEnv.PORTAL_STATIC_GROUPS);
  }

  if (identity) {
    groups = Array.from(new Set([...groups, ...mappedGroups(identity, sourceEnv.PORTAL_GROUPS_JSON)])).slice(0, 100);
    headers.set("oai-authenticated-user-email", identity);
    if (groups.length) headers.set("oai-authenticated-user-groups", groups.join(","));
  }''',
    "secure mapped groups",
)
secure_path.write_text(secure)


page_path = Path("app/page.tsx")
page = page_path.read_text()
policy_types = '''type CatalogPolicyRule = { id: string; effect: "allow" | "deny"; users: string[]; groups: string[]; roles: PortalRole[]; categories: string[]; processes: string[] };
type CatalogPolicySet = { version: 1; defaultEffect: "allow" | "deny"; adminBypass: boolean; rules: CatalogPolicyRule[] };
'''
page = replace_once(
    page,
    'type PortalAccess = { identity: string; role: PortalRole; permissions: PortalPermission[] };\n',
    'type PortalAccess = { identity: string; role: PortalRole; groups?: string[]; permissions: PortalPermission[] };\n' + policy_types,
    "page policy types",
)
policy_component = '''
const exampleCatalogPolicy: CatalogPolicySet = {
  version: 1,
  defaultEffect: "allow",
  adminBypass: true,
  rules: [
    { id: "hide-production", effect: "deny", users: [], groups: ["interns"], roles: [], categories: ["Production"], processes: [] },
    { id: "allow-dba-backups", effect: "allow", users: [], groups: ["dba"], roles: [], categories: [], processes: ["database-backup"] },
  ],
};

function CatalogPolicyEditor({ notify }: { notify: (message: string) => void }) {
  const [adminToken, setAdminToken] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("xyops-admin-token") ?? "");
  const [text, setText] = useState(JSON.stringify(exampleCatalogPolicy, null, 2));
  const [source, setSource] = useState<"database" | "environment" | "default" | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | null>(null);

  async function loadPolicies() {
    setBusy("load");
    try {
      const response = await fetch("/api/integrations/catalog/policies", { headers: { "x-admin-token": adminToken }, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось загрузить политики");
      window.sessionStorage.setItem("xyops-admin-token", adminToken);
      setText(JSON.stringify(data.policy, null, 2));
      setSource(data.source ?? "default");
      setUpdatedAt(data.updatedAt ?? null);
    } catch (error) { notify(error instanceof Error ? error.message : "Ошибка загрузки политик"); }
    finally { setBusy(null); }
  }

  async function savePolicies() {
    setBusy("save");
    try {
      const policy = JSON.parse(text) as CatalogPolicySet;
      const response = await fetch("/api/integrations/catalog/policies", { method: "PUT", headers: { "content-type": "application/json", "x-admin-token": adminToken }, body: JSON.stringify({ policy }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить политики");
      window.sessionStorage.setItem("xyops-admin-token", adminToken);
      setText(JSON.stringify(data.policy, null, 2));
      setSource("database");
      setUpdatedAt(data.updatedAt ?? Date.now());
      notify("Политики каталога сохранены");
    } catch (error) { notify(error instanceof Error ? error.message : "Некорректный JSON политик"); }
    finally { setBusy(null); }
  }

  return <section className="panel policy-editor"><div className="panel-title"><div><span className="eyebrow">CATALOG ACCESS</span><h2>Видимость категорий и процессов</h2><p>Правила применяются сервером к каталогу, dynamic options, запуску и safe re-run. Deny имеет приоритет над allow.</p></div>{source && <Status tone={source === "database" ? "success" : "neutral"}>{source === "database" ? "D1" : source === "environment" ? "ENV" : "По умолчанию"}</Status>}</div><div className="policy-toolbar"><label>ADMIN_TOKEN<input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Токен администратора" autoComplete="off" /></label><button className="secondary" disabled={!adminToken || Boolean(busy)} onClick={() => void loadPolicies()}>{busy === "load" ? "Загрузка…" : "Загрузить"}</button><button className="primary" disabled={!adminToken || Boolean(busy)} onClick={() => void savePolicies()}>{busy === "save" ? "Сохранение…" : "Сохранить политики"}</button></div><textarea className="policy-json" value={text} onChange={(event) => setText(event.target.value)} spellCheck={false} aria-label="JSON политик каталога" /><div className="policy-help"><span>Субъекты: <code>users</code>, <code>groups</code>, <code>roles</code></span><span>Ресурсы: <code>categories</code>, <code>processes</code></span><span>{updatedAt ? `Сохранено: ${new Date(updatedAt).toLocaleString("ru-RU")}` : "defaultEffect: allow сохраняет текущую доступность"}</span></div></section>;
}

'''
page = replace_once(page, '\nfunction Settings({ routes, catalog, catalogLoading, onSync, onRoutesChange, notify }:', '\n' + policy_component + 'function Settings({ routes, catalog, catalogLoading, onSync, onRoutesChange, notify }:', "policy editor component")
page = replace_once(
    page,
    '    <PersistentConnectionSettings notify={notify} />\n    <section className="panel inspector-panel">',
    '    <PersistentConnectionSettings notify={notify} />\n    <CatalogPolicyEditor notify={notify} />\n    <section className="panel inspector-panel">',
    "policy editor placement",
)
page_path.write_text(page)


css_path = Path("app/globals.css")
css = css_path.read_text()
marker = "/* CATALOG_VISIBILITY_POLICIES */"
if marker in css:
    raise RuntimeError("catalog policy css already exists")
css += '''

/* CATALOG_VISIBILITY_POLICIES */
.policy-editor { display:flex; flex-direction:column; gap:16px; }
.policy-toolbar { display:grid; grid-template-columns:minmax(240px,1fr) auto auto; gap:12px; align-items:end; }
.policy-toolbar label { display:flex; flex-direction:column; gap:7px; color:var(--muted); font-size:12px; font-weight:700; }
.policy-json { width:100%; min-height:360px; resize:vertical; border:1px solid var(--line); border-radius:14px; padding:16px; background:var(--soft); color:var(--text); font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace; tab-size:2; }
.policy-json:focus { outline:2px solid rgba(124,92,255,.22); border-color:var(--violet); }
.policy-help { display:flex; flex-wrap:wrap; gap:10px 20px; color:var(--muted); font-size:12px; }
.policy-help code { color:var(--violet); }
@media (max-width:800px) { .policy-toolbar { grid-template-columns:1fr; } .policy-toolbar button { width:100%; } }
'''
css_path.write_text(css)


for env_file in [Path(".env.example"), Path(".dev.vars.example")]:
    text = env_file.read_text()
    if "PORTAL_CATALOG_POLICIES_JSON" not in text:
        text += '''

# Catalog visibility policies. The JSON editor in Settings persists an override in D1.
# PORTAL_CATALOG_POLICIES_JSON={"version":1,"defaultEffect":"allow","adminBypass":true,"rules":[]}
# Static identity groups, comma-separated.
# PORTAL_STATIC_GROUPS=ops,dba
# Identity-to-groups mapping for workspace/static/proxy modes.
# PORTAL_GROUPS_JSON={"operator@example.test":["ops"],"*":["employees"]}
# Trusted proxy groups header; accepted only after PORTAL_PROXY_SHARED_SECRET validation.
# PORTAL_GROUPS_HEADER=x-auth-request-groups
'''
        env_file.write_text(text)
