import type { ReactNode } from "react";

type IntegrationMode = "demo" | "live" | "cached" | "unconfigured";
type RunStats = { today: number; queued: number; success: number; failed: number };

type LegacyOverviewProps = {
  goToOperations: () => void;
  integration: { mode: IntegrationMode; freeipa: { reachable: boolean }; xyops: { reachable: boolean } };
  userCount: number;
  groupCount: number;
  directorySource: "demo" | "live" | "unconfigured";
  runStats: RunStats;
  recentOperations: ReactNode;
};

export function LegacyOverview({ goToOperations, integration, userCount, groupCount, directorySource, runStats, recentOperations }: LegacyOverviewProps) {
  return <div className="content-stack">
    <section className="metrics">
      <Metric icon="♙" label="Пользователи" value={userCount.toLocaleString("ru-RU")} delta={directorySource === "live" ? "FreeIPA" : directorySource === "demo" ? "Демо" : "Не настроено"} color="violet" />
      <Metric icon="♣" label="Группы" value={groupCount.toLocaleString("ru-RU")} delta={directorySource === "live" ? "FreeIPA" : directorySource === "demo" ? "Демо" : "Не настроено"} color="blue" />
      <Metric icon="⌁" label="Активные операции" value={String(runStats.queued)} delta="сегодня" color="teal" />
      <Metric icon="△" label="Ошибки сегодня" value={String(runStats.failed)} delta="общий журнал" color="red" />
    </section>
    <section className="panel connections"><h2>Состояние подключения</h2><div className="connection-grid">
      <div className="service"><span className="service-icon teal">▤</span><div><h3><i className={`dot ${integration.freeipa.reachable ? "green" : "amber"}`} />FreeIPA {integration.freeipa.reachable ? "подключён" : integration.mode === "demo" ? "демо-режим" : "не настроен"}</h3><small>Источник данных</small><strong>{integration.freeipa.reachable ? "Сохранённая конфигурация" : integration.mode === "demo" ? "Демонстрационные данные" : "Требуется настройка"}</strong></div></div>
      <div className="pulse"><span><i className={`dot ${integration.freeipa.reachable ? "teal-dot" : "amber"}`} /> {integration.freeipa.reachable ? "LIVE" : integration.mode === "demo" ? "DEMO" : "OFF"}</span><b>⌁⌁⌁⌁</b><small>Проверено автоматически</small></div>
      <div className="service"><span className="service-icon violet">⚙</span><div><h3><i className={`dot ${integration.xyops.reachable ? "violet-dot" : "amber"}`} />XYOps {integration.xyops.reachable ? "подключён" : integration.mode === "demo" ? "демо-режим" : "не настроен"}</h3><small>Дополнительная автоматизация</small><strong>{integration.xyops.reachable ? "Events и Workflows доступны" : integration.mode === "demo" ? "Без внешних изменений" : "Не влияет на FreeIPA"}</strong></div></div>
      <div className="pulse purple"><span><i className={`dot ${integration.xyops.reachable ? "violet-dot" : "amber"}`} /> {integration.xyops.reachable ? "LIVE" : integration.mode === "demo" ? "DEMO" : "OFF"}</span><b>⌁⌁⌁⌁</b><small>Проверено автоматически</small></div>
    </div></section>
    <section className="panel table-panel"><div className="panel-title"><h2>Последние операции</h2><button onClick={goToOperations}>Смотреть все операции →</button></div>{recentOperations}</section>
  </div>;
}

function Metric({ icon, label, value, delta, color }: { icon: string; label: string; value: string; delta: string; color: string }) {
  return <article className="metric"><div className={`metric-icon ${color}`}>{icon}</div><div><span>{label}</span><strong>{value}</strong></div><small className={color === "red" ? "down" : "up"}>{delta} <em>{color === "red" ? "по сравнению со вчера" : "за 7 дней"}</em></small></article>;
}
