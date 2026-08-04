const diagnosticsPath = "/diagnostics/health";
const diagnosticsScriptPath = "/diagnostics/health.js";
const diagnosticsStylePath = "/diagnostics/health.css";
const diagnosticsPaths = new Set([diagnosticsPath, diagnosticsScriptPath, diagnosticsStylePath]);

const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

const diagnosticsHtml = String.raw`<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Health diagnostics · FreeIPA Admin Dashboard</title>
  <link rel="stylesheet" href="/diagnostics/health.css">
  <script src="/diagnostics/health.js" defer></script>
</head>
<body>
  <main class="shell" aria-labelledby="page-title">
    <header class="page-header">
      <div>
        <p class="eyebrow">FreeIPA Admin Dashboard</p>
        <h1 id="page-title">Диагностика состояния портала</h1>
        <p class="lead">Безопасное представление liveness, readiness и внешних зависимостей без адресов, учётных данных и необработанных ошибок.</p>
      </div>
      <div class="actions" aria-label="Действия диагностики">
        <button id="refresh-health" type="button">Обновить</button>
        <button id="copy-health" type="button" class="secondary">Копировать безопасный снимок</button>
      </div>
    </header>

    <section class="summary-panel" aria-live="polite">
      <div>
        <span class="label">Общее состояние</span>
        <strong id="overall-state" class="state state-unready">Проверка…</strong>
      </div>
      <div>
        <span class="label">Последнее обновление</span>
        <strong id="last-updated">—</strong>
      </div>
      <p id="action-status" class="action-status" role="status"></p>
    </section>

    <section class="contract-grid" aria-label="Контракты состояния">
      <article id="live-card" class="health-card state-unready">
        <div class="card-heading">
          <div>
            <p class="eyebrow">/health/live</p>
            <h2>Liveness</h2>
          </div>
          <span id="live-state" class="state state-unready">unknown</span>
        </div>
        <dl>
          <div><dt>Код</dt><dd id="live-code">—</dd></div>
          <div><dt>Интерпретация</dt><dd id="live-detail">Worker ещё не проверен.</dd></div>
        </dl>
      </article>

      <article id="ready-card" class="health-card state-unready">
        <div class="card-heading">
          <div>
            <p class="eyebrow">/health/ready</p>
            <h2>Readiness</h2>
          </div>
          <span id="ready-state" class="state state-unready">unknown</span>
        </div>
        <dl>
          <div><dt>Код</dt><dd id="ready-code">—</dd></div>
          <div><dt>Интерпретация</dt><dd id="ready-detail">Обязательный локальный runtime ещё не проверен.</dd></div>
        </dl>
      </article>
    </section>

    <section class="panel" aria-labelledby="dependency-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">/health/dependencies</p>
          <h2 id="dependency-heading">Внешние зависимости</h2>
        </div>
        <span id="dependency-overall-state" class="state state-unready">unknown</span>
      </div>
      <p class="notice"><strong>Не перезапускайте портал только из-за degraded dependency state</strong>. Сначала используйте категорию, код, задержку и время последнего успешного ответа для диагностики.</p>
      <div id="dependency-list" class="dependency-grid" aria-live="polite"></div>
    </section>

    <section class="panel" aria-labelledby="remediation-heading">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Operator guidance</p>
          <h2 id="remediation-heading">Рекомендуемые действия</h2>
        </div>
      </div>
      <ol id="remediation-list" class="remediation-list">
        <li>Запустите проверку, чтобы получить безопасные рекомендации.</li>
      </ol>
    </section>

    <footer>
      <p>Страница использует только same-origin sanitized health contracts. Секреты, URL интеграций и необработанные upstream-ответы здесь не отображаются.</p>
    </footer>
  </main>
</body>
</html>`;

