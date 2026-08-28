"use client";

import { useState } from "react";
import type { CatalogEvent } from "../src/automation/automation-types";
import { IconPlus, IconClose } from "./icons";

type PortalRole = "viewer" | "operator" | "admin";
type CatalogPolicyEffect = "allow" | "deny";
type ApprovalEffect = "require" | "none";

type CatalogVisibilityRule = {
  id: string;
  effect: CatalogPolicyEffect;
  users: string[];
  groups: string[];
  roles: PortalRole[];
  categories: string[];
  processes: string[];
};
type CatalogPolicySet = {
  version: 1;
  defaultEffect: CatalogPolicyEffect;
  adminBypass: boolean;
  rules: CatalogVisibilityRule[];
};

type ApprovalRequirement = {
  requiredApprovals: number;
  approverRoles: PortalRole[];
  approverGroups: string[];
  requesterCannotApprove: boolean;
  expiresMinutes: number;
  ruleId: string;
};
type ApprovalPolicyRule = ApprovalRequirement & {
  id: string;
  effect: ApprovalEffect;
  requesterUsers: string[];
  requesterRoles: PortalRole[];
  requesterGroups: string[];
  categories: string[];
  processes: string[];
  dangerous: boolean | null;
};
type ApprovalPolicySet = {
  version: 1;
  dangerousDefaults: ApprovalRequirement | null;
  rules: ApprovalPolicyRule[];
};

type LocalizedProcessPresentation = { title?: string; description?: string; category?: string; help?: string };
type ProcessPresentationOverride = LocalizedProcessPresentation & { icon?: string; order?: number; locales?: Record<string, LocalizedProcessPresentation> };
type ProcessPresentationSet = { version: 1; defaultLocale?: string; processes: Record<string, ProcessPresentationOverride> };

const ROLES: PortalRole[] = ["viewer", "operator", "admin"];
const roleLabel: Record<PortalRole, string> = { viewer: "Наблюдатель", operator: "Оператор", admin: "Администратор" };

function Pill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`status ${tone}`}>{children}</span>;
}

function TagInput({ label, value, onChange, placeholder }: { label: string; value: string[]; onChange: (next: string[]) => void; placeholder?: string }) {
  const [draft, setDraft] = useState("");
  function commit() {
    const parts = draft.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length) {
      const merged = [...value];
      for (const part of parts) if (!merged.includes(part)) merged.push(part);
      onChange(merged);
    }
    setDraft("");
  }
  return (
    <label className="policy-field">
      <span>{label}</span>
      <div className="tag-input">
        {value.map((tag, index) => (
          <span className="tag-chip" key={`${tag}-${index}`}>{tag}<button type="button" aria-label={`Удалить ${tag}`} onClick={() => onChange(value.filter((_, j) => j !== index))}><IconClose size={12} /></button></span>
        ))}
        <input
          value={draft}
          placeholder={placeholder}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); commit(); } }}
          onBlur={commit}
        />
      </div>
    </label>
  );
}

function RoleChips({ label, value, onChange }: { label: string; value: PortalRole[]; onChange: (next: PortalRole[]) => void }) {
  return (
    <label className="policy-field">
      <span>{label}</span>
      <div className="role-chips">
        {ROLES.map((role) => (
          <button type="button" key={role} className={value.includes(role) ? "active" : ""} onClick={() => onChange(value.includes(role) ? value.filter((r) => r !== role) : [...value, role])}>{roleLabel[role]}</button>
        ))}
      </div>
    </label>
  );
}

function ToneChips({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (next: string) => void }) {
  return (
    <label className="policy-field">
      <span>{label}</span>
      <div className="tone-chips">
        {options.map((option) => (
          <button type="button" key={option.value} className={value === option.value ? "active" : ""} onClick={() => onChange(option.value)}>{option.label}</button>
        ))}
      </div>
    </label>
  );
}

