import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value); }
function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) throw new Error(`Missing patch anchor: ${label}`);
  return source.replace(before, after);
}
function appendOnce(source, marker, value) { return source.includes(marker) ? source : `${source.trimEnd()}\n\n${value.trim()}\n`; }

let worker = read("worker/index.ts");
worker = replaceOnce(worker,
  'import { applyProcessPresentation, availableProcessPresentationLocales, presentationLocalePreferences, readProcessPresentationSet, resolveProcessPresentationLocale, saveProcessPresentationSet } from "../process-presentation";',
  'import { applyProcessPresentation, availableProcessPresentationLocales, presentationLocalePreferences, readProcessPresentationSet, resolveProcessPresentationLocale, saveProcessPresentationSet } from "../process-presentation";\nimport { authenticateLocalUser, bootstrapLocalAdmin, clearLocalSessionCookie, createLocalUser, deleteLocalUser, listLocalUsers, localAuthState, localSessionCookie, resetLocalUserPassword, resolveLocalSession, revokeLocalSession, revokeLocalUserSessions, updateLocalUser } from "../local-auth";',
  "worker import");
worker = replaceOnce(worker,
  '  PORTAL_DEFAULT_ROLE?: string;\n  PORTAL_RBAC_JSON?: string;',
  '  PORTAL_DEFAULT_ROLE?: string;\n  PORTAL_RBAC_JSON?: string;\n  PORTAL_IDENTITY_MODE?: string;\n  PORTAL_BOOTSTRAP_ADMIN_USERNAME?: string;\n  PORTAL_BOOTSTRAP_ADMIN_PASSWORD?: string;\n  PORTAL_BOOTSTRAP_ADMIN_NAME?: string;\n  PORTAL_SESSION_TTL_HOURS?: string;',
  "worker env");
worker = replaceOnce(worker,
  '    if (url.pathname.startsWith("/api/integrations/")) {\n      return handleIntegrationApi(request, runtimeEnv, url);\n    }',
  '    if (url.pathname.startsWith("/api/auth/")) {\n      return handleLocalAuthApi(request, runtimeEnv, url);\n    }\n\n    if (url.pathname.startsWith("/api/integrations/")) {\n      return handleIntegrationApi(request, runtimeEnv, url);\n    }',
  "worker auth routing");
worker = replaceOnce(worker,
  '/^\\/(?:automation(?:\\/[^/]+)?|users|groups|operations|approvals|audit|settings)\\/?$/.test(url.pathname)',
  '/^\\/(?:automation(?:\\/[^/]+)?|users|groups|operations|approvals|audit|access|settings|login)\\/?$/.test(url.pathname)',
  "worker spa routes");
worker = replaceOnce(worker,
`function portalAccess(request: Request, env: Env): { identity: string; role: PortalRole; groups: string[]; permissions: PortalPermission[] } {
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
}`,
`function portalAccess(request: Request, env: Env): { identity: string; role: PortalRole; groups: string[]; permissions: PortalPermission[] } {
  const identity = (request.headers.get("oai-authenticated-user-email") || "portal-user").trim().toLowerCase().slice(0, 160);
  const groups = Array.from(new Set(String(request.headers.get("oai-authenticated-user-groups") ?? "").split(",").map((value) => value.trim().toLowerCase()).filter((value) => value && value.length <= 120 && !/[\\r\\n]/.test(value)))).slice(0, 100);
  const trustedRole = portalRole(request.headers.get("x-portal-auth-role"));
  let selectedRole = trustedRole ?? portalRole(String(env.PORTAL_DEFAULT_ROLE || "").trim().toLowerCase()) ?? "viewer";
  if (!trustedRole && env.PORTAL_RBAC_JSON) {
    try {
      const assignments = JSON.parse(env.PORTAL_RBAC_JSON) as unknown;
      if (assignments && typeof assignments === "object" && !Array.isArray(assignments)) {
        const values = assignments as Record<string, unknown>;
        const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [key.trim().toLowerCase(), value]));
        selectedRole = portalRole(normalized[identity]) ?? portalRole(normalized["*"]) ?? selectedRole;
      }
    } catch {
      // Invalid RBAC configuration never grants more than the explicit default role.
    }
  }
  return { identity, role: selectedRole, groups, permissions: rolePermissions[selectedRole] };
}`,
  "worker portal access");

