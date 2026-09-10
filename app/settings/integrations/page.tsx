"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SettingsRouteShell } from "../SettingsRouteShell";
import {
  applySettingsDraft,
  cancelSettingsDraft,
  createSettingsDraft,
  loadAdminEffectiveSettings,
  validateSettingsDraft,
  type EffectiveSettings,
  type SessionState,
  type SettingsApiError,
  type SettingsDraft,
} from "../settings-lifecycle-client";
import styles from "../settings-route-shell.module.css";

type IntegrationsForm = {
  ipaUrl: string;
  ipaUsername: string;
  ipaPassword: string;
  xyopsUrl: string;
  xyopsApiKey: string;
};

const emptyForm: IntegrationsForm = {
  ipaUrl: "",
  ipaUsername: "",
  ipaPassword: "",
  xyopsUrl: "",
  xyopsApiKey: "",
};

function formFromEffective(effective: EffectiveSettings): IntegrationsForm {
  return {
    ipaUrl: effective.settings.freeipa.url || "",
    ipaUsername: effective.settings.freeipa.username || "",
    ipaPassword: "",
    xyopsUrl: effective.settings.xyops.url || "",
    xyopsApiKey: "",
  };
}

export default function IntegrationsSettingsPage() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [effective, setEffective] = useState<EffectiveSettings | null>(null);
  const [form, setForm] = useState<IntegrationsForm>(emptyForm);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [busy, setBusy] = useState<"load" | "draft" | "validate" | "apply" | "cancel" | null>("load");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setBusy("load");
    setError("");
    try {
      const loaded = await loadAdminEffectiveSettings();
      setSession(loaded.session);
      setEffective(loaded.effective);
      if (loaded.effective) {
        setForm(formFromEffective(loaded.effective));
        setDraft(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Настройки интеграций недоступны");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const changes = useMemo(() => {
    if (!effective) return {} as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    if (form.ipaUrl.trim() !== effective.settings.freeipa.url) next.ipaUrl = form.ipaUrl.trim();
    if (form.ipaUsername.trim() !== effective.settings.freeipa.username) next.ipaUsername = form.ipaUsername.trim();
    if (form.ipaPassword) next.ipaPassword = form.ipaPassword;
    if (form.xyopsUrl.trim() !== effective.settings.xyops.url) next.xyopsUrl = form.xyopsUrl.trim();
    if (form.xyopsApiKey) next.xyopsApiKey = form.xyopsApiKey;
    return next;
  }, [effective, form]);

  const dirty = Object.keys(changes).length > 0;

  useEffect(() => {
    if (!dirty || draft) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty, draft]);

  function updateField<K extends keyof IntegrationsForm>(field: K, value: IntegrationsForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setError("");
    setMessage("");
  }

  async function createDraft() {
    if (!effective || !dirty) return;
    setBusy("draft"); setError(""); setMessage("");
    try {
      setDraft(await createSettingsDraft(effective.revision, changes));
      setMessage("Черновик интеграций создан. Проверьте изменения и выполните серверную проверку.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать черновик");
    } finally { setBusy(null); }
  }

  async function validateDraft() {
    if (!draft) return;
    setBusy("validate"); setError(""); setMessage("");
    try {
      setDraft(await validateSettingsDraft(draft.id));
      setMessage("Серверная проверка завершена. Результаты подключений приведены ниже.");
    } catch (cause) {
      const detail = cause as SettingsApiError;
      if (detail.payload?.draft) setDraft(detail.payload.draft);
      setError(detail.message || "Проверка интеграций не пройдена");
    } finally { setBusy(null); }
  }

  async function applyDraft() {
    if (!draft || draft.status !== "validated") return;
    setBusy("apply"); setError(""); setMessage("");
    try {
      await applySettingsDraft(draft.id);
      await load();
      setMessage("Настройки интеграций применены.");
    } catch (cause) {
      const detail = cause as SettingsApiError;
      if (detail.payload?.draft) setDraft(detail.payload.draft);
      setError(detail.payload?.rolledBack ? `${detail.message}. Рабочая конфигурация восстановлена автоматически.` : detail.message);
    } finally { setBusy(null); }
  }

  async function cancelDraft() {
    if (!draft) return;
    setBusy("cancel"); setError(""); setMessage("");
    try {
      await cancelSettingsDraft(draft.id);
      setDraft(null);
      if (effective) setForm(formFromEffective(effective));
      setMessage("Черновик отменён; введённые секреты очищены.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отменить черновик");
    } finally { setBusy(null); }
  }

  const authenticated = session?.authenticated === true;
  const admin = authenticated && session?.user?.role === "admin";
  const validationServices = draft?.validation?.services ?? [];

  return (
    <SettingsRouteShell
      title="Интеграции"
      description="Подключения FreeIPA и XYOрs. Секреты не возвращаются из API и не сохраняются в браузере."
      hasUnsavedChanges={dirty && !draft}
    >
      {busy === "load" && !session && <div className={styles.notice}>Проверяем доступ и текущую конфигурацию…</div>}
      {error && <div className={styles.error} role="alert"><strong>Ошибка</strong><br />{error}</div>}
      {session && !authenticated && <div className={styles.card}><h2>Требуется вход</h2><p>Интеграционные настройки доступны только после аутентификации.</p><Link href="/login?returnTo=%2Fsettings%2Fintegrations">Войти</Link></div>}
      {session && authenticated && !admin && <div className={styles.card}><h2>Недостаточно прав</h2><p>Этот раздел требует административной роли и серверного permission <code>settings.manage</code>.</p><Link href="/">Вернуться к обзору</Link></div>}

      {admin && effective && <>
        <div className={styles.card}>
          <div className={styles.sectionHead}>
            <div><h2>FreeIPA</h2><p>URL и service account можно редактировать. Пароль вводится только при замене существующего секрета.</p></div>
            <span className={styles.sourceBadge}>{effective.fields.ipaUrl?.source ?? "default"}</span>
          </div>
          <div className={styles.formGrid}>
            <label>Адрес сервера<input value={form.ipaUrl} disabled={Boolean(draft)} onChange={(event) => updateField("ipaUrl", event.target.value)} placeholder="https://ipa.company.local" /></label>
            <label>Service account<input value={form.ipaUsername} disabled={Boolean(draft)} onChange={(event) => updateField("ipaUsername", event.target.value)} placeholder="portal-freeipa-manager" /></label>
            <label className={styles.fullWidth}>Пароль<input type="password" value={form.ipaPassword} disabled={Boolean(draft)} onChange={(event) => updateField("ipaPassword", event.target.value)} placeholder={effective.settings.freeipa.passwordConfigured ? "Сохранён — оставьте пустым без изменений" : "Введите пароль"} autoComplete="new-password" /></label>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.sectionHead}>
            <div><h2>XYOps</h2><p>Portal хранит только настройки подключения; выполнение процессов остаётся под контролем XYOрs.</p></div>
            <span className={styles.sourceBadge}>{effective.fields.xyopsUrl?.source ?? "default"}</span>
          </div>
          <div className={styles.formGrid}>
            <label>Адрес XYOрs<input value={form.xyopsUrl} disabled={Boolean(draft)} onChange={(event) => updateField("xyopsUrl", event.target.value)} placeholder="https://xyops.company.local" /></label>
            <label>API key<input type="password" value={form.xyopsApiKey} disabled={Boolean(draft)} onChange={(event) => updateField("xyopsApiKey", event.target.value)} placeholder={effective.settings.xyops.apiKeyConfigured ? "Сохранён — оставьте пустым без изменений" : "Введите API key"} autoComplete="new-password" /></label>
          </div>
        </div>

        <div className={styles.card}>
          <div className={styles.meta}>
            <span>Revision: <strong>{effective.revision}</strong></span>
            <span>D1 overrides: <strong>{effective.overrideCount ?? 0}</strong></span>
            <span>Конфликты с ENV: <strong>{effective.conflictCount ?? 0}</strong></span>
            <span>Несохранённых полей: <strong>{Object.keys(changes).length}</strong></span>
          </div>
          <div className={styles.actions}>
            <button type="button" disabled={Boolean(busy) || Boolean(draft) || !dirty} onClick={() => void createDraft()}>Создать черновик</button>
            <button type="button" disabled={Boolean(busy) || Boolean(draft)} onClick={() => void load()}>Отменить локальные изменения</button>
          </div>
        </div>

        {draft && <div className={styles.card}>
          <h2>Черновик интеграций</h2>
          <p>Статус: <strong>{draft.status}</strong></p>
          <ul className={styles.diff}>
            {(draft.diff ?? []).map((item, index) => <li key={`${item.field ?? "field"}-${index}`}><code>{item.field}</code>: {item.secret ? "секрет изменён" : `${String(item.before)} → ${String(item.after)}`}</li>)}
          </ul>
          {validationServices.length > 0 && <div className={styles.validationList}>
            {validationServices.map((service) => <p key={service.service}><strong>{service.service}</strong>: {service.ok ? `подключено${service.latencyMs ? ` · ${service.latencyMs} мс` : ""}` : service.error || "проверка не пройдена"}</p>)}
          </div>}
          <div className={styles.actions}>
            <button type="button" disabled={Boolean(busy) || draft.status === "validated"} onClick={() => void validateDraft()}>Проверить на сервере</button>
            <button type="button" disabled={Boolean(busy) || draft.status !== "validated"} onClick={() => void applyDraft()}>Применить</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void cancelDraft()}>Отменить черновик</button>
          </div>
        </div>}
      </>}
      {message && <div className={styles.success} role="status">{message}</div>}
    </SettingsRouteShell>
  );
}