function newCatalogRule(): CatalogVisibilityRule {
  return { id: `rule-${Date.now().toString(36)}`, effect: "deny", users: [], groups: [], roles: [], categories: [], processes: [] };
}
function newApprovalRule(): ApprovalPolicyRule {
  return {
    id: `rule-${Date.now().toString(36)}`, effect: "require", requiredApprovals: 1, approverRoles: ["admin"], approverGroups: [], requesterCannotApprove: true,
    expiresMinutes: 60, ruleId: `rule-${Date.now().toString(36)}`, requesterUsers: [], requesterRoles: [], requesterGroups: [], categories: [], processes: [], dangerous: null,
  };
}

const exampleCatalogPolicy: CatalogPolicySet = {
  version: 1, defaultEffect: "allow", adminBypass: true,
  rules: [
    { id: "hide-production", effect: "deny", users: [], groups: ["interns"], roles: [], categories: ["Production"], processes: [] },
    { id: "allow-dba-backups", effect: "allow", users: [], groups: ["dba"], roles: [], categories: [], processes: ["database-backup"] },
  ],
};

const exampleApprovalPolicy: ApprovalPolicySet = {
  version: 1,
  dangerousDefaults: { requiredApprovals: 1, approverRoles: ["admin"], approverGroups: [], requesterCannotApprove: true, expiresMinutes: 60, ruleId: "dangerous-default" },
  rules: [{ id: "production-two-person", effect: "require", requesterUsers: [], requesterRoles: [], requesterGroups: [], categories: ["Production"], processes: [], dangerous: null, requiredApprovals: 2, approverRoles: ["admin"], approverGroups: ["ops-leads"], requesterCannotApprove: true, expiresMinutes: 30 }],
};

const exampleProcessPresentation: ProcessPresentationSet = {
  version: 1, defaultLocale: "ru",
  processes: {
    "user-create": { title: "Создать пользователя", description: "Провизия учётной записи FreeIPA", category: "Пользователи", help: "Требует approval при dangerous=true", icon: "♙", order: 1, locales: { en: { title: "Create user", description: "FreeIPA account provisioning", category: "Users" } } },
  },
};

/* ----------------------------- Catalog visibility ----------------------------- */

