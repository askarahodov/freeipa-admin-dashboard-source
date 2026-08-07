"use client";

import { Button, PageHeader, StatusBadge } from "../ui";
import { buildOperationalOverview, type OperationalOverviewInput, type OverviewState, type OverviewTarget } from "./operational-overview-model";
import styles from "./operational-overview.module.css";

export interface OverviewOperation {
  id: string;
  title: string;
  actor: string;
  timeLabel: string;
  status: "queued" | "running" | "success" | "failed" | "cancelled" | "unknown";
}

export interface OverviewQuickAction {
  id: string;
  label: string;
  description?: string;
  onAction: () => void;
  primary?: boolean;
  disabled?: boolean;
}

export interface OperationalOverviewProps extends OperationalOverviewInput {
  recentOperations: OverviewOperation[];
  quickActions: OverviewQuickAction[];
  loading?: boolean;
  onNavigate: (target: OverviewTarget) => void;
}

const stateLabel: Record<OverviewState, string> = {
  healthy: "Готово",
  warning: "Ограничено",
  danger: "Проблема",
  unknown: "Нет данных",
};

const stateTone: Record<OverviewState, "success" | "warning" | "danger" | "neutral"> = {
  healthy: "success",
  warning: "warning",
  danger: "danger",
  unknown: "neutral",
};

const operationTone: Record<OverviewOperation["status"], "success" | "warning" | "danger" | "neutral" | "info"> = {
  queued: "neutral",
  running: "info",
  success: "success",
  failed: "danger",
  cancelled: "neutral",
  unknown: "warning",
};

const operationLabel: Record<OverviewOperation["status"], string> = {
  queued: "В очереди",
  running: "Выполняется",
  success: "Успешно",
  failed: "Ошибка",
  cancelled: "Отменено",
  unknown: "Неизвестно",
};

export function OperationalOverview(props: OperationalOverviewProps) {
  const model = buildOperationalOverview(props);

  return (
    <div className={styles.page}>
      <PageHeader
        title="Обзор"
        description="Операционное состояние портала, интеграций и последних действий."
      />

      {props.loading ? <div className={styles.loading}>Обновление состояния…</div> : null}

      {model.attention.length > 0 ? (
        <section className={styles.section} aria-labelledby="overview-attention-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="overview-attention-title">Требует внимания</h2>
              <p>Сначала разберите состояния, которые могут повлиять на работу пользователей или операций.</p>
            </div>
          </div>
          <div className={styles.attentionList}>
            {model.attention.map((item) => (
              <button className={`${styles.attentionRow} ${styles[`attention_${item.state}`]}`} key={item.id} onClick={() => props.onNavigate(item.target)}>
                <span className={styles.attentionCopy}>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <StatusBadge tone={item.state === "danger" ? "danger" : "warning"}>{item.state === "danger" ? "Проблема" : "Проверить"}</StatusBadge>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className={styles.quietState}>
          <strong>Срочных действий нет</strong>
          <span>Новых operational-сигналов, требующих внимания, не обнаружено.</span>
        </div>
      )}

      <section className={styles.section} aria-labelledby="overview-health-title">
        <div className={styles.sectionHeader}>
          <div>
            <h2 id="overview-health-title">Состояние системы</h2>
            <p>Core readiness и интеграции показаны отдельно, чтобы сбой FreeIPA или XYOps не выглядел как падение портала.</p>
          </div>
        </div>
        <div className={styles.healthList}>
          {model.health.map((item) => (
            <div className={styles.healthRow} key={item.id}>
              <div>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </div>
              <StatusBadge tone={stateTone[item.state]}>{stateLabel[item.state]}</StatusBadge>
            </div>
          ))}
        </div>
      </section>

      <div className={styles.lowerGrid}>
        <section className={styles.section} aria-labelledby="overview-operations-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="overview-operations-title">Последние операции</h2>
              <p>Короткая история без подмены полного журнала.</p>
            </div>
            <Button variant="ghost" onClick={() => props.onNavigate("operations")}>Открыть журнал</Button>
          </div>
          <div className={styles.operationList}>
            {props.recentOperations.length ? props.recentOperations.slice(0, 6).map((operation) => (
              <div className={styles.operationRow} key={operation.id}>
                <div className={styles.operationCopy}>
                  <strong>{operation.title}</strong>
                  <small>{operation.actor} · {operation.timeLabel}</small>
                </div>
                <StatusBadge tone={operationTone[operation.status]}>{operationLabel[operation.status]}</StatusBadge>
              </div>
            )) : <div className={styles.emptyRow}>Последних операций пока нет.</div>}
          </div>
        </section>

        <section className={styles.section} aria-labelledby="overview-actions-title">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="overview-actions-title">Быстрые действия</h2>
              <p>Показаны только действия, уже разрешённые текущей роли.</p>
            </div>
          </div>
          <div className={styles.quickActions}>
            {props.quickActions.length ? props.quickActions.map((action) => (
              <div className={styles.quickAction} key={action.id}>
                <div>
                  <strong>{action.label}</strong>
                  {action.description ? <small>{action.description}</small> : null}
                </div>
                <Button variant={action.primary ? "primary" : "secondary"} disabled={action.disabled} onClick={action.onAction}>Открыть</Button>
              </div>
            )) : <div className={styles.emptyRow}>Для текущей роли быстрых действий нет.</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
