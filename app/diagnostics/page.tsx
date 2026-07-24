"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type Diagnostics = {
  generatedAt: number;
  portal: {
    mode: string;
    users: number;
    activeUsers: number;
    admins: number;
    operators: number;
    viewers: number;
    disabledUsers: number;
    lockedUsers: number;
    activeSessions: number;
  };
  database: {
    available: boolean;
    sizeBytes: number | null;
    tables: Record<string, number | null>;
  };
  configuration: {
    encryptionConfigured: boolean;
    adminTokenConfigured: boolean;
    freeipaConfigured: boolean;
    freeipaGatewayConfigured: boolean;
    xyopsConfigured: boolean;
  };
  integrations: Record<string, unknown>;
};

function formatBytes(value: number | null): string {
  if (value == null) return "не определён";
  const units = ["Б", "КиБ", "МиБ", "ГиБ"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
  return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function State({ ok, yes = "Готово", no = "Требует настройки" }: { ok: boolean; yes?: string; no?: string }) {
  return <span className={`diagnostics-state ${ok ? "ok" : "warning"}`}>{ok ? yes : no}</span>;
}

export default function DiagnosticsPage() {
  const [data, setData] = useState<Diagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/diagnostics", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Не удалось загрузить диагностику");
      setData(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить диагностику");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const integration = useMemo(() => {
    const source = data?.integrations ?? {};
    const freeipa = source.freeipa && typeof source.freeipa === "object" ? source.freeipa as Record<string, unknown> : {};
    const xyops = source.xyops && typeof source.xyops === "object" ? source.xyops as Record<string, unknown> : {};
    const persistence = source.persistence && typeof source.persistence === "object" ? source.persistence as Record<string, unknown> : {};
    return {
      freeipaReachable: freeipa.reachable === true,
      xyopsReachable: xyops.reachable === true,
      persistenceAvailable: persistence.available === true || data?.database.available === true,
    };
  }, [data]);

  function downloadReport() {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `portal-diagnostics-${new Date(data.generatedAt).toISOString().replace(/[:.]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (loading && !data) return <main className="diagnostics-shell"><section className="diagnostics-panel"><h1>Локальная диагностика</h1><p>Проверка компонентов портала…</p></section></main>;

  return (
    <main className="diagnostics-shell">
      <header className="diagnostics-header">
        <div>
          <Link href="/" className="access-back">← Вернуться в портал</Link>
          <span className="eyebrow">LOCAL DIAGNOSTICS</span>
          <h1>Состояние портала</h1>
          <p>Безопасная сводка локальной базы, RBAC, FreeIPA Gateway, FreeIPA и XYOps. Секреты и адреса не выводятся.</p>
        </div>
        <div className="diagnostics-actions"><button className="secondary" disabled={loading} onClick={() => void load()}>{loading ? "Обновление…" : "Обновить"}</button><button className="primary" disabled={!data} onClick={downloadReport}>Скачать JSON</button></div>
      </header>

      {error && <div className="access-error">{error}</div>}

      {data && <>
        <section className="diagnostics-grid">
          <article className="diagnostics-card"><small>Пользователи портала</small><strong>{data.portal.users}</strong><span>{data.portal.activeUsers} активных</span></article>
          <article className="diagnostics-card"><small>Администраторы</small><strong>{data.portal.admins}</strong><span>{data.portal.operators} операторов</span></article>
          <article className="diagnostics-card"><small>Активные сессии</small><strong>{data.portal.activeSessions}</strong><span>{data.portal.lockedUsers} заблокировано</span></article>
          <article className="diagnostics-card"><small>Размер базы</small><strong>{formatBytes(data.database.sizeBytes)}</strong><span>локальный volume</span></article>
        </section>

        <section className="diagnostics-panel">
          <div className="diagnostics-title"><div><span className="eyebrow">COMPONENTS</span><h2>Компоненты</h2></div><small>Обновлено {new Date(data.generatedAt).toLocaleString("ru-RU")}</small></div>
          <div className="diagnostics-components">
            <article><div><strong>SQLite / D1</strong><small>Персистентность портала</small></div><State ok={integration.persistenceAvailable} /></article>
            <article><div><strong>Локальная аутентификация</strong><small>Пользователи, роли и сессии</small></div><State ok={data.portal.admins > 0} /></article>
            <article><div><strong>FreeIPA Gateway</strong><small>Приватный Node.js шлюз</small></div><State ok={data.configuration.freeipaGatewayConfigured} yes="Настроен" /></article>
            <article><div><strong>FreeIPA</strong><small>Доступность каталога</small></div><State ok={integration.freeipaReachable} yes="Доступен" no={data.configuration.freeipaConfigured ? "Недоступен" : "Не настроен"} /></article>
            <article><div><strong>XYOps</strong><small>Каталог и выполнение</small></div><State ok={integration.xyopsReachable} yes="Доступен" no={data.configuration.xyopsConfigured ? "Недоступен" : "Не настроен"} /></article>
            <article><div><strong>Шифрование настроек</strong><small>AES-256-GCM key</small></div><State ok={data.configuration.encryptionConfigured} yes="Ключ задан" /></article>
          </div>
        </section>

        <section className="diagnostics-panel">
          <div className="diagnostics-title"><div><span className="eyebrow">DATABASE</span><h2>Таблицы и записи</h2></div></div>
          <div className="diagnostics-table">
            {Object.entries(data.database.tables).map(([name, count]) => <div key={name}><code>{name}</code><strong>{count == null ? "нет таблицы" : count.toLocaleString("ru-RU")}</strong></div>)}
          </div>
        </section>
      </>}
    </main>
  );
}