const authHandler = `
async function handleLocalAuthApi(request: Request, env: Env, url: URL): Promise<Response> {
  const localMode = String(env.PORTAL_IDENTITY_MODE ?? "").trim().toLowerCase() === "local";
  if (!localMode) return json({ enabled: false, authenticated: true }, request.method === "GET" ? 200 : 409);
  if (!env.DB) return json({ enabled: true, authenticated: false, error: "Локальная база данных недоступна" }, 503);

  try { await bootstrapLocalAdmin(env); }
  catch (error) { return json({ enabled: true, authenticated: false, error: error instanceof Error ? error.message : "Не удалось инициализировать локальную аутентификацию" }, 503); }

  if (request.method === "GET" && url.pathname === "/api/auth/session") {
    const [session, state] = await Promise.all([resolveLocalSession(env, request), localAuthState(env)]);
    if (!session) return json({ enabled: true, authenticated: false, ...state }, 401);
    return json({ enabled: true, authenticated: true, setupRequired: false, user: { id: session.userId, username: session.username, identity: session.identity, displayName: session.displayName, role: session.role, expiresAt: session.expiresAt } });
  }

  if (request.method === "POST" && url.pathname === "/api/auth/login") {
    try {
      const body = await request.json() as Record<string, unknown>;
      const authenticated = await authenticateLocalUser(env, body.username, body.password, request.headers.get("user-agent") ?? "");
      const headers = new Headers(jsonHeaders);
      headers.set("set-cookie", localSessionCookie(request, authenticated.token, authenticated.maxAge));
      return new Response(JSON.stringify({ authenticated: true, user: { id: authenticated.session.userId, username: authenticated.session.username, identity: authenticated.session.identity, displayName: authenticated.session.displayName, role: authenticated.session.role, expiresAt: authenticated.session.expiresAt } }), { status: 200, headers });
    } catch (error) {
      return json({ authenticated: false, error: error instanceof Error ? error.message : "Не удалось выполнить вход" }, 401);
    }
  }

  if (request.method === "POST" && url.pathname === "/api/auth/logout") {
    await revokeLocalSession(env, request);
    const headers = new Headers(jsonHeaders);
    headers.set("set-cookie", clearLocalSessionCookie(request));
    return new Response(JSON.stringify({ authenticated: false }), { status: 200, headers });
  }

  const denied = requirePortalPermission(request, env, "settings.manage");
  if (denied) return denied;
  const access = portalAccess(request, env);
  const current = await resolveLocalSession(env, request);
  if (!current) return json({ error: "Требуется повторный вход" }, 401);
  const audit = createAuditContext(access);

  if (url.pathname === "/api/auth/users") {
    if (request.method === "GET") return json({ users: await listLocalUsers(env) });
    if (request.method === "POST") {
      try {
        const body = await request.json() as Record<string, unknown>;
        const user = await createLocalUser(env, { username: body.username, displayName: body.displayName, password: body.password, role: body.role });
        await appendAuditEvent(env, audit, { action: "rbac.user.created", resourceType: "portal_user", resourceId: user.id, outcome: "success", metadata: { username: user.username, role: user.role } }).catch(() => {});
        return json({ user }, 201);
      } catch (error) { return json({ error: error instanceof Error ? error.message : "Не удалось создать пользователя" }, 400); }
    }
    return json({ error: "Method not allowed" }, 405);
  }

  const match = url.pathname.match(/^\\/api\\/auth\\/users\\/([A-Za-z0-9-]{1,80})(?:\\/(password|sessions))?$/);
  if (!match) return json({ error: "Not found" }, 404);
  const userId = match[1];
  const action = match[2] ?? "";

  if (action === "password" && request.method === "POST") {
    try {
      const body = await request.json() as Record<string, unknown>;
      await resetLocalUserPassword(env, userId, body.password);
      await appendAuditEvent(env, audit, { action: "rbac.user.password_reset", resourceType: "portal_user", resourceId: userId, outcome: "success", metadata: { sessionsRevoked: true } }).catch(() => {});
      return json({ ok: true });
    } catch (error) { return json({ error: error instanceof Error ? error.message : "Не удалось сменить пароль" }, 400); }
  }

  if (action === "sessions" && request.method === "DELETE") {
    await revokeLocalUserSessions(env, userId);
    await appendAuditEvent(env, audit, { action: "rbac.user.sessions_revoked", resourceType: "portal_user", resourceId: userId, outcome: "success", metadata: {} }).catch(() => {});
    return json({ ok: true });
  }

  if (!action && request.method === "PUT") {
    try {
      const body = await request.json() as Record<string, unknown>;
      if (current.userId === userId && (body.disabled === true || (body.role !== undefined && body.role !== "admin"))) return json({ error: "Нельзя отключить или понизить собственную активную учётную запись" }, 400);
      const user = await updateLocalUser(env, userId, { displayName: body.displayName, role: body.role, disabled: body.disabled });
      await appendAuditEvent(env, audit, { action: "rbac.user.updated", resourceType: "portal_user", resourceId: user.id, outcome: "success", metadata: { username: user.username, role: user.role, disabled: user.disabled } }).catch(() => {});
      return json({ user });
    } catch (error) { return json({ error: error instanceof Error ? error.message : "Не удалось обновить пользователя" }, 400); }
  }

  if (!action && request.method === "DELETE") {
    if (current.userId === userId) return json({ error: "Нельзя удалить собственную активную учётную запись" }, 400);
    try {
      await deleteLocalUser(env, userId);
      await appendAuditEvent(env, audit, { action: "rbac.user.deleted", resourceType: "portal_user", resourceId: userId, outcome: "success", metadata: {} }).catch(() => {});
      return json({ ok: true });
    } catch (error) { return json({ error: error instanceof Error ? error.message : "Не удалось удалить пользователя" }, 400); }
  }

  return json({ error: "Method not allowed" }, 405);
}
`;
worker = replaceOnce(worker, 'async function handleIntegrationApi(request: Request, baseEnv: Env, url: URL, inheritedAudit?: AuditContext): Promise<Response> {', `${authHandler}\nasync function handleIntegrationApi(request: Request, baseEnv: Env, url: URL, inheritedAudit?: AuditContext): Promise<Response> {`, "auth handler");
write("worker/index.ts", worker);

