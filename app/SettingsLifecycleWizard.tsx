"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type SettingField = "demoMode" | "ipaUrl" | "ipaUsername" | "ipaPassword" | "xyopsUrl" | "xyopsApiKey";
type SourceFilter = "all" | "database" | "conflict";

type FieldSource = {
  value?: unknown;
  configured?: boolean;
  source: "database" | "environment" | "default";
  envName: string;
  envConfigured: boolean;
  overridden: boolean;
  resettable?: boolean;
  fallbackSource?: "environment" | "default";
};

type EffectiveSettings = {
  settings: {
    updatedAt?: number | null;
    demoMode: boolean;
    freeipa: { url: string; username: string; passwordConfigured: boolean };
    xyops: { url: string; apiKeyConfigured: boolean };
  };
  revision: number;
  overrideCount?: number;
  conflictCount?: number;
  fields: Record<SettingField, FieldSource>;
};

type Draft = {
  id: string;
  baseRevision: number;
  status: string;
  diff: Array<{ field: string; before: unknown; after: unknown; secret: boolean; reset?: boolean; source?: string }>;
  validation?: { ok?: boolean; services?: Array<{ service: string; ok: boolean; latencyMs?: number; error?: string }> };
};

type Revision = {
  id: string;
  revision: number;
  config: { demoMode: boolean; ipaUrl: string; ipaUsername: string; xyopsUrl: string };
  createdBy: string;
  reason: string;
  status: string;
  createdAt: number;
};

type FormState = {
  demoMode: boolean;
  ipaUrl: string;
  ipaUsername: string;
  ipaPassword: string;
  xyopsUrl: string;
  xyopsApiKey: string;
};

type ApiError = Error & { status?: number; payload?: { draft?: Draft; rolledBack?: boolean; code?: string } };

const emptyForm: FormState = { demoMode: false, ipaUrl: "", ipaUsername: "", ipaPassword: "", xyopsUrl: "", xyopsApiKey: "" };
const labels: Record<string, string> = {
  demoMode: "Демо-режим",
  ipaUrl: "FreeIPA URL",
  ipaUsername: "FreeIPA service account",
  ipaPassword: "Пароль FreeIPA",
  xyopsUrl: "XYOps URL",
  xyopsApiKey: "XYOps API key",
};

async function api(path: string, init?: RequestInit) {
  const response = await fetch(path, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data.error || `HTTP ${response.status}`)) as ApiError;
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function SourceBadge({ field }: { field?: FieldSource }) {
  if (!field) return null;
  const text = field.source === "database" ? "D1" : field.source === "environment" ? "ENV" : "DEFAULT";
  return <span className={`settings-source ${field.source}`} title={field.overridden ? `${field.envName} переопределён в D1` : field.envName}>{text}{field.overridden ? " · conflict" : ""}</span>;
}

function SourceControl({ name, field, selected, disabled, onToggle }: {
  name: SettingField;
  field: FieldSource;
  selected: boolean;
  disabled: boolean;
  onToggle: (field: SettingField) => void;
}) {
  return <div className="field-source-line">
    <SourceBadge field={field} />
    {field.resettable && <button
      type="button"
      className={`settings-reset ${selected ? "selected" : ""}`}
      disabled={disabled}
      onClick={() => onToggle(name)}
      title={`Удалить D1 override и использовать ${field.fallbackSource === "environment" ? field.envName : "DEFAULT"}`}
    >
      {selected ? "Сброс выбран" : `Вернуть ${field.fallbackSource === "environment" ? "ENV" : "DEFAULT"}`}
    </button>}
  </div>;
}

function formFromEffective(effective: EffectiveSettings): FormState {
  return {
    demoMode: effective.settings.demoMode === true,
    ipaUrl: effective.settings.freeipa.url || "",
    ipaUsername: effective.settings.freeipa.username || "",
    ipaPassword: "",
    xyopsUrl: effective.settings.xyops.url || "",
    xyopsApiKey: "",
  };
}

