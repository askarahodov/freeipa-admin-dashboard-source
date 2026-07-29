"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type FieldSource = {
  value?: unknown;
  configured?: boolean;
  source: "database" | "environment" | "default";
  envName: string;
  envConfigured: boolean;
  overridden: boolean;
};

type EffectiveSettings = {
  settings: {
    updatedAt?: number | null;
    demoMode: boolean;
    freeipa: { url: string; username: string; passwordConfigured: boolean };
    xyops: { url: string; apiKeyConfigured: boolean };
  };
  revision: number;
  fields: Record<string, FieldSource>;
};

type Draft = {
  id: string;
  baseRevision: number;
  status: string;
  diff: Array<{ field: string; before: unknown; after: unknown; secret: boolean }>;
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
    const error = new Error(String(data.error || `HTTP ${response.status}`)) as Error & { status?: number; payload?: Record<string, unknown> };
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function SourceBadge({ field }: { field?: FieldSource }) {
  if (!field) return null;
  const text = field.source === "database" ? "D1" : field.source === "environment" ? "ENV" : "DEFAULT";
  return <span className={`settings-source ${field.source}`} title={field.overridden ? `${field.envName} переопределён в D1` : field.envName}>{text}{field.overridden ? " · override" : ""}</span>;
}

export default function SettingsLifecycleWizard() {
  const pathname = usePathname();
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [effective, setEffective] = useState<EffectiveSettings | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [form, setForm] = useState<FormState>({ demoMode: false, ipaUrl: "", ipaUsername: "", ipaPassword: "", xyopsUrl: "", xyopsApiKey: "" });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState<"load" | "draft" | "validate" | "apply" | null>(null);
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
      setForm({
        demoMode: active.settings.demoMode === true,
        ipaUrl: active.settings.freeipa.url || "",
        ipaUsername: active.settings.freeipa.username || "",
        ipaPassword: "",
        xyopsUrl: active.settings.xyops.url || "",
        xyopsApiKey: "",
      });
      document.documentElement.dataset.settingsLifecycleWizard = "ready";
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Настройки недоступны");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    if (pathname !== "/settings") return;
    let active = true;
    let observer: MutationObserver | null = null;

    const attach = () => {
      if (!active) return false;
      const existing = document.getElementById("settings-lifecycle-wizard-root");
      if (existing) {
        setMount(existing);
        observer?.disconnect();
        return true;
      }
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

  const changes = useMemo(() => {
    if (!effective) return {} as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    if (form.demoMode !== effective.settings.demoMode) next.demoMode = form.demoMode;
    if (form.ipaUrl.trim() !== effective.settings.freeipa.url) next.ipaUrl = form.ipaUrl.trim();
    if (form.ipaUsername.trim() !== effective.settings.freeipa.username) next.ipaUsername = form.ipaUsername.trim();
    if (form.ipaPassword) next.ipaPassword = form.ipaPassword;
    if (form.xyopsUrl.trim() !== effective.settings.xyops.url) next.xyopsUrl = form.xyopsUrl.trim();
    if (form.xyopsApiKey) next.xyopsApiKey = form.xyopsApiKey;
    return next;
  }, [effective, form]);

  async function createDraft() {
    if (!effective || !Object.keys(changes).length) { setError("Изменений для черновика нет"); return; }
    setBusy("draft"); setError(""); setMessage("");
    try {
      const data = await api("/api/integrations/settings/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseRevision: effective.revision, changes }),
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
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }) as { draft: Draft };
      setDraft(data.draft);
      setMessage("Черновик проверен. Можно применить конфигурацию.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Проверка черновика не пройдена"); }
    finally { setBusy(null); }
  }

  async function applyDraft() {
    if (!draft) return;
    setBusy("apply"); setError(""); setMessage("");
    try {
      const data = await api(`/api/integrations/settings/drafts/${encodeURIComponent(draft.id)}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }) as { revision?: number };
      setMessage(`Конфигурация применена${data.revision ? ` · revision ${data.revision}` : ""}.`);
      setDraft(null);
      await load();
    } catch (cause) {
      const detail = cause as Error & { payload?: { rolledBack?: boolean } };
      setError(detail.payload?.rolledBack ? `${detail.message}. Рабочая конфигурация восстановлена автоматически.` : detail.message);
      await load();
    } finally { setBusy(null); }
  }

  function resetDraft() {
    setDraft(null); setError(""); setMessage("");
    if (effective) setForm({ demoMode: effective.settings.demoMode, ipaUrl: effective.settings.freeipa.url, ipaUsername: effective.settings.freeipa.username, ipaPassword: "", xyopsUrl: effective.settings.xyops.url, xyopsApiKey: "" });
  }

  if (!mount) return null;
  return createPortal(
    <section className="panel settings-lifecycle" data-testid="settings-lifecycle-wizard">
      <div className="settings-lifecycle-head">
        <div><span className="eyebrow">SAFE CONFIGURATION</span><h2>Черновик → проверка → применение</h2><p>Активная конфигурация не изменяется до серверной проверки. При неуспешном post-apply health check портал автоматически возвращает рабочую версию.</p></div>
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
        <div className="settings-lifecycle-grid">
          <section><div className="settings-lifecycle-title"><h3>Общие</h3><SourceBadge field={effective.fields.demoMode} /></div><label className="checkbox-field"><input type="checkbox" checked={form.demoMode} disabled={Boolean(draft)} onChange={(event) => setForm({ ...form, demoMode: event.target.checked })} /><span><strong>Демо-режим</strong><small>Не выполнять реальные вызовы FreeIPA и XYOps</small></span></label></section>
          <section><div className="settings-lifecycle-title"><h3>FreeIPA</h3><SourceBadge field={effective.fields.ipaUrl} /></div><label>Адрес сервера<input value={form.ipaUrl} disabled={Boolean(draft)} onChange={(event) => setForm({ ...form, ipaUrl: event.target.value })} /></label><label>Service account<div className="field-source-line"><SourceBadge field={effective.fields.ipaUsername} /></div><input value={form.ipaUsername} disabled={Boolean(draft)} onChange={(event) => setForm({ ...form, ipaUsername: event.target.value })} /></label><label>Новый пароль<div className="field-source-line"><SourceBadge field={effective.fields.ipaPassword} /></div><input type="password" value={form.ipaPassword} disabled={Boolean(draft)} onChange={(event) => setForm({ ...form, ipaPassword: event.target.value })} placeholder={effective.settings.freeipa.passwordConfigured ? "Сохранён — заполните только для замены" : "Не настроен"} autoComplete="new-password" /></label></section>
          <section><div className="settings-lifecycle-title"><h3>XYOps</h3><SourceBadge field={effective.fields.xyopsUrl} /></div><label>Адрес XYOps<input value={form.xyopsUrl} disabled={Boolean(draft)} onChange={(event) => setForm({ ...form, xyopsUrl: event.target.value })} /></label><label>Новый API key<div className="field-source-line"><SourceBadge field={effective.fields.xyopsApiKey} /></div><input type="password" value={form.xyopsApiKey} disabled={Boolean(draft)} onChange={(event) => setForm({ ...form, xyopsApiKey: event.target.value })} placeholder={effective.settings.xyops.apiKeyConfigured ? "Сохранён — заполните только для замены" : "Не настроен"} autoComplete="new-password" /></label></section>
        </div>

        {draft ? <div className="settings-draft-review"><div><h3>Безопасный diff</h3><code>{draft.id}</code></div><div className="settings-diff-list">{draft.diff.map((item) => <article key={item.field}><strong>{labels[item.field] || item.field}</strong><span>{String(item.before ?? "—")}</span><b>→</b><span>{item.secret ? "значение скрыто" : String(item.after ?? "—")}</span></article>)}</div>{draft.validation?.services?.length ? <div className="settings-validation-list">{draft.validation.services.map((check) => <span className={check.ok ? "ok" : "fail"} key={check.service}>{check.service}: {check.ok ? `${check.latencyMs || 0} мс` : check.error}</span>)}</div> : null}<div className="settings-lifecycle-actions"><button className="secondary" disabled={Boolean(busy)} onClick={resetDraft}>Отменить черновик</button>{draft.status !== "validated" ? <button className="primary" disabled={Boolean(busy)} onClick={() => void validateDraft()}>{busy === "validate" ? "Проверка…" : "Проверить конфигурацию"}</button> : <button className="primary" disabled={Boolean(busy)} onClick={() => void applyDraft()}>{busy === "apply" ? "Применение…" : "Применить проверенную revision"}</button>}</div></div> : <div className="settings-lifecycle-actions"><span>{Object.keys(changes).length ? `Изменено параметров: ${Object.keys(changes).length}` : "Изменений нет"}</span><button className="primary" disabled={Boolean(busy) || !Object.keys(changes).length} onClick={() => void createDraft()}>{busy === "draft" ? "Создание…" : "Создать черновик"}</button></div>}

        <details className="settings-revisions"><summary>История применённых revision ({revisions.length})</summary><div>{revisions.map((revision) => <article key={revision.id}><span className={`revision-status ${revision.status}`} /> <div><strong>Revision {revision.revision}</strong><small>{new Date(revision.createdAt).toLocaleString("ru-RU")} · {revision.createdBy}</small></div><code>{revision.reason}</code></article>)}{!revisions.length && <p>История появится после первого применения через новый lifecycle.</p>}</div></details>
      </>}
    </section>,
    mount,
  );
}