let secure = read("worker/secure-entry.ts");
secure = replaceOnce(secure,
  'import { appendAuditEvent, createAuditContext, type AuditContext } from "../audit-log";',
  'import { appendAuditEvent, createAuditContext, type AuditContext } from "../audit-log";\nimport { resolveLocalSession } from "../local-auth";',
  "secure import");
secure = replaceOnce(secure, 'type IdentityMode = "anonymous" | "workspace" | "proxy" | "static";', 'type IdentityMode = "anonymous" | "workspace" | "proxy" | "static" | "local";', "identity mode type");
secure = replaceOnce(secure,
  '  PORTAL_RBAC_JSON?: string;\n  ADMIN_TOKEN?: string;',
  '  PORTAL_RBAC_JSON?: string;\n  PORTAL_BOOTSTRAP_ADMIN_USERNAME?: string;\n  PORTAL_BOOTSTRAP_ADMIN_PASSWORD?: string;\n  PORTAL_BOOTSTRAP_ADMIN_NAME?: string;\n  PORTAL_SESSION_TTL_HOURS?: string;\n  ADMIN_TOKEN?: string;',
  "secure env");
secure = replaceOnce(secure,
  '  return value === "workspace" || value === "proxy" || value === "static" ? value : "anonymous";',
  '  return value === "workspace" || value === "proxy" || value === "static" || value === "local" ? value : "anonymous";',
  "identity mode parser");