const diagnosticsScript = String.raw`"use strict";

const endpoints = Object.freeze({
  live: "/health/live",
  ready: "/health/ready",
  dependencies: "/health/dependencies",
});

const allowedStates = new Set(["healthy", "degraded", "unready", "unconfigured", "unknown"]);
const allowedCategories = new Set([
  "ok",
  "configuration",
  "dns",
  "tls",
  "timeout",
  "authentication",
  "rate_limited",
  "upstream",
  "protocol",
  "network",
  "disabled",
]);
const remediationByCode = Object.freeze({
  health_database_unavailable: "Проверьте D1 binding и доступность локального хранилища. Не запускайте восстановление до подтверждения состояния тома.",
  dependency_database_unavailable: "Dependency evaluation не может прочитать D1. Сначала устраните проблему локального хранилища.",
  health_schema_unready: "Проверьте canonical schema status и migration journal через административную диагностику схемы.",
  dependency_schema_unready: "Внешние probes остановлены schema boundary. Сначала устраните migration или drift проблему.",
  health_encryption_unavailable: "Проверьте формат CONFIG_ENCRYPTION_KEY и соответствие ключа текущим зашифрованным настройкам.",
  dependency_configuration_unavailable: "Effective settings нельзя безопасно прочитать или расшифровать. Проверьте ключ и сохранённую revision.",
  health_gateway_unavailable: "Проверьте локальный Node Gateway и согласованность ephemeral token, не обращаясь к внешнему FreeIPA.",
  freeipa_not_configured: "Заполните URL, пользователя и пароль FreeIPA, затем выполните безопасный connection test.",
  freeipa_dns_failed: "Проверьте DNS-разрешение имени FreeIPA из среды Node Gateway.",
  freeipa_tls_failed: "Проверьте цепочку доверия, срок и SAN TLS-сертификата FreeIPA.",
  freeipa_timeout: "Проверьте маршрут, firewall и задержку до FreeIPA. Повторный probe выполните после устранения сети.",
  freeipa_auth_rejected: "Проверьте сервисную учётную запись FreeIPA и её пароль без публикации credentials в отчёте.",
  freeipa_protocol_failed: "Проверьте совместимость FreeIPA JSON-RPC endpoint и отсутствие неожиданных redirect/HTML ответов.",
  freeipa_unavailable: "Проверьте доступность FreeIPA и маршрут от локального Gateway.",
  xyops_not_configured: "Заполните XYOps URL и API key либо явно используйте demo mode.",
  xyops_auth_rejected: "Проверьте действительность и права XYOps API key.",
  xyops_rate_limited: "Уменьшите частоту ручных проверок и дождитесь снятия ограничения XYOps.",
  xyops_upstream_failed: "Проверьте состояние XYOps и его server-side logs; портал перезапускать не требуется.",
  xyops_timeout: "Проверьте маршрут и задержку до XYOps, затем повторите read-only probe.",
  xyops_protocol_failed: "Проверьте совместимость XYOps API и формат read-only ответа каталога.",
  xyops_unavailable: "Проверьте сетевую доступность XYOps из среды портала.",
});

let sanitizedSnapshot = Object.freeze({});

function byId(id) {
  return document.getElementById(id);
}

function safeString(value, fallback) {
  return typeof value === "string" && value.length <= 128 ? value : fallback;
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

function safeTimestamp(value) {
  const numeric = safeNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function safeState(value) {
  return typeof value === "string" && allowedStates.has(value) ? value : "unknown";
}

function safeCategory(value) {
  return typeof value === "string" && allowedCategories.has(value) ? value : "protocol";
}

function stateClass(value) {
  const state = safeState(value);
  if (state === "healthy") return "state-healthy";
  if (state === "degraded" || state === "unconfigured") return "state-degraded";
  return "state-unready";
}

function setState(element, state) {
  const normalized = safeState(state);
  element.textContent = normalized;
  element.classList.remove("state-healthy", "state-degraded", "state-unready");
  element.classList.add(stateClass(normalized));
}

function formatTimestamp(value) {
  const timestamp = safeTimestamp(value);
  if (timestamp === null) return "нет успешных данных";
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "medium",
  }).format(new Date(timestamp));
}

function formatLatency(value) {
  const latency = safeNumber(value);
  return latency === null ? "—" : String(latency) + " мс";
}

function sanitizeContract(payload, expectedCheck) {
  const source = payload && typeof payload === "object" ? payload : {};
  const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {};
  return Object.freeze({
    check: safeString(source.check, expectedCheck),
    state: safeState(source.state),
    code: safeString(source.code, "diagnostics_contract_unavailable"),
    ok: source.ok === true,
    schemaVersion: safeNumber(metadata.schemaVersion),
    latestSchemaVersion: safeNumber(metadata.latestSchemaVersion),
  });
}

function sanitizeDependency(item) {
  const source = item && typeof item === "object" ? item : {};
  const name = source.name === "freeipa" || source.name === "xyops" ? source.name : "unknown";
  return Object.freeze({
    name,
    state: safeState(source.state),
    category: safeCategory(source.category),
    code: safeString(source.code, "dependency_protocol_failed"),
    latencyMs: safeNumber(source.latencyMs),
    lastSuccessAt: safeTimestamp(source.lastSuccessAt),
  });
}

function sanitizeDependencies(payload) {
  const source = payload && typeof payload === "object" ? payload : {};
  const rawDependencies = Array.isArray(source.dependencies) ? source.dependencies : [];
  const dependencies = rawDependencies.map(sanitizeDependency).filter((item) => item.name !== "unknown").slice(0, 2);
  return Object.freeze({
    check: safeString(source.check, "dependencies"),
    state: safeState(source.state),
    code: safeString(source.code, "dependencies_unavailable"),
    ok: source.ok === true,
    dependencies,
  });
}

async function fetchContract(path) {
  try {
    const response = await fetch(path, {
      method: "GET",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    const payload = await response.json().catch(() => null);
    return { responseOk: response.ok, payload };
  } catch {
    return { responseOk: false, payload: null };
  }
}

function contractDetail(contract, kind) {
  if (contract.state === "healthy") {
    return kind === "live" ? "Worker отвечает и не требует перезапуска." : "Обязательный локальный runtime готов принимать рабочий трафик.";
  }
  if (kind === "live") return "Worker не подтвердил liveness. Проверьте процесс и container logs.";
  return "Readiness не подтверждена. Instance следует исключить из рабочего трафика без автоматического restart loop.";
}

function renderContract(kind, contract) {
  const card = byId(kind + "-card");
  const state = byId(kind + "-state");
  setState(state, contract.state);
  card.classList.remove("state-healthy", "state-degraded", "state-unready");
  card.classList.add(stateClass(contract.state));
  byId(kind + "-code").textContent = contract.code;
  byId(kind + "-detail").textContent = contractDetail(contract, kind);
}

function dependencyTitle(name) {
  return name === "freeipa" ? "FreeIPA" : "XYOps";
}

function appendDefinition(list, term, value) {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  const dd = document.createElement("dd");
  dt.textContent = term;
  dd.textContent = value;
  row.append(dt, dd);
  list.append(row);
}

function renderDependencies(contract) {
  const container = byId("dependency-list");
  container.replaceChildren();
  setState(byId("dependency-overall-state"), contract.state);

  if (contract.dependencies.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Dependency evaluation недоступна. Используйте код контракта в рекомендациях ниже.";
    container.append(empty);
    return;
  }

  for (const item of contract.dependencies) {
    const article = document.createElement("article");
    article.className = "dependency-card " + stateClass(item.state);
    const heading = document.createElement("div");
    heading.className = "card-heading";
    const title = document.createElement("h3");
    title.textContent = dependencyTitle(item.name);
    const badge = document.createElement("span");
    badge.className = "state " + stateClass(item.state);
    badge.textContent = item.state;
    heading.append(title, badge);

    const list = document.createElement("dl");
    appendDefinition(list, "Категория", item.category);
    appendDefinition(list, "Код", item.code);
    appendDefinition(list, "Задержка", formatLatency(item.latencyMs));
    appendDefinition(list, "Последний успех", formatTimestamp(item.lastSuccessAt));
    article.append(heading, list);
    container.append(article);
  }
}

function remediationCodes(snapshot) {
  const codes = [snapshot.live.code, snapshot.ready.code, snapshot.dependencies.code];
  for (const item of snapshot.dependencies.dependencies) codes.push(item.code);
  return Array.from(new Set(codes));
}

function remediationText(code) {
  return remediationByCode[code] || "Сопоставьте безопасный code с runbook и проверьте соответствующий локальный или внешний компонент без публикации connectivity details.";
}

function renderRemediation(snapshot) {
  const list = byId("remediation-list");
  list.replaceChildren();
  const codes = remediationCodes(snapshot).filter((code) => code !== "health_live" && code !== "health_ready" && code !== "dependencies_healthy");
  const effectiveCodes = codes.length > 0 ? codes : ["healthy"];
  for (const code of effectiveCodes) {
    const item = document.createElement("li");
    if (code === "healthy") {
      item.textContent = "Все проверенные контракты healthy. Продолжайте обычный monitoring без операторского вмешательства.";
    } else {
      const strong = document.createElement("strong");
      strong.textContent = code + ": ";
      item.append(strong, document.createTextNode(remediationText(code)));
    }
    list.append(item);
  }
}

function overallState(snapshot) {
  if (snapshot.live.state !== "healthy" || snapshot.ready.state !== "healthy") return "unready";
  if (snapshot.dependencies.state !== "healthy") return "degraded";
  return "healthy";
}

function renderSnapshot(snapshot) {
  renderContract("live", snapshot.live);
  renderContract("ready", snapshot.ready);
  renderDependencies(snapshot.dependencies);
  renderRemediation(snapshot);
  setState(byId("overall-state"), overallState(snapshot));
  byId("last-updated").textContent = formatTimestamp(snapshot.observedAt);
}

async function refreshDiagnostics() {
  const refreshButton = byId("refresh-health");
  const actionStatus = byId("action-status");
  refreshButton.disabled = true;
  actionStatus.textContent = "Выполняется безопасная проверка…";

  const [liveResult, readyResult, dependencyResult] = await Promise.all([
    fetchContract(endpoints.live),
    fetchContract(endpoints.ready),
    fetchContract(endpoints.dependencies),
  ]);

  sanitizedSnapshot = Object.freeze({
    observedAt: Date.now(),
    live: sanitizeContract(liveResult.payload, "liveness"),
    ready: sanitizeContract(readyResult.payload, "readiness"),
    dependencies: sanitizeDependencies(dependencyResult.payload),
  });
  renderSnapshot(sanitizedSnapshot);
  actionStatus.textContent = liveResult.responseOk || readyResult.responseOk || dependencyResult.responseOk
    ? "Безопасный снимок обновлён."
    : "Health endpoints не ответили; показано состояние unavailable.";
  refreshButton.disabled = false;
}

async function copySnapshot() {
  const actionStatus = byId("action-status");
  try {
    await navigator.clipboard.writeText(JSON.stringify(sanitizedSnapshot, null, 2));
    actionStatus.textContent = "Безопасный снимок скопирован.";
  } catch {
    actionStatus.textContent = "Браузер не разрешил копирование. Используйте ручное обновление и снимок экрана без секретов.";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  byId("refresh-health").addEventListener("click", () => { void refreshDiagnostics(); });
  byId("copy-health").addEventListener("click", () => { void copySnapshot(); });
  void refreshDiagnostics();
});
`;