function CatalogPolicyEditor({ notify }: { notify: (message: string) => void }) {
  const [adminToken, setAdminToken] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("xyops-admin-token") ?? "");
  const [policy, setPolicy] = useState<CatalogPolicySet>(exampleCatalogPolicy);
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
      setPolicy(data.policy); setSource(data.source ?? "default"); setUpdatedAt(data.updatedAt ?? null);
    } catch (error) { notify(error instanceof Error ? error.message : "Ошибка загрузки политик"); }
    finally { setBusy(null); }
  }

  async function savePolicies() {
    setBusy("save");
    try {
      const response = await fetch("/api/integrations/catalog/policies", { method: "PUT", headers: { "content-type": "application/json", "x-admin-token": adminToken }, body: JSON.stringify({ policy }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось сохранить политики");
      window.sessionStorage.setItem("xyops-admin-token", adminToken);
      setPolicy(data.policy); setSource("database"); setUpdatedAt(data.updatedAt ?? Date.now());
      notify("Политики каталога сохранены");
    } catch (error) { notify(error instanceof Error ? error.message : "Некорректные политики каталога"); }
    finally { setBusy(null); }
  }

  return (
    <section className="panel policy-editor">
      <div className="panel-title">
        <div>
          <span className="eyebrow">CATALOG ACCESS</span>
          <h2>Видимость категорий и процессов</h2>
          <p>Правила применяются сервером к каталогу, dynamic options, запуску и safe re-run. Deny имеет приоритет над allow.</p>
        </div>
        {source && <Pill tone={source === "database" ? "success" : "neutral"}>{source === "database" ? "D1" : source === "environment" ? "ENV" : "По умолчанию"}</Pill>}
      </div>
      <div className="policy-toolbar">
        <label>ADMIN_TOKEN<input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Токен администратора" autoComplete="off" /></label>
        <button className="secondary" disabled={!adminToken || Boolean(busy)} onClick={() => void loadPolicies()}>{busy === "load" ? "Загрузка…" : "Загрузить"}</button>
        <button className="primary" disabled={!adminToken || Boolean(busy)} onClick={() => void savePolicies()}>{busy === "save" ? "Сохранение…" : "Сохранить политики"}</button>
      </div>
      <div className="policy-form">
        <label className="policy-field">
          <span>Поведение по умолчанию</span>
          <select value={policy.defaultEffect} onChange={(event) => setPolicy({ ...policy, defaultEffect: event.target.value as CatalogPolicyEffect })}>
            <option value="allow">Разрешать всё (allow)</option>
            <option value="deny">Скрывать всё (deny)</option>
          </select>
        </label>
        <label className="policy-field policy-field-inline">
          <span>Обход для администратора (adminBypass)</span>
          <input type="checkbox" checked={policy.adminBypass} onChange={(event) => setPolicy({ ...policy, adminBypass: event.target.checked })} />
        </label>
      </div>
      <div className="rule-list">
        {policy.rules.map((rule, index) => (
          <article className="rule-card" key={rule.id || index}>
            <div className="rule-card-head">
              <input className="rule-id" value={rule.id} onChange={(event) => { const next = [...policy.rules]; next[index] = { ...rule, id: event.target.value }; setPolicy({ ...policy, rules: next }); }} placeholder="Идентификатор правила" />
              <select value={rule.effect} onChange={(event) => { const next = [...policy.rules]; next[index] = { ...rule, effect: event.target.value as CatalogPolicyEffect }; setPolicy({ ...policy, rules: next }); }}>
                <option value="deny">Запретить (deny)</option>
                <option value="allow">Разрешить (allow)</option>
              </select>
            </div>
            <div className="rule-grid">
              <RoleChips label="Роли" value={rule.roles} onChange={(roles) => { const next = [...policy.rules]; next[index] = { ...rule, roles }; setPolicy({ ...policy, rules: next }); }} />
              <TagInput label="Пользователи" value={rule.users} onChange={(users) => { const next = [...policy.rules]; next[index] = { ...rule, users }; setPolicy({ ...policy, rules: next }); }} placeholder="login, еще login" />
              <TagInput label="Группы" value={rule.groups} onChange={(groups) => { const next = [...policy.rules]; next[index] = { ...rule, groups }; setPolicy({ ...policy, rules: next }); }} placeholder="dba, interns" />
              <TagInput label="Категории" value={rule.categories} onChange={(categories) => { const next = [...policy.rules]; next[index] = { ...rule, categories }; setPolicy({ ...policy, rules: next }); }} placeholder="Production" />
              <TagInput label="Процессы" value={rule.processes} onChange={(processes) => { const next = [...policy.rules]; next[index] = { ...rule, processes }; setPolicy({ ...policy, rules: next }); }} placeholder="database-backup" />
            </div>
            <div className="rule-card-actions">
              <button type="button" className="link-danger" onClick={() => setPolicy({ ...policy, rules: policy.rules.filter((_, j) => j !== index) })}>Удалить правило</button>
            </div>
          </article>
        ))}
      </div>
       <div className="policy-add"><button type="button" onClick={() => setPolicy({ ...policy, rules: [...policy.rules, newCatalogRule()] })}><IconPlus size={14} /> Добавить правило</button></div>
      <div className="policy-help">
        <span>Правил: <b>{policy.rules.length}</b></span>
        <span>Субъекты: <code>users</code>, <code>groups</code>, <code>roles</code></span>
        <span>Ресурсы: <code>categories</code>, <code>processes</code></span>
        {updatedAt ? <span>Сохранено: {new Date(updatedAt).toLocaleString("ru-RU")}</span> : <span>defaultEffect: allow сохраняет текущую доступность</span>}
      </div>
    </section>
  );
}

/* ----------------------------- Approval gates ----------------------------- */

function ApprovalRequirementForm({ value, onChange, allowDangerous }: { value: ApprovalRequirement; onChange: (next: ApprovalRequirement) => void; allowDangerous?: boolean }) {
  return (
    <div className="rule-grid">
      <label className="policy-field"><span>Требуется одобрений</span><input type="number" min={1} max={10} value={value.requiredApprovals} onChange={(event) => onChange({ ...value, requiredApprovals: Math.max(1, Number(event.target.value) || 1) })} /></label>
      <label className="policy-field"><span>Срок (минут)</span><input type="number" min={1} max={10080} value={value.expiresMinutes} onChange={(event) => onChange({ ...value, expiresMinutes: Math.max(1, Number(event.target.value) || 1) })} /></label>
      <RoleChips label="Роли согласующих" value={value.approverRoles} onChange={(approverRoles) => onChange({ ...value, approverRoles })} />
      <TagInput label="Группы согласующих" value={value.approverGroups} onChange={(approverGroups) => onChange({ ...value, approverGroups })} placeholder="ops-leads" />
      <label className="policy-field"><span>Идентификатор правила</span><input type="text" value={value.ruleId} onChange={(event) => onChange({ ...value, ruleId: event.target.value })} /></label>
      <label className="policy-field policy-field-inline"><span>Инициатор не может одобрить свою заявку</span><input type="checkbox" checked={value.requesterCannotApprove} onChange={(event) => onChange({ ...value, requesterCannotApprove: event.target.checked })} /></label>
      {allowDangerous && (
        <ToneChips label="Опасность процесса" value={value.dangerous === null ? "any" : value.dangerous ? "dangerous" : "safe"} options={[{ value: "any", label: "Любой" }, { value: "dangerous", label: "Опасный" }, { value: "safe", label: "Не опасный" }]} onChange={(next) => onChange({ ...value, dangerous: next === "any" ? null : next === "dangerous" })} />
      )}
    </div>
  );
}

function ApprovalPolicyEditor({ notify }: { notify: (message: string) => void }) {
  const [adminToken, setAdminToken] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("xyops-admin-token") ?? "");
  const [policy, setPolicy] = useState<ApprovalPolicySet>(exampleApprovalPolicy);
  const [source, setSource] = useState<"database" | "environment" | "default" | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | null>(null);

  async function request(method: "GET" | "PUT") {
    setBusy(method === "GET" ? "load" : "save");
    try {
      const body = method === "PUT" ? JSON.stringify({ policy }) : undefined;
      const response = await fetch("/api/integrations/approval/policies", { method, headers: { "content-type": "application/json", "x-admin-token": adminToken }, body, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось обработать approval policy");
      window.sessionStorage.setItem("xyops-admin-token", adminToken);
      setPolicy(data.policy); setSource(data.source ?? "database");
      notify(method === "GET" ? "Approval policy загружена" : "Approval policy сохранена");
    } catch (error) { notify(error instanceof Error ? error.message : "Некорректная approval policy"); }
    finally { setBusy(null); }
  }

  return (
    <section className="panel policy-editor">
      <div className="panel-title">
        <div>
          <span className="eyebrow">APPROVAL GATES</span>
          <h2>Согласование опасных процессов</h2>
          <p>Последнее подходящее правило определяет требование. По умолчанию dangerous-процесс требует одного независимого администратора.</p>
        </div>
        {source && <Pill tone={source === "database" ? "success" : "neutral"}>{source === "database" ? "D1" : source === "environment" ? "ENV" : "По умолчанию"}</Pill>}
      </div>
      <div className="policy-toolbar">
        <label>ADMIN_TOKEN<input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Токен администратора" autoComplete="off" /></label>
        <button className="secondary" disabled={!adminToken || Boolean(busy)} onClick={() => void request("GET")}>{busy === "load" ? "Загрузка…" : "Загрузить"}</button>
        <button className="primary" disabled={!adminToken || Boolean(busy)} onClick={() => void request("PUT")}>{busy === "save" ? "Сохранение…" : "Сохранить approval policy"}</button>
      </div>
      <div className="rule-list">
        <article className="rule-card">
          <div className="rule-card-head"><strong>Поведение по умолчанию для опасных процессов</strong></div>
          {policy.dangerousDefaults ? (
            <ApprovalRequirementForm value={policy.dangerousDefaults} onChange={(dangerousDefaults) => setPolicy({ ...policy, dangerousDefaults })} />
          ) : (
            <button type="button" className="policy-add" style={{ margin: 0 }} onClick={() => setPolicy({ ...policy, dangerousDefaults: { requiredApprovals: 1, approverRoles: ["admin"], approverGroups: [], requesterCannotApprove: true, expiresMinutes: 60, ruleId: "dangerous-default" } })}>＋ Включить согласование по умолчанию</button>
          )}
        </article>
        {policy.rules.map((rule, index) => (
          <article className="rule-card" key={rule.id || index}>
            <div className="rule-card-head">
              <input className="rule-id" value={rule.id} onChange={(event) => { const next = [...policy.rules]; next[index] = { ...rule, id: event.target.value }; setPolicy({ ...policy, rules: next }); }} placeholder="Идентификатор правила" />
              <select value={rule.effect} onChange={(event) => { const next = [...policy.rules]; next[index] = { ...rule, effect: event.target.value as ApprovalEffect }; setPolicy({ ...policy, rules: next }); }}>
                <option value="require">Требовать (require)</option>
                <option value="none">Не требовать (none)</option>
              </select>
            </div>
            <ApprovalRequirementForm
              value={rule}
              allowDangerous
              onChange={(patch) => { const next = [...policy.rules]; next[index] = { ...rule, ...patch }; setPolicy({ ...policy, rules: next }); }}
            />
            <div className="rule-grid">
              <TagInput label="Инициаторы (пользователи)" value={rule.requesterUsers} onChange={(requesterUsers) => { const next = [...policy.rules]; next[index] = { ...rule, requesterUsers }; setPolicy({ ...policy, rules: next }); }} placeholder="ivanov" />
              <RoleChips label="Роли инициаторов" value={rule.requesterRoles} onChange={(requesterRoles) => { const next = [...policy.rules]; next[index] = { ...rule, requesterRoles }; setPolicy({ ...policy, rules: next }); }} />
              <TagInput label="Группы инициаторов" value={rule.requesterGroups} onChange={(requesterGroups) => { const next = [...policy.rules]; next[index] = { ...rule, requesterGroups }; setPolicy({ ...policy, rules: next }); }} placeholder="dba" />
              <TagInput label="Категории" value={rule.categories} onChange={(categories) => { const next = [...policy.rules]; next[index] = { ...rule, categories }; setPolicy({ ...policy, rules: next }); }} placeholder="Production" />
              <TagInput label="Процессы" value={rule.processes} onChange={(processes) => { const next = [...policy.rules]; next[index] = { ...rule, processes }; setPolicy({ ...policy, rules: next }); }} placeholder="database-backup" />
            </div>
            <div className="rule-card-actions">
              <button type="button" className="link-danger" onClick={() => setPolicy({ ...policy, rules: policy.rules.filter((_, j) => j !== index) })}>Удалить правило</button>
            </div>
          </article>
        ))}
      </div>
      <div className="policy-add"><button type="button" onClick={() => setPolicy({ ...policy, rules: [...policy.rules, newApprovalRule()] })}>＋ Добавить правило</button></div>
      <div className="policy-help">
        <span><code>effect: require</code> или <code>none</code></span>
        <span>Согласующие: roles / groups</span>
        <span>Инициатор не может одобрить свою заявку по умолчанию</span>
      </div>
    </section>
  );
}

/* ----------------------------- Process presentation ----------------------------- */

function LocalizedFields({ value, onChange, compact }: { value: LocalizedProcessPresentation; onChange: (next: LocalizedProcessPresentation) => void; compact?: boolean }) {
  return (
    <div className="rule-grid">
      <label className="policy-field"><span>Заголовок{compact ? " (локаль)" : ""}</span><input type="text" value={value.title ?? ""} onChange={(event) => onChange({ ...value, title: event.target.value || undefined })} placeholder="Создать пользователя" /></label>
      <label className="policy-field"><span>Категория{compact ? " (локаль)" : ""}</span><input type="text" value={value.category ?? ""} onChange={(event) => onChange({ ...value, category: event.target.value || undefined })} placeholder="Пользователи" /></label>
      <label className="policy-field" style={{ gridColumn: "1 / -1" }}><span>Описание{compact ? " (локаль)" : ""}</span><input type="text" value={value.description ?? ""} onChange={(event) => onChange({ ...value, description: event.target.value || undefined })} placeholder="Провизия учётной записи FreeIPA" /></label>
      <label className="policy-field" style={{ gridColumn: "1 / -1" }}><span>Подсказка (help){compact ? " (локаль)" : ""}</span><input type="text" value={value.help ?? ""} onChange={(event) => onChange({ ...value, help: event.target.value || undefined })} placeholder="Требует approval при dangerous=true" /></label>
    </div>
  );
}

function ProcessPresentationEditor({ catalog, onChanged, notify }: { catalog: CatalogEvent[]; onChanged: () => void; notify: (message: string) => void }) {
  const [adminToken, setAdminToken] = useState(() => typeof window === "undefined" ? "" : window.sessionStorage.getItem("xyops-admin-token") ?? "");
  const [set, setSet] = useState<ProcessPresentationSet>(exampleProcessPresentation);
  const [source, setSource] = useState<"database" | "environment" | "default" | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [availableLocales, setAvailableLocales] = useState<string[]>([]);
  const [busy, setBusy] = useState<"load" | "save" | null>(null);

  const processKeys = Object.keys(set.processes);
  const unusedCatalog = catalog.filter((event) => !processKeys.includes(event.id));

  async function request(method: "GET" | "PUT") {
    setBusy(method === "GET" ? "load" : "save");
    try {
      const body = method === "PUT" ? JSON.stringify({ metadata: set }) : undefined;
      const response = await fetch("/api/integrations/catalog/presentation", { method, headers: { "content-type": "application/json", "x-admin-token": adminToken }, body, cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Не удалось обработать презентационные метаданные");
      window.sessionStorage.setItem("xyops-admin-token", adminToken);
      setSet(data.metadata); setSource(data.source ?? "default"); setUpdatedAt(data.updatedAt ?? null); setAvailableLocales(Array.isArray(data.availableLocales) ? data.availableLocales : []);
      if (method === "PUT") { onChanged(); notify("Презентационные метаданные сохранены"); }
      else notify("Презентационные метаданные загружены");
    } catch (error) { notify(error instanceof Error ? error.message : "Некорректные метаданные процессов"); }
    finally { setBusy(null); }
  }

  function updateProcess(key: string, patch: ProcessPresentationOverride) {
    setSet({ ...set, processes: { ...set.processes, [key]: { ...set.processes[key], ...patch } } });
  }
  function removeProcess(key: string) {
    const next = { ...set.processes }; delete next[key]; setSet({ ...set, processes: next });
  }
  function updateLocale(key: string, locale: string, patch: LocalizedProcessPresentation) {
    const current = set.processes[key]?.locales ?? {};
    setSet({ ...set, processes: { ...set.processes, [key]: { ...set.processes[key], locales: { ...current, [locale]: { ...current[locale], ...patch } } } } });
  }
  function removeLocale(key: string, locale: string) {
    const current = { ...(set.processes[key]?.locales ?? {}) }; delete current[locale];
    setSet({ ...set, processes: { ...set.processes, [key]: { ...set.processes[key], locales: current } } });
  }

  return (
    <section className="panel policy-editor">
      <div className="panel-title">
        <div>
          <span className="eyebrow">PROCESS PRESENTATION</span>
          <h2>Многоязычное представление процессов</h2>
          <p>Браузер выбирает локализованные title, description, category и help через Accept-Language. Process ID, schemaVersion, visibility, approval, targets и выполнение остаются под контролем XYOps.</p>
        </div>
        {source && <Pill tone={source === "database" ? "success" : "neutral"}>{source === "database" ? "D1" : source === "environment" ? "ENV" : "XYOps"}</Pill>}
      </div>
      <div className="policy-toolbar">
        <label>ADMIN_TOKEN<input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder="Токен администратора" autoComplete="off" /></label>
        <button className="secondary" disabled={!adminToken || Boolean(busy)} onClick={() => void request("GET")}>{busy === "load" ? "Загрузка…" : "Загрузить"}</button>
        <button className="primary" disabled={!adminToken || Boolean(busy)} onClick={() => void request("PUT")}>{busy === "save" ? "Сохранение…" : "Сохранить представление"}</button>
      </div>
      <div className="policy-form">
        <label className="policy-field"><span>Язык по умолчанию (defaultLocale)</span><input type="text" value={set.defaultLocale ?? ""} onChange={(event) => setSet({ ...set, defaultLocale: event.target.value || undefined })} placeholder="ru" /></label>
        <div className="policy-field"><span>Процессов в каталоге: <b>{catalog.length}</b></span><span style={{ color: "var(--muted)", fontWeight: 400 }}>Языки: <b>{availableLocales.length ? availableLocales.join(", ") : "не заданы"}</b></span></div>
      </div>
      <div className="rule-list">
        {processKeys.length === 0 && <div className="presentation-empty">Переопределений процессов пока нет. Добавьте процесс из каталога ниже.</div>}
        {processKeys.map((key) => {
          const override = set.processes[key];
          const event = catalog.find((e) => e.id === key);
          const locales = override.locales ?? {};
          return (
            <article className="process-override" key={key}>
              <div className="process-override-head">
                <input className="process-key" value={key} readOnly />
                <span style={{ color: "var(--muted)", fontSize: 12 }}>{event ? event.title : "нет в каталоге"}</span>
                <button type="button" className="link-danger" onClick={() => removeProcess(key)}>Удалить</button>
              </div>
              <div className="rule-grid">
                <label className="policy-field"><span>Иконка</span><input type="text" value={override.icon ?? ""} onChange={(event) => updateProcess(key, { icon: event.target.value || undefined })} placeholder="♙" /></label>
                <label className="policy-field"><span>Порядок (order)</span><input type="number" value={override.order ?? ""} onChange={(event) => updateProcess(key, { order: event.target.value ? Number(event.target.value) : undefined })} placeholder="1" /></label>
              </div>
              <LocalizedFields value={override} onChange={(patch) => updateProcess(key, patch)} />
              <div className="locale-block">
                <div className="locale-block-head"><strong>Локализации</strong>{unusedCatalog.length === 0 && <span style={{ color: "var(--muted)", fontSize: 12 }}>нет доступных из каталога</span>}</div>
                {Object.keys(locales).map((locale) => (
                  <div className="locale-block" key={locale}>
                    <div className="locale-block-head">
                      <input className="locale-code" value={locale} readOnly />
                      <button type="button" className="link-danger" onClick={() => removeLocale(key, locale)}>Удалить</button>
                    </div>
                    <LocalizedFields compact value={locales[locale]} onChange={(patch) => updateLocale(key, locale, patch)} />
                  </div>
                ))}
                {unusedCatalog.length > 0 && (
                  <select value="" onChange={(event) => { const locale = event.target.value; if (locale) updateLocale(key, locale, {}); event.target.value = ""; }}>
                    <option value="">＋ Добавить локаль…</option>
                    {["ru", "en", "de", "fr", "es", "zh", "ja"].map((code) => <option key={code} value={code} disabled={Boolean(locales[code])}>{code}{locales[code] ? " (есть)" : ""}</option>)}
                  </select>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {unusedCatalog.length > 0 && (
        <div className="policy-add">
          <select value="" onChange={(event) => { const key = event.target.value; if (key) setSet({ ...set, processes: { ...set.processes, [key]: { title: catalog.find((e) => e.id === key)?.title } } }); event.target.value = ""; }}>
            <option value="">＋ Добавить процесс из каталога…</option>
            {unusedCatalog.map((event) => <option key={event.id} value={event.id}>{event.title} · {event.id}</option>)}
          </select>
        </div>
      )}
      <div className="policy-help">
        <span>Поля: defaultLocale / locales / title / description / category / help / icon / order</span>
        <span>{updatedAt ? `Сохранено: ${new Date(updatedAt).toLocaleString("ru-RU")}` : "D1 имеет приоритет над PORTAL_PROCESS_METADATA_JSON"}</span>
      </div>
    </section>
  );
}

export { CatalogPolicyEditor, ApprovalPolicyEditor, ProcessPresentationEditor };