secure = replaceOnce(secure,
`function requestRole(request: Request, env: SecureEnv): PortalRole {
  const identity = (request.headers.get("oai-authenticated-user-email") ?? "portal-user").trim().toLowerCase();
  let role = portalRole(String(env.PORTAL_DEFAULT_ROLE ?? "").trim().toLowerCase()) ?? "viewer";`,
`function requestRole(request: Request, env: SecureEnv): PortalRole {
  const identity = (request.headers.get("oai-authenticated-user-email") ?? "portal-user").trim().toLowerCase();
  const trustedRole = portalRole(request.headers.get("x-portal-auth-role"));
  if (trustedRole) return trustedRole;
  let role = portalRole(String(env.PORTAL_DEFAULT_ROLE ?? "").trim().toLowerCase()) ?? "viewer";`,
  "secure request role");
secure = replaceOnce(secure,
  '  headers.delete("oai-authenticated-user-groups");',
  '  headers.delete("oai-authenticated-user-groups");\n  headers.delete("x-portal-auth-role");',
  "strip role header");
secure = replaceOnce(secure,
`  } else if (mode === "static") {
    identity = normalizedIdentity(sourceEnv.PORTAL_STATIC_IDENTITY);
    displayName = normalizedName(sourceEnv.PORTAL_STATIC_NAME);
    groups = normalizedGroups(sourceEnv.PORTAL_STATIC_GROUPS);
  }

  if (identity) {`,
`  } else if (mode === "static") {
    identity = normalizedIdentity(sourceEnv.PORTAL_STATIC_IDENTITY);
    displayName = normalizedName(sourceEnv.PORTAL_STATIC_NAME);
    groups = normalizedGroups(sourceEnv.PORTAL_STATIC_GROUPS);
  } else if (mode === "local") {
    const session = await resolveLocalSession(sourceEnv, request);
    if (session) {
      identity = session.identity;
      displayName = session.displayName;
      headers.set("x-portal-auth-role", session.role);
    }
  }

  if (identity) {`,
  "local session resolution");
write("worker/secure-entry.ts", secure);

let page = read("app/page.tsx");
page = replaceOnce(page,
  'type Page = "overview" | "automation" | "users" | "groups" | "operations" | "approvals" | "audit" | "settings";',
  'type Page = "overview" | "automation" | "users" | "groups" | "operations" | "approvals" | "audit" | "access" | "settings";',
  "page type");
page = replaceOnce(page,
  'type PortalAccess = { identity: string; role: PortalRole; groups?: string[]; permissions: PortalPermission[] };',
  'type PortalAccess = { identity: string; role: PortalRole; groups?: string[]; permissions: PortalPermission[] };\ntype LocalAuthUser = { id: string; username: string; identity: string; displayName: string; role: PortalRole; disabled: boolean; failedAttempts: number; lockedUntil: number | null; createdAt: number; updatedAt: number; lastLoginAt: number | null; activeSessions: number };\ntype LocalAuthState = { enabled: boolean; authenticated: boolean; setupRequired?: boolean; persistenceAvailable?: boolean; user?: { id: string; username: string; identity: string; displayName: string; role: PortalRole; expiresAt: number } };',
  "auth ui types");
page = replaceOnce(page,
  '  { id: "audit", label: "Аудит", icon: "≣" },\n  { id: "settings", label: "Настройки", icon: "⚙" },',
  '  { id: "audit", label: "Аудит", icon: "≣" },\n  { id: "access", label: "Доступ", icon: "◉" },\n  { id: "settings", label: "Настройки", icon: "⚙" },',
  "access nav");
page = replaceOnce(page,
  'const pagePaths: Record<Page, string> = { overview: "/", automation: "/automation", users: "/users", groups: "/groups", operations: "/operations", approvals: "/approvals", audit: "/audit", settings: "/settings" };',
  'const pagePaths: Record<Page, string> = { overview: "/", automation: "/automation", users: "/users", groups: "/groups", operations: "/operations", approvals: "/approvals", audit: "/audit", access: "/access", settings: "/settings" };',
  "access path");
