"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SettingsRouteShell } from "../SettingsRouteShell";
import { requestSettingsJson, type SessionState } from "../settings-lifecycle-client";
import styles from "../settings-route-shell.module.css";

type ProcessPresentationSet = {
  version: 1;
  defaultLocale?: string;
  processes: Record<string, unknown>;
};

type PresentationResponse = {
  metadata?: unknown;
  source?: "database" | "environment" | "default";
  updatedAt?: number | null;
  availableLocales?: string[];
};

const emptyPresentation: ProcessPresentationSet = { version: 1, processes: {} };

function isProcessPresentationSet(value: unknown): value is ProcessPresentationSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as { version?: unknown; processes?: unknown };
  return record.version === 1 && Boolean(record.processes) && typeof record.processes === "object" && !Array.isArray(record.processes);
}

function serialize(metadata: ProcessPresentationSet): string {
  return `${JSON.stringify(metadata, null, 2)}\n`;
}

export default function PresentationSettingsPage() {
  const [session, setSession] = useState<SessionState | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [text, setText] = useState(serialize(emptyPresentation));
  const [baseline, setBaseline] = useState(serialize(emptyPresentation));
  const [source, setSource] = useState<PresentationResponse["source"]>(undefined);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [availableLocales, setAvailableLocales] = useState<string[]>([]);
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

      const data = await requestSettingsJson("/api/integrations/catalog/presentation") as PresentationResponse;
      if (!isProcessPresentationSet(data.metadata)) throw new Error("Сервер вернул некорректный presentation metadata contract");
      const nextText = serialize(data.metadata);
      setText(nextText);
      setBaseline(nextText);
      setSource(data.source ?? "default");
      setUpdatedAt(data.updatedAt ?? null);
      setAvailableLocales(Array.isArray(data.availableLocales) ? data.availableLocales : []);
      setLoaded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Презентационные метаданные недоступны");
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
    if (!isProcessPresentationSet(parsed)) {
      setError("Presentation JSON должен содержать version: 1 и объект processes.");
      return;
    }

    setBusy("save");
    try {
      const data = await requestSettingsJson("/api/integrations/catalog/presentation", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metadata: parsed }),
      }) as PresentationResponse;
      const accepted = isProcessPresentationSet(data.metadata) ? data.metadata : parsed;
      const nextText = serialize(accepted);
      setText(nextText);
      setBaseline(nextText);
      setSource(data.source ?? "database");
      setUpdatedAt(data.updatedAt ?? null);
      setAvailableLocales(Array.isArray(data.availableLocales) ? data.availableLocales : []);
      setMessage("Презентационные метаданные сохранены.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось сохранить презентационные метаданные");
    } finally {
      setBusy(null);
    }
  }

  const authenticated = session?.authenticated === true;
  const admin = authenticated && session?.user?.role === "admin";

  return (
    <SettingsRouteShell
      title="Представление процессов"
      description="Текущий JSON-контракт презентационных метаданных вынесен в отдельный маршрут. Расширенный многоязычный редактор развивается отдельным этапом."
      hasUnsavedChanges={dirty}
    >
      {busy === "load" && !session && <div className={styles.notice}>Проверяем доступ и загружаем presentation metadata…</div>}
      {error && <div className={styles.error} role="alert"><strong>Ошибка</strong><br />{error}</div>}
      {session && !authenticated && <div className={styles.card}><h2>Требуется вход</h2><p>Настройки доступны только после аутентификации.</p><Link href="/login?returnTo=%2Fsettings%2Fpresentation">Войти</Link></div>}
      {session && authenticated && !admin && <div className={styles.card}><h2>Недостаточно прав</h2><p>Этот раздел требует административной роли и серверного permission <code>settings.manage</code>.</p><Link href="/">Вернуться к обзору</Link></div>}
      {admin && !loaded && busy !== "load" && <div className={styles.card}><h2>Метаданные не загружены</h2><p>Редактор заблокирован до успешного чтения текущего состояния сервера, чтобы пустой baseline нельзя было сохранить поверх существующей конфигурации.</p><button type="button" onClick={() => void load()}>Повторить загрузку</button></div>}

      {admin && loaded && <div className={styles.card}>
        <div className={styles.sectionHead}>
          <div>
            <h2>JSON presentation metadata</h2>
            <p>Этот baseline сохраняет существующий server contract. Process ID, schemaVersion, visibility, approvals, targets и execution здесь не меняются.</p>
          </div>
          <span className={styles.sourceBadge}>{source ?? "default"}</span>
        </div>
        <label className={styles.jsonField}>
          Presentation JSON
          <textarea value={text} onChange={(event) => { setText(event.target.value); setError(""); setMessage(""); }} spellCheck={false} aria-label="JSON презентационных метаданных процессов" />
        </label>
        <div className={styles.meta}>
          <span>Языки: <strong>{availableLocales.length ? availableLocales.join(", ") : "не заданы"}</strong></span>
          <span>{updatedAt ? `Сохранено: ${new Date(updatedAt).toLocaleString("ru-RU")}` : "D1 override отсутствует"}</span>
          <span>Состояние: <strong>{dirty ? "есть несохранённые изменения" : "синхронизировано"}</strong></span>
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
