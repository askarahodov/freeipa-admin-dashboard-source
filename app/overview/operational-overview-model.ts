export type PortalHealthCheckName = "database" | "schema" | "encryption" | "gateway";
export type PortalHealthState = "healthy" | "unready" | "unknown";
export type OverviewState = "healthy" | "warning" | "danger" | "unknown";
export type OverviewTarget = "approvals" | "operations" | "settings" | "catalog" | "diagnostics";
export type PrivilegedAttentionId = "portal-unready" | "freeipa-degraded" | "xyops-degraded";

export interface PortalHealthCheck {
  name: PortalHealthCheckName;
  state: "healthy" | "unready";
  code: string;
}

export interface PortalReadiness {
  state: "healthy" | "unready";
  checks: PortalHealthCheck[];
}

export interface OperationalOverviewInput {
  readiness?: PortalReadiness | null;
  freeipaReachable: boolean | null;
  xyopsReachable: boolean | null;
  pendingApprovals: number;
  failedOperations: number;
  catalogNeedsReview: boolean;
  attentionTargets?: Partial<Record<PrivilegedAttentionId, OverviewTarget>>;
}

export interface OverviewHealthRow {
  id: string;
  label: string;
  state: OverviewState;
  detail: string;
}

export interface OverviewAttentionItem {
  id: string;
  state: "warning" | "danger";
  title: string;
  detail: string;
  target?: OverviewTarget;
}

export interface OperationalOverviewModel {
  portalCore: OverviewState;
  health: OverviewHealthRow[];
  attention: OverviewAttentionItem[];
}

const checkLabels: Record<PortalHealthCheckName, string> = {
  database: "База данных",
  schema: "Схема данных",
  encryption: "Шифрование",
  gateway: "FreeIPA Gateway",
};

function checkState(readiness: PortalReadiness | null | undefined, name: PortalHealthCheckName): PortalHealthState {
  return readiness?.checks.find((check) => check.name === name)?.state ?? "unknown";
}

function overviewState(state: PortalHealthState): OverviewState {
  return state === "healthy" ? "healthy" : state === "unready" ? "danger" : "unknown";
}

function stateDetail(state: OverviewState): string {
  if (state === "healthy") return "Готово";
  if (state === "danger") return "Требуется вмешательство";
  if (state === "warning") return "Ограниченная доступность";
  return "Нет данных";
}

export function buildOperationalOverview(input: OperationalOverviewInput): OperationalOverviewModel {
  const portalCore: OverviewState = input.readiness?.state === "healthy" ? "healthy" : input.readiness?.state === "unready" ? "danger" : "unknown";
  const health: OverviewHealthRow[] = [
    { id: "portal-core", label: "Ядро портала", state: portalCore, detail: stateDetail(portalCore) },
    ...(["database", "schema", "encryption", "gateway"] as PortalHealthCheckName[]).map((name) => {
      const state = overviewState(checkState(input.readiness, name));
      return { id: name, label: checkLabels[name], state, detail: stateDetail(state) };
    }),
    {
      id: "freeipa",
      label: "FreeIPA",
      state: input.freeipaReachable === null ? "unknown" : input.freeipaReachable ? "healthy" : "warning",
      detail: input.freeipaReachable === null ? "Нет данных" : input.freeipaReachable ? "Доступен" : "Интеграция недоступна",
    },
    {
      id: "xyops",
      label: "XYOps",
      state: input.xyopsReachable === null ? "unknown" : input.xyopsReachable ? "healthy" : "warning",
      detail: input.xyopsReachable === null ? "Нет данных" : input.xyopsReachable ? "Доступен" : "Интеграция недоступна",
    },
  ];

  const attention: OverviewAttentionItem[] = [];
  if (portalCore === "danger") {
    const failedChecks = input.readiness?.checks.filter((check) => check.state === "unready").length ?? 0;
    attention.push({
      id: "portal-unready",
      state: "danger",
      title: "Портал не готов к работе",
      detail: failedChecks ? `${failedChecks} системных проверок требуют вмешательства` : "Проверьте состояние системы",
      target: input.attentionTargets?.["portal-unready"],
    });
  }
  if (input.failedOperations > 0) attention.push({ id: "failed-runs", state: "danger", title: "Есть неуспешные операции", detail: `${input.failedOperations} операций требуют проверки`, target: "operations" });
  if (input.pendingApprovals > 0) attention.push({ id: "pending-approvals", state: "warning", title: "Ожидаются согласования", detail: `${input.pendingApprovals} заявок ждут решения`, target: "approvals" });
  if (input.freeipaReachable === false) attention.push({
    id: "freeipa-degraded",
    state: "warning",
    title: "FreeIPA недоступен",
    detail: "Портал работает, но directory-операции ограничены",
    target: input.attentionTargets?.["freeipa-degraded"],
  });
  if (input.xyopsReachable === false) attention.push({
    id: "xyops-degraded",
    state: "warning",
    title: "XYOps недоступен",
    detail: "Портал работает, но запуск автоматизаций ограничен",
    target: input.attentionTargets?.["xyops-degraded"],
  });
  if (input.catalogNeedsReview) attention.push({ id: "catalog-review", state: "warning", title: "Каталог требует проверки", detail: "Есть изменения или устаревший снимок каталога", target: "catalog" });

  return { portalCore, health, attention };
}