page = replaceOnce(page,
  '  const [toast, setToast] = useState("");',
  '  const [toast, setToast] = useState("");\n  const [authState, setAuthState] = useState<LocalAuthState | null>(null);\n  const [authChecking, setAuthChecking] = useState(true);',
  "auth state");
page = replaceOnce(page,
  '  const shownNotificationIds = useRef(new Set<string>());\n\n  useEffect(() => {',
  '  const shownNotificationIds = useRef(new Set<string>());\n\n  useEffect(() => {\n    fetch("/api/auth/session", { cache: "no-store" })\n      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))\n      .then(({ data }) => setAuthState(data as LocalAuthState))\n      .catch(() => setAuthState({ enabled: true, authenticated: false }))\n      .finally(() => setAuthChecking(false));\n  }, []);\n\n  useEffect(() => {',
  "session loader");
page = replaceOnce(page,
  '  const visibleNav = nav.filter((item) => !["settings", "audit"].includes(item.id) || canManageSettings);',
  '  const visibleNav = nav.filter((item) => !["settings", "audit", "access"].includes(item.id) || (canManageSettings && (item.id !== "access" || authState?.enabled)));',
  "visible access nav");
page = replaceOnce(page,
`  async function enableSystemNotifications() {
    if (!("Notification" in window)) {`,
`  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/login");
  }

  async function enableSystemNotifications() {
    if (!("Notification" in window)) {`,
  "logout function");
page = replaceOnce(page,
  '  return (\n    <div className="app-shell">',
  '  if (authChecking) return <div className="auth-screen"><div className="auth-card"><div className="auth-logo">◇</div><h1>Загрузка портала</h1><p>Проверяем локальную сессию…</p></div></div>;\n  if (authState?.enabled && !authState.authenticated) return <LoginScreen setupRequired={authState.setupRequired === true} />;\n\n  return (\n    <div className="app-shell">',
  "login gate");
page = replaceOnce(page,
  '<button className="profile" title={`Роль: ${roleLabels[integration.access.role]}`}>{integration.viewer.slice(0, 2).toUpperCase()} <span>{integration.viewer}<small>{roleLabels[integration.access.role]}</small></span></button>',
  '<button className="profile" title="Выйти из локальной сессии" onClick={() => void logout()}>{integration.viewer.slice(0, 2).toUpperCase()} <span>{authState?.user?.displayName || integration.viewer}<small>{roleLabels[integration.access.role]} · выйти</small></span></button>',
  "profile logout");
page = replaceOnce(page,
  '        {page === "audit" && canManageSettings && <AuditLog />}\n        {page === "settings" && canManageSettings && <Settings',
  '        {page === "audit" && canManageSettings && <AuditLog />}\n        {page === "access" && canManageSettings && authState?.enabled && <AccessManagement currentUserId={authState.user?.id ?? ""} notify={notify} />}\n        {page === "settings" && canManageSettings && <Settings',
  "access page render");