const diagnosticsStyle = String.raw`:root {
  color-scheme: light dark;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: Canvas;
  color: CanvasText;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-width: 320px;
  background: color-mix(in srgb, Canvas 94%, #5b6cff 6%);
}

button,
input,
select,
textarea { font: inherit; }

button {
  border: 1px solid transparent;
  border-radius: 0.75rem;
  padding: 0.72rem 1rem;
  background: #3154d8;
  color: #fff;
  cursor: pointer;
  font-weight: 700;
}

button.secondary {
  background: transparent;
  color: CanvasText;
  border-color: color-mix(in srgb, CanvasText 24%, transparent);
}

button:disabled { cursor: progress; opacity: 0.6; }

button:hover:not(:disabled) { filter: brightness(1.08); }

:focus-visible {
  outline: 3px solid #ffb000;
  outline-offset: 3px;
}

.shell {
  width: min(1120px, calc(100% - 2rem));
  margin: 0 auto;
  padding: 2rem 0 3rem;
}

.page-header,
.section-heading,
.card-heading,
.summary-panel {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.page-header { margin-bottom: 1.25rem; }

h1,
h2,
h3,
p { margin-top: 0; }

h1 { margin-bottom: 0.6rem; font-size: clamp(1.8rem, 5vw, 3rem); }
h2 { margin-bottom: 0; font-size: 1.25rem; }
h3 { margin-bottom: 0; font-size: 1.05rem; }

.lead,
footer,
.action-status { color: color-mix(in srgb, CanvasText 72%, transparent); }

.eyebrow,
.label {
  display: block;
  margin-bottom: 0.35rem;
  color: color-mix(in srgb, CanvasText 62%, transparent);
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.actions { display: flex; flex-wrap: wrap; gap: 0.65rem; }

.summary-panel,
.health-card,
.panel,
.dependency-card {
  border: 1px solid color-mix(in srgb, CanvasText 16%, transparent);
  border-radius: 1rem;
  background: color-mix(in srgb, Canvas 97%, CanvasText 3%);
  box-shadow: 0 12px 40px color-mix(in srgb, CanvasText 8%, transparent);
}

.summary-panel {
  margin-bottom: 1rem;
  padding: 1rem 1.2rem;
  align-items: center;
}

.action-status { margin: 0; min-height: 1.4rem; }

.contract-grid,
.dependency-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
}

.contract-grid { margin-bottom: 1rem; }

.health-card,
.dependency-card { padding: 1.2rem; border-left-width: 0.35rem; }

.panel { margin-bottom: 1rem; padding: 1.2rem; }

.state {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 6.5rem;
  border-radius: 999px;
  padding: 0.35rem 0.65rem;
  font-size: 0.78rem;
  font-weight: 800;
  text-transform: uppercase;
}

.state-healthy { border-color: #16845b; }
.state-degraded { border-color: #b16a00; }
.state-unready { border-color: #b93642; }

.state.state-healthy { background: color-mix(in srgb, #16845b 18%, transparent); color: #16845b; }
.state.state-degraded { background: color-mix(in srgb, #b16a00 18%, transparent); color: #a65f00; }
.state.state-unready { background: color-mix(in srgb, #b93642 18%, transparent); color: #b93642; }

dl { margin: 1rem 0 0; }
dl > div { display: grid; grid-template-columns: 9rem 1fr; gap: 0.75rem; margin-top: 0.55rem; }
dt { color: color-mix(in srgb, CanvasText 62%, transparent); }
dd { margin: 0; overflow-wrap: anywhere; }

.notice {
  margin: 1rem 0;
  padding: 0.85rem 1rem;
  border-left: 0.3rem solid #b16a00;
  background: color-mix(in srgb, #b16a00 10%, transparent);
}

.remediation-list { margin: 1rem 0 0; padding-left: 1.35rem; }
.remediation-list li + li { margin-top: 0.75rem; }
.empty-state { grid-column: 1 / -1; margin: 0; padding: 1rem; }

footer { padding: 0.5rem 0; font-size: 0.9rem; }

@media (max-width: 760px) {
  .shell { width: min(100% - 1rem, 1120px); padding-top: 1rem; }
  .page-header,
  .section-heading,
  .summary-panel { flex-direction: column; align-items: stretch; }
  .actions { flex-direction: column; }
  .contract-grid,
  .dependency-grid { grid-template-columns: 1fr; }
  dl > div { grid-template-columns: 1fr; gap: 0.2rem; }
  button { width: 100%; }
}
`;

function commonHeaders(contentType: string): HeadersInit {
  return {
    "content-type": `${contentType}; charset=utf-8`,
    "cache-control": "no-store",
    "content-security-policy": contentSecurityPolicy,
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-resource-policy": "same-origin",
    "permissions-policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  };
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ ok: false, code: "health_diagnostics_method_not_allowed" }), {
    status: 405,
    headers: {
      ...commonHeaders("application/json"),
      allow: "GET",
    },
  });
}

export async function handleHealthDiagnosticsRequest(request: Request): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!diagnosticsPaths.has(pathname)) return null;
  if (request.method !== "GET") return methodNotAllowed();

  if (pathname === diagnosticsScriptPath) {
    return new Response(diagnosticsScript, { status: 200, headers: commonHeaders("text/javascript") });
  }
  if (pathname === diagnosticsStylePath) {
    return new Response(diagnosticsStyle, { status: 200, headers: commonHeaders("text/css") });
  }
  return new Response(diagnosticsHtml, { status: 200, headers: commonHeaders("text/html") });
}
