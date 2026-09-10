"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SettingsRouteShell } from "../SettingsRouteShell";
import {
  applySettingsDraft,
  cancelSettingsDraft,
  createSettingsDraft,
  loadAdminEffectiveSettings,
  validateSettingsDraft,
  type EffectiveSettings,
  type SessionState,
  type SettingsDraft,
} from "../settings-lifecycle-client";
import styles from "../settings-route-shell.module.css";

export default function GeneralSettingsPage() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [effective, setEffective] = useState<EffectiveSettings | null>(null);
  const [desiredDemoMode, setDesiredDemoMode] = useState(false);
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
        setDesiredDemoMode(loaded.effective.settings.demoMode === true);
        setDraft(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Настройки недоступны");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createDraft() {
    if (!effective || desiredDemoMode === effective.settings.demoMode) return;
    setBusy("draft"); setError(""); setMessage("");
    try {
      setDraft(await createSettingsDraft(effective.revision, { demoMode: desiredDemoMode }));
      setMessage("Черновик создан. Проверьте изменение и выполните серверную проверку.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось создать черновик");
    } finally { setBusy(null); }
  }

  async function validateDraft() {
    if (!draft) return;
    setBusy("validate"); setError(""); setMessage("");
    try {
      setDraft(await validateSettingsDraft(draft.id));
      setMessage("Серверная проверка пройдена. Конфигурацию можно применить.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Проверка черновика не пройдена");
    } finally { setBusy(null); }
  }

  async function applyDraft() {
    if (!draft || draft.status !== "validated") return;
    setBusy("apply"); setError(""); setMessage("");
    try {
      await applySettingsDraft(draft.id);
      setMessage("Общие настройки применены.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось применить черновик");
    } finally { setBusy(null); }
  }

  async function cancelDraft() {
    if (!draft) return;
    setBusy("cancel"); setError(""); setMessage("");
    try {
      await cancelSettingsDraft(draft.id);
      setDraft(null);
      if (effective) setDesiredDemoMode(effective.settings.demoMode);
      setMessage("Черновик отменён.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось отменить черновик");
    } finally { setBusy(null); }
  }

  const authenticated = session?.authenticated === true;
  const admin = authenticated && session?.user?.role === "admin";

  return (
    <SettingsRouteShell title="Общие настройки" description="Базовые параметры портала. Изменения проходят через черновик, серверную проверку и явное применение.">
      {busy === "load" && !session && <div className={styles.notice}>Проверяем доступ и текущую конфигурацию…</div>}
      {error && <div className={styles.error} role="alert"><strong>Ошибка</strong><br />{error}</div>}
      {session && !authenticated && <div className={styles.card}><h2>Требуется вход</h2><p>Настройки доступны только после аутентификации.</p><Link href="/login?returnTo=%2Fsettings%2Fgeneral">Войти</Link></div>}
      {session && authenticated && !admin && <div className={styles.card}><h2>Недостаточно прав</h2><p>Этот раздел требует административной роли и серверного permission <code>settings.manage</code>.</p><Link href="/">Вернуться к обзору</Link></div>}

      {admin && effective && <>
        <div className={styles.card}>
          <div className={styles.row}>
            <div><h2>Режим портала</h2><p>Демо-режим влияет на источник интеграционных данных. Секретные параметры здесь не отображаются и не редактируются.</p></div>
            <label><input type="checkbox" checked={desiredDemoMode} disabled={Boolean(draft) || Boolean(busy)} onChange={(event) => setDesiredDemoMode(event.target.checked)} /> Демо-режим</label>
          </div>
          <div className={styles.meta}>
            <span>Revision: <strong>{effective.revision}</strong></span>
            <span>Источник: <strong>{effective.fields.demoMode?.source ?? "default"}</strong></span>
            <span>D1 overrides: <strong>{effective.overrideCount ?? 0}</strong></span>
            <span>Конфликты с ENV: <strong>{effective.conflictCount ?? 0}</strong></span>
          </div>
          <div className={styles.actions}>
            <button type="button" disabled={Boolean(busy) || Boolean(draft) || desiredDemoMode === effective.settings.demoMode} onClick={() => void createDraft()}>Создать черновик</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => void load()}>Обновить</button>
          </div>
        </div>

        {draft && <div className={styles.card}>
          <h2>Черновик изменения</h2>
          <p>Статус: <strong>{draft.status}</strong></p>
          <ul className={styles.diff}>{(draft.diff ?? []).filter((item) => item.secret !== true).map((item, index) => <li key={`${item.field ?? "field"}-${index}`}><code>{item.field}</code>: {String(item.before)} → {String(item.after)}</li>)}</ul>
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