const components = `
function LoginScreen({ setupRequired }: { setupRequired: boolean }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось выполнить вход");
      window.location.assign("/");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось выполнить вход"); }
    finally { setLoading(false); }
  }
  return <div className="auth-screen"><form className="auth-card" onSubmit={submit}><div className="auth-logo">◇</div><span className="eyebrow">LOCAL PORTAL</span><h1>Вход в административный портал</h1><p>Используйте внутреннюю учётную запись портала. Пользователи FreeIPA не используются для входа.</p>{setupRequired && <div className="auth-warning">Первый администратор ещё не создан. Задайте PORTAL_BOOTSTRAP_ADMIN_USERNAME и PORTAL_BOOTSTRAP_ADMIN_PASSWORD в .env и перезапустите контейнер.</div>}<label>Логин<input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label><label>Пароль<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error && <div className="auth-error">{error}</div>}<button className="primary" disabled={loading || setupRequired}>{loading ? "Вход…" : "Войти"}</button></form></div>;
}

function AccessManagement({ currentUserId, notify }: { currentUserId: string; notify: (message: string) => void }) {
  const [users, setUsers] = useState<LocalAuthUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ username: "", displayName: "", password: "", role: "viewer" as PortalRole });
  const load = useCallback(async () => {
    setLoading(true);
    try { const response = await fetch("/api/auth/users", { cache: "no-store" }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Не удалось загрузить пользователей"); setUsers(Array.isArray(data.users) ? data.users : []); }
    catch (error) { notify(error instanceof Error ? error.message : "Не удалось загрузить пользователей"); }
    finally { setLoading(false); }
  }, [notify]);
  useEffect(() => { void load(); }, [load]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    try { const response = await fetch("/api/auth/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(form) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Не удалось создать пользователя"); setForm({ username: "", displayName: "", password: "", role: "viewer" }); await load(); notify("Локальный пользователь создан"); }
    catch (error) { notify(error instanceof Error ? error.message : "Не удалось создать пользователя"); }
  }
  async function update(user: LocalAuthUser, patch: Record<string, unknown>) {
    try { const response = await fetch(`/api/auth/users/${user.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Не удалось обновить пользователя"); await load(); notify("Права пользователя обновлены"); }
    catch (error) { notify(error instanceof Error ? error.message : "Не удалось обновить пользователя"); }
  }
  async function resetPassword(user: LocalAuthUser) {
    const password = window.prompt(`Новый пароль для ${user.username} (минимум 12 символов)`); if (!password) return;
    try { const response = await fetch(`/api/auth/users/${user.id}/password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data.error || "Не удалось сменить пароль"); await load(); notify("Пароль изменён, активные сессии отозваны"); }
    catch (error) { notify(error instanceof Error ? error.message : "Не удалось сменить пароль"); }
  }
  async function revoke(user: LocalAuthUser) {
    const response = await fetch(`/api/auth/users/${user.id}/sessions`, { method: "DELETE" }); const data = await response.json().catch(() => ({})); if (!response.ok) return notify(data.error || "Не удалось отозвать сессии"); await load(); notify("Сессии пользователя отозваны");
  }
  async function remove(user: LocalAuthUser) {
    if (!window.confirm(`Удалить локального пользователя ${user.username}?`)) return;
    const response = await fetch(`/api/auth/users/${user.id}`, { method: "DELETE" }); const data = await response.json().catch(() => ({})); if (!response.ok) return notify(data.error || "Не удалось удалить пользователя"); await load(); notify("Пользователь удалён");
  }
  return <div className="access-page"><section className="panel access-head"><div><span className="eyebrow">LOCAL RBAC</span><h2>Управление доступом</h2><p>Это отдельные внутренние пользователи портала. Учётные записи и группы FreeIPA не дают доступ автоматически.</p></div><Status tone="success">{users.length} пользователей</Status><button className="secondary" onClick={() => void load()} disabled={loading}>{loading ? "Загрузка…" : "Обновить"}</button></section><form className="panel access-create" onSubmit={create}><h3>Новый пользователь</h3><label>Логин<input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="operator01" required /></label><label>Отображаемое имя<input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} placeholder="Оператор" /></label><label>Пароль<input type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={12} required /></label><label>Роль<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as PortalRole })}><option value="viewer">Наблюдатель</option><option value="operator">Оператор</option><option value="admin">Администратор</option></select></label><button className="primary">Создать</button></form><section className="access-list">{users.map((user) => <article className={`panel access-user ${user.disabled ? "disabled" : ""}`} key={user.id}><div className="access-user-main"><div className="access-avatar">{user.username.slice(0, 2).toUpperCase()}</div><div><strong>{user.displayName}</strong><span>{user.username}</span><small>{user.identity}</small></div>{user.id === currentUserId && <Status tone="violet">Текущая сессия</Status>}</div><div className="access-controls"><label>Роль<select value={user.role} disabled={user.id === currentUserId} onChange={(event) => void update(user, { role: event.target.value })}><option value="viewer">Наблюдатель</option><option value="operator">Оператор</option><option value="admin">Администратор</option></select></label><label className="access-toggle"><input type="checkbox" checked={!user.disabled} disabled={user.id === currentUserId} onChange={(event) => void update(user, { disabled: !event.target.checked })} /> Активен</label></div><div className="access-meta"><span>Последний вход: <b>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : "не выполнялся"}</b></span><span>Активные сессии: <b>{user.activeSessions}</b></span>{user.lockedUntil && user.lockedUntil > Date.now() && <span className="danger-text">Заблокирован до {formatDateTime(user.lockedUntil)}</span>}</div><div className="access-actions"><button className="secondary" onClick={() => void resetPassword(user)}>Сменить пароль</button><button className="secondary" onClick={() => void revoke(user)}>Отозвать сессии</button><button className="danger-button" disabled={user.id === currentUserId} onClick={() => void remove(user)}>Удалить</button></div></article>)}</section></div>;
}
`;
page = replaceOnce(page, '\nfunction Approvals(', `\n${components}\nfunction Approvals(`, "auth components");
write("app/page.tsx", page);

let css = read("app/globals.css");
css = appendOnce(css, ".auth-screen", `
/* Local authentication and RBAC */
.auth-screen { min-height: 100vh; display: grid; place-items: center; padding: 28px; background: radial-gradient(circle at top, rgba(92, 77, 255, .13), transparent 42%), var(--background); }
.auth-card { width: min(460px, 100%); display: grid; gap: 16px; padding: 34px; border-radius: 22px; background: var(--surface); border: 1px solid var(--border); box-shadow: 0 24px 70px rgba(21, 24, 45, .16); }
.auth-logo { width: 54px; height: 54px; display: grid; place-items: center; border-radius: 16px; background: var(--primary); color: white; font-size: 28px; }
.auth-card h1 { margin: 0; font-size: 26px; }
.auth-card p { margin: 0; color: var(--muted); line-height: 1.5; }
.auth-card label { display: grid; gap: 7px; font-size: 13px; font-weight: 700; }
.auth-card input { width: 100%; }
.auth-warning, .auth-error { padding: 12px 14px; border-radius: 10px; line-height: 1.4; }
.auth-warning { background: rgba(245, 158, 11, .12); color: #92400e; }
.auth-error { background: rgba(220, 38, 38, .1); color: #b42318; }
.access-page { display: grid; gap: 16px; }
.access-head { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 22px; }
.access-head h2, .access-create h3 { margin: 4px 0; }
.access-head p { margin: 0; color: var(--muted); max-width: 760px; }
.access-create { display: grid; grid-template-columns: 1fr 1.4fr 1.2fr .9fr auto; gap: 12px; align-items: end; padding: 18px; }
.access-create h3 { grid-column: 1 / -1; }
.access-create label, .access-controls label { display: grid; gap: 6px; font-size: 12px; font-weight: 700; color: var(--muted); }
.access-list { display: grid; gap: 12px; }
.access-user { display: grid; grid-template-columns: minmax(220px, 1.2fr) minmax(220px, .9fr); gap: 16px; padding: 18px; }
.access-user.disabled { opacity: .68; }
.access-user-main { display: flex; align-items: center; gap: 12px; }
.access-avatar { width: 42px; height: 42px; display: grid; place-items: center; border-radius: 12px; background: var(--surface-2); font-weight: 800; }
.access-user-main div:nth-child(2) { display: grid; gap: 2px; }
.access-user-main span, .access-user-main small { color: var(--muted); }
.access-controls { display: flex; gap: 14px; align-items: center; justify-content: flex-end; }
.access-toggle { display: flex !important; grid-auto-flow: column; align-items: center; }
.access-meta { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px 20px; color: var(--muted); font-size: 12px; }
.access-actions { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; }
.danger-text { color: #b42318; font-weight: 700; }
@media (max-width: 1000px) { .access-create { grid-template-columns: 1fr 1fr; } .access-user { grid-template-columns: 1fr; } .access-controls { justify-content: flex-start; } }
@media (max-width: 620px) { .access-head { align-items: stretch; flex-direction: column; } .access-create { grid-template-columns: 1fr; } }
`);
write("app/globals.css", css);

let env = read(".env.example");
env = replaceOnce(env,
`# Identity modes:
# - anonymous: safe default; every request is read-only viewer
# - static: isolated local development only; all requests use one server identity
# - workspace: trust OpenAI Sites oai-authenticated-user-* headers
# - proxy: trust reverse-proxy identity headers only with the shared secret
PORTAL_IDENTITY_MODE=static
PORTAL_STATIC_IDENTITY=admin@company.local`,
`# Identity modes:
# - local: internal portal users, passwords and sessions in local SQLite (recommended)
# - anonymous: read-only viewer without authentication
# - static: isolated development only; all requests use one configured identity
# - workspace/proxy: legacy external identity modes
PORTAL_IDENTITY_MODE=local
PORTAL_BOOTSTRAP_ADMIN_USERNAME=admin
PORTAL_BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-password-at-least-12-characters
PORTAL_BOOTSTRAP_ADMIN_NAME=Локальный администратор
PORTAL_SESSION_TTL_HOURS=12
# PORTAL_STATIC_IDENTITY=admin@company.local`,
  "env local identity");
write(".env.example", env);

let readme = read("README.md");
readme = replaceOnce(readme,
`Идентичность определяется по заголовку \`oai-authenticated-user-email\`.
Назначение ролей задается в \`PORTAL_RBAC_JSON\` в формате
\`{"user@company.local":"admin", ...}\`. По умолчанию — \`admin\`.`,
`По умолчанию портал использует локальную аутентификацию: внутренние пользователи,
PBKDF2-хеши паролей и HttpOnly-сессии хранятся в локальной SQLite/D1-совместимой базе.
Роли \`viewer\`, \`operator\` и \`admin\` назначаются через раздел «Доступ».
Пользователи и группы FreeIPA не участвуют во входе и не получают права автоматически.`,
  "readme auth summary");
readme = replaceOnce(readme,
`## RBAC и безопасность

По умолчанию все аутентифицированные пользователи получают роль \`admin\`.
Для production назначьте роли через \`PORTAL_RBAC_JSON\`:

\`\`\`bash
PORTAL_RBAC_JSON={"admin@company.local":"admin","ops@company.local":"operator","audit@company.local":"viewer"}
PORTAL_DEFAULT_ROLE=viewer
\`\`\`

Идентичность берется из заголовка \`oai-authenticated-user-email\`, который
внедряет платформа Sites или обратный прокси. Если заголовок отсутствует,
используется \`portal-user\`.`,
`## Локальная аутентификация и RBAC

Для локального запуска используйте \`PORTAL_IDENTITY_MODE=local\`. Первый администратор
создаётся из \`PORTAL_BOOTSTRAP_ADMIN_USERNAME\` и \`PORTAL_BOOTSTRAP_ADMIN_PASSWORD\`
только когда таблица пользователей пуста. После первого входа создавайте пользователей,
назначайте роли, блокируйте учётные записи, меняйте пароли и отзывайте сессии через
раздел «Доступ». Роль по умолчанию всегда \`viewer\`, а последнего активного
администратора удалить или отключить нельзя.`,
  "readme security section");
readme = replaceOnce(readme,
  '- [Расширенный аудит](docs/AUDIT_LOG.md)',
  '- [Расширенный аудит](docs/AUDIT_LOG.md)\n- [Локальная аутентификация и RBAC](docs/LOCAL_AUTH_RBAC.md)',
  "readme docs link");
write("README.md", readme);

let roadmap = read("docs/PRODUCT_ROADMAP.md");
roadmap = replaceOnce(roadmap,
  '- [x] Расширенный аудит: append-only журнал, роль, approval, версия схемы и correlation ID.',
  '- [x] Расширенный аудит: append-only журнал, роль, approval, версия схемы и correlation ID.\n- [x] Локальная база пользователей, PBKDF2-пароли и HttpOnly-сессии.\n- [x] Управление RBAC через UI: создание, роли, блокировка, сброс пароля и отзыв сессий.\n- [x] Защита последнего активного администратора.',
  "roadmap local auth");
write("docs/PRODUCT_ROADMAP.md", roadmap);