export default function SettingsLifecycleWizard() {
  const pathname = usePathname();
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [effective, setEffective] = useState<EffectiveSettings | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [resetFields, setResetFields] = useState<SettingField[]>([]);
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"load" | "draft" | "validate" | "apply" | "cancel" | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setBusy("load");
    setError("");
    try {
      const [active, history] = await Promise.all([
        api("/api/integrations/settings/effective") as Promise<EffectiveSettings>,
        api("/api/integrations/settings/revisions?limit=8") as Promise<{ revisions?: Revision[] }>,
      ]);
      setEffective(active);
      setRevisions(Array.isArray(history.revisions) ? history.revisions : []);
      setForm(formFromEffective(active));
      setResetFields([]);
      document.documentElement.dataset.settingsLifecycleWizard = "ready";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Настройки недоступны");
    } finally { setBusy(null); }
  }, []);

  useEffect(() => {
    if (pathname !== "/settings") return;
    let active = true;
    let observer: MutationObserver | null = null;
    const attach = () => {
      if (!active) return false;
      const existing = document.getElementById("settings-lifecycle-wizard-root");
      if (existing) { setMount(existing); observer?.disconnect(); return true; }
      const target = document.querySelector<HTMLElement>(".settings-page");
      if (!target) return false;
      const node = document.createElement("div");
      node.id = "settings-lifecycle-wizard-root";
      const sessionBridge = document.getElementById("local-admin-session-bridge");
      if (sessionBridge?.nextSibling) target.insertBefore(node, sessionBridge.nextSibling);
      else target.prepend(node);
      setMount(node);
      observer?.disconnect();
      return true;
    };
    const frame = window.requestAnimationFrame(() => {
      if (!active) return;
      if (!attach()) {
        observer = new MutationObserver(() => void attach());
        observer.observe(document.body, { childList: true, subtree: true });
      }
      void load();
    });
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      delete document.documentElement.dataset.settingsLifecycleWizard;
      document.getElementById("settings-lifecycle-wizard-root")?.remove();
    };
  }, [load, pathname]);

  const resetSet = useMemo(() => new Set(resetFields), [resetFields]);
  const changes = useMemo(() => {
    if (!effective) return {} as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    if (!resetSet.has("demoMode") && form.demoMode !== effective.settings.demoMode) next.demoMode = form.demoMode;
    if (!resetSet.has("ipaUrl") && form.ipaUrl.trim() !== effective.settings.freeipa.url) next.ipaUrl = form.ipaUrl.trim();
    if (!resetSet.has("ipaUsername") && form.ipaUsername.trim() !== effective.settings.freeipa.username) next.ipaUsername = form.ipaUsername.trim();
    if (!resetSet.has("ipaPassword") && form.ipaPassword) next.ipaPassword = form.ipaPassword;
    if (!resetSet.has("xyopsUrl") && form.xyopsUrl.trim() !== effective.settings.xyops.url) next.xyopsUrl = form.xyopsUrl.trim();
    if (!resetSet.has("xyopsApiKey") && form.xyopsApiKey) next.xyopsApiKey = form.xyopsApiKey;
    if (resetFields.length) next.resetFields = resetFields;
    return next;
  }, [effective, form, resetFields, resetSet]);
  const changeCount = useMemo(() => Object.keys(changes).filter((key) => key !== "resetFields").length + resetFields.length, [changes, resetFields.length]);

  function toggleReset(field: SettingField) {
    if (draft) return;
    setResetFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field]);
    setError(""); setMessage("");
  }

  function updateField<K extends keyof FormState>(field: K, value: FormState[K]) {
    setResetFields((current) => current.filter((item) => item !== field));
    setForm((current) => ({ ...current, [field]: value }));
  }

  function fieldVisible(name: SettingField): boolean {
    const field = effective?.fields[name];
    if (!field || filter === "all") return true;
    if (filter === "database") return field.source === "database";
    return field.overridden;
  }

  async function createDraft() {
    if (!effective || !changeCount) { setError("Изменений для черновика нет"); return; }
    setBusy("draft"); setError(""); setMessage("");
    try {
      const data = await api("/api/integrations/settings/drafts", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ baseRevision: effective.revision, changes }),
      }) as { draft: Draft };
      setDraft(data.draft);
      setMessage("Черновик создан. Проверьте diff и выполните серверную проверку.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось создать черновик"); }
    finally { setBusy(null); }
  }

  async function validateDraft() {
    if (!draft) return;
    setBusy("validate"); setError(""); setMessage("");
    try {
      const data = await api(`/api/integrations/settings/drafts/${encodeURIComponent(draft.id)}/validate`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      }) as { draft: Draft };
      setDraft(data.draft);
      setMessage("Черновик проверен. Можно применить конфигурацию.");
    } catch (cause) {
      const detail = cause as ApiError;
      if (detail.payload?.draft) setDraft(detail.payload.draft);
      setError(detail.message || "Проверка черновика не пройдена");
    } finally { setBusy(null); }
  }

  async function applyDraft() {
    if (!draft) return;
    setBusy("apply"); setError(""); setMessage("");
    try {
      const data = await api(`/api/integrations/settings/drafts/${encodeURIComponent(draft.id)}/apply`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      }) as { revision?: number; resetFields?: SettingField[] };
      const resetMessage = data.resetFields?.length ? ` · возвращено к ENV/default: ${data.resetFields.length}` : "";
      setMessage(`Конфигурация применена${data.revision ? ` · revision ${data.revision}` : ""}${resetMessage}.`);
      setDraft(null);
      await load();
    } catch (cause) {
      const detail = cause as ApiError;
      if (detail.payload?.draft) setDraft(detail.payload.draft);
      setError(detail.payload?.rolledBack ? `${detail.message}. Рабочая конфигурация восстановлена автоматически.` : detail.message);
      await load();
    } finally { setBusy(null); }
  }

  async function cancelDraft() {
    if (!draft) return;
    setBusy("cancel"); setError(""); setMessage("");
    try {
      await api(`/api/integrations/settings/drafts/${encodeURIComponent(draft.id)}/cancel`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      setDraft(null);
      if (effective) setForm(formFromEffective(effective));
      setResetFields([]);
      setMessage("Черновик отменён, сохранённые в нём секреты удалены.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Не удалось отменить черновик"); }
    finally { setBusy(null); }
  }

  if (!mount) return null;
  const disabled = Boolean(draft);
  return createPortal(
    <section className="panel settings-lifecycle" data-testid="settings-lifecycle-wizard">
      <div className="settings-lifecycle-head">
        <div><span className="eyebrow">SAFE CONFIGURATION</span><h2>Черновик → проверка → применение</h2><p>Активная конфигурация не изменяется до серверной проверки. D1 override можно безопасно удалить и вернуть поле к текущему ENV или DEFAULT.</p></div>
        <div className="settings-revision"><small>Активная revision</small><strong>{effective?.revision || "ENV"}</strong><button className="secondary" disabled={Boolean(busy)} onClick={() => void load()}>Обновить</button></div>
      </div>
      {error && <div className="settings-lifecycle-alert error"><strong>Ошибка</strong><span>{error}</span></div>}
      {message && <div className="settings-lifecycle-alert success"><strong>Готово</strong><span>{message}</span></div>}
      <div className="settings-lifecycle-steps">
        <span className={!draft ? "active" : "done"}><b>1</b>Черновик</span>
        <span className={draft?.status === "validated" ? "done" : draft ? "active" : ""}><b>2</b>Проверка</span>
        <span className={draft?.status === "validated" ? "active" : ""}><b>3</b>Применение</span>
      </div>
      {!effective ? <div className="catalog-empty"><strong>{busy === "load" ? "Загрузка настроек…" : "Настройки не загружены"}</strong></div> : <>
        <div className="settings-source-toolbar" data-testid="settings-source-filter">
          <div><strong>Источники значений</strong><small>D1 overrides: {effective.overrideCount ?? 0} · конфликтов с ENV: {effective.conflictCount ?? 0}</small></div>
          <div className="settings-source-filters">
            <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Все</button>
            <button type="button" className={filter === "database" ? "active" : ""} onClick={() => setFilter("database")}>D1 overrides</button>
            <button type="button" className={filter === "conflict" ? "active" : ""} onClick={() => setFilter("conflict")}>Конфликты</button>
          </div>
        </div>
        <div className="settings-lifecycle-grid">
          {fieldVisible("demoMode") && <section><div className="settings-lifecycle-title"><h3>Общие</h3><SourceControl name="demoMode" field={effective.fields.demoMode} selected={resetSet.has("demoMode")} disabled={disabled} onToggle={toggleReset} /></div><label className={`checkbox-field ${resetSet.has("demoMode") ? "reset-pending" : ""}`}><input type="checkbox" checked={form.demoMode} disabled={disabled || resetSet.has("demoMode")} onChange={(event) => updateField("demoMode", event.target.checked)} /><span><strong>Демо-режим</strong><small>{resetSet.has("demoMode") ? `После применения: ${effective.fields.demoMode.fallbackSource === "environment" ? "ENV" : "DEFAULT"}` : "Не выполнять реальные вызовы FreeIPA и XYOps"}</small></span></label></section>}
          {(["ipaUrl", "ipaUsername", "ipaPassword"] as SettingField[]).some(fieldVisible) && <section>
            <div className="settings-lifecycle-title"><h3>FreeIPA</h3></div>
            {fieldVisible("ipaUrl") && <label className={resetSet.has("ipaUrl") ? "reset-pending" : ""}>Адрес сервера<SourceControl name="ipaUrl" field={effective.fields.ipaUrl} selected={resetSet.has("ipaUrl")} disabled={disabled} onToggle={toggleReset} /><input value={form.ipaUrl} disabled={disabled || resetSet.has("ipaUrl")} onChange={(event) => updateField("ipaUrl", event.target.value)} /></label>}
            {fieldVisible("ipaUsername") && <label className={resetSet.has("ipaUsername") ? "reset-pending" : ""}>Service account<SourceControl name="ipaUsername" field={effective.fields.ipaUsername} selected={resetSet.has("ipaUsername")} disabled={disabled} onToggle={toggleReset} /><input value={form.ipaUsername} disabled={disabled || resetSet.has("ipaUsername")} onChange={(event) => updateField("ipaUsername", event.target.value)} /></label>}
            {fieldVisible("ipaPassword") && <label className={resetSet.has("ipaPassword") ? "reset-pending" : ""}>Новый пароль<SourceControl name="ipaPassword" field={effective.fields.ipaPassword} selected={resetSet.has("ipaPassword")} disabled={disabled} onToggle={toggleReset} /><input type="password" value={form.ipaPassword} disabled={disabled || resetSet.has("ipaPassword")} onChange={(event) => updateField("ipaPassword", event.target.value)} placeholder={effective.settings.freeipa.passwordConfigured ? "Сохранён — заполните только для замены" : "Не настроен"} autoComplete="new-password" /></label>}
          </section>}
          {(["xyopsUrl", "xyopsApiKey"] as SettingField[]).some(fieldVisible) && <section>
            <div className="settings-lifecycle-title"><h3>XYOps</h3></div>
            {fieldVisible("xyopsUrl") && <label className={resetSet.has("xyopsUrl") ? "reset-pending" : ""}>Адрес XYOps<SourceControl name="xyopsUrl" field={effective.fields.xyopsUrl} selected={resetSet.has("xyopsUrl")} disabled={disabled} onToggle={toggleReset} /><input value={form.xyopsUrl} disabled={disabled || resetSet.has("xyopsUrl")} onChange={(event) => updateField("xyopsUrl", event.target.value)} /></label>}
            {fieldVisible("xyopsApiKey") && <label className={resetSet.has("xyopsApiKey") ? "reset-pending" : ""}>Новый API key<SourceControl name="xyopsApiKey" field={effective.fields.xyopsApiKey} selected={resetSet.has("xyopsApiKey")} disabled={disabled} onToggle={toggleReset} /><input type="password" value={form.xyopsApiKey} disabled={disabled || resetSet.has("xyopsApiKey")} onChange={(event) => updateField("xyopsApiKey", event.target.value)} placeholder={effective.settings.xyops.apiKeyConfigured ? "Сохранён — заполните только для замены" : "Не настроен"} autoComplete="new-password" /></label>}
          </section>}
        </div>
        {draft ? <div className="settings-draft-review">
          <div><h3>Безопасный diff</h3><code>{draft.id}</code></div>
          <div className="settings-diff-list">{draft.diff.map((item) => <article key={item.field}><strong>{labels[item.field] || item.field}</strong><span>{String(item.before ?? "—")}</span><b>→</b><span>{item.reset ? `Вернуть ${String(item.source || "default").toUpperCase()}` : item.secret ? "значение скрыто" : String(item.after ?? "—")}</span></article>)}</div>
          {draft.validation?.services?.length ? <div className="settings-validation-list">{draft.validation.services.map((check) => <span className={check.ok ? "ok" : "fail"} key={check.service}>{check.service}: {check.ok ? `${check.latencyMs || 0} мс` : check.error}</span>)}</div> : null}
          <div className="settings-lifecycle-actions"><button className="secondary" disabled={Boolean(busy)} onClick={() => void cancelDraft()}>{busy === "cancel" ? "Отмена…" : "Отменить черновик"}</button>{draft.status !== "validated" ? <button className="primary" disabled={Boolean(busy)} onClick={() => void validateDraft()}>{busy === "validate" ? "Проверка…" : "Проверить конфигурацию"}</button> : <button className="primary" disabled={Boolean(busy)} onClick={() => void applyDraft()}>{busy === "apply" ? "Применение…" : "Применить проверенную revision"}</button>}</div>
        </div> : <div className="settings-lifecycle-actions"><span>{changeCount ? `Изменено параметров: ${changeCount}` : "Изменений нет"}</span><button className="primary" disabled={Boolean(busy) || !changeCount} onClick={() => void createDraft()}>{busy === "draft" ? "Создание…" : "Создать черновик"}</button></div>}
        <details className="settings-revisions"><summary>История применённых revision ({revisions.length})</summary><div>{revisions.map((revision) => <article key={revision.id}><span className={`revision-status ${revision.status}`} /> <div><strong>Revision {revision.revision}</strong><small>{new Date(revision.createdAt).toLocaleString("ru-RU")} · {revision.createdBy}</small></div><code>{revision.reason}</code></article>)}{!revisions.length && <p>История появится после первого применения через новый lifecycle.</p>}</div></details>
      </>}
    </section>, mount,
  );
}
