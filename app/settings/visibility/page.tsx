"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SettingsRouteShell } from "../SettingsRouteShell";
import { requestSettingsJson, type SessionState } from "../settings-lifecycle-client";
import styles from "../settings-route-shell.module.css";

type CatalogPolicySet = {
  version: 1;
  defaultEffect: "allow" | "deny";
  adminBypass: boolean;
  rules: unknown[];
};

type PolicyResponse = {
  policy?: unknown;
  source?: "database" | "environment" | "default";
  updatedAt?: number | null;
};

const emptyPolicy: CatalogPolicySet = {
  version: 1,
  defaultEffect: "allow",
  adminBypass: true,
  rules: [],
};

function isCatalogPolicySet(value: unknown): value is CatalogPolicySet {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as { version?: unknown; defaultEffect?: unknown; adminBypass?: unknown; rules?: unknown };
  return record.version === 1
    && (record.defaultEffect === "allow" || record.defaultEffect === "deny")
    && typeof record.adminBypass === "boolean"
    && Array.isArray(record.rules);
}

function serialize(policy: CatalogPolicySet): string {
  return `${JSON.stringify(policy, null, 2)}\n`;
}

export default function VisibilitySettingsPage() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState(serialize(emptyPolicy));
  const [baseline, setBaseline] = useState(serialize(emptyPolicy));
  const [source, setSource] = useState<PolicyResponse["source"]>(undefined);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState<"load" | "save" | null>("load");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setBusy("load");
    setLoaded(false);
    setError("");
    try {
      const nextSession = await requestSettingsJson("/api/auth/session") as SessionState;
      setSession(nextSession);
      if (!nextSession.authenticated || nextSession.user?.role !== "admin") return;

      const data = await requestSettingsJson("/api/integrations/catalog/policies") as PolicyResponse;
      if (!isCatalogPolicySet(data.policy)) throw new Error("Сервер вернул некорректный visibility policy contract");
      const nextText = serialize(data.policy);
      setText(nextText);
      setBaseline(nextText);
      setSource(data.source ?? "default");
      setUpdatedAt(data.updatedAt ?? null);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Политики видимости недоступны");
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const dirty = loaded && text !== baseline;

  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);

  async function save() {
    if (!loaded) return;
    setError("");
    setMessage("");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      setError("JSON содержит синтаксическую ошибку. Исправьте документ перед сохранением.");
      return;
    }
    if (!isCatalogPolicySet(parsed)) {
      setError("Policy JSON должен содержать version: 1, defaultEffect, adminBypass и массив rules.");
      return;
    }

    setBusy("save");
    try {
      const data = await requestSettingsJson("/api/integrations/catalog/policies", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ policy: parsed }),
      }) as PolicyResponse;
      const accepted = isCatalogPolicySet(data.policy) ? data.policy : parsed;
      const nextText = serialize(accepted);
      setText(nextText);
      setBaseline(nextText);
      setSource(data.source ?? "database");
      setUpdatedAt(data.updatedAt ?? null);
      setMessage("Политики видимости сохранены.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить политики видимости");
    } finally {
      setBusy(null);
    }
  }

  const authenticated = session?.authenticated === true;
  const admin = authenticated && session?.user?.role === "admin";

  return (
    <SettingsRouteShell
      title="Видимость каталога"
      description="Текущий JSON-контракт политик видимости вынесен в отдельный маршрут. Визуальный rule builder развивается отдельным этапом."
      hasUnsavedChanges={dirty}
    >
      {busy === "load" && !session && <div className={styles.notice}>Проверяем доступ и загружаем политики видимости…</div>}
      {error && <div className={styles.error} role="alert"><strong>Ошибка</strong><br />{error}</div>}
      {session && !authenticated && <div className={styles.card}><h2>Требуется вход</h2><p>Настройки доступны только после аутентификации.</p><Link href="/login?returnTo=%2Fsettings%2Fvisibility">Войти</Link></div>}
      {session && authenticated && !admin && <div className={styles.card}><h2>Недостаточно прав</h2><p>Этот раздел требует административной роли и серверного permission <code>settings.manage</code>.</p><Link href="/">Вернуться к обзору</Link></div>}
      {admin && !loaded && busy !== "load" && <div className={styles.card}><h2>Политики не загружены</h2><p>Редактор заблокирован до успешного чтения текущего состояния сервера, чтобы пустой baseline нельзя было сохранить поверх существующей политики.</p><button type="button" onClick={() => void load()}>Повторить загрузку</button></div>}

      {admin && loaded && <div className={styles.card}>
        <div className={styles.sectionHead}>
          <div>
            <h2>JSON visibility policy</h2>
            <p>Baseline сохраняет существующий server contract. Разрешения, deny-overrides и итоговое вычисление видимости остаются на сервере.</p>
          </div>
          <span className={styles.sourceBadge}>{source ?? "default"}</span>
        </div>
        <label className={styles.jsonField}>
          Policy JSON
          <textarea value={text} onChange={(event) => { setText(event.target.value); setError(""); setMessage(""); }} spellCheck={false} aria-label="JSON политик видимости каталога" />
        </label>
        <div className={styles.meta}>
          <span>Состояние: <strong>{dirty ? "есть несохранённые изменения" : "синхронизировано"}</strong></span>
          <span>Правил в JSON: <strong>{isCatalogPolicySet(JSON.parse(baseline)) ? JSON.parse(baseline).rules.length : 0}</strong></span>
          <span>{updatedAt ? `Сохранено: ${new Date(updatedAt).toLocaleString("ru-RU")}` : "D1 override отсутствует"}</span>
        </div>
        <div className={styles.actions}>
          <button type="button" disabled={Boolean(busy) || !dirty} onClick={() => void save()}>{busy === "save" ? "Сохранение…" : "Сохранить"}</button>
          <button type="button" disabled={Boolean(busy) || !dirty} onClick={() => { setText(baseline); setError(""); setMessage("Локальные изменения отменены."); }}>Отменить локальные изменения</button>
          <button type="button" disabled={Boolean(busy) || dirty} onClick={() => void load()}>Обновить с сервера</button>
        </div>
      </div>}
      {message && <div className={styles.success} role="status">{message}</div>}
    </SettingsRouteShell>
  );
}
