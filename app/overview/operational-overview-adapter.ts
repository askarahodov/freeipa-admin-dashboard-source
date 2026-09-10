import type { OverviewOperation } from "./OperationalOverview";
import type { PortalHealthCheck, PortalHealthCheckName, PortalReadiness } from "./operational-overview-model";

const healthCheckNames = new Set<PortalHealthCheckName>(["database", "schema", "encryption", "gateway"]);
const healthStates = new Set<PortalHealthCheck["state"]>(["healthy", "unready"]);

export interface OperationalOverviewRun {
  id: string;
  title: string;
  actor: string;
  status: OverviewOperation["status"];
  startedAt: number;
  updatedAt: number;
}

export function parsePortalReadiness(value: unknown): PortalReadiness | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { state?: unknown; checks?: unknown };
  if ((candidate.state !== "healthy" && candidate.state !== "unready") || !Array.isArray(candidate.checks)) return null;

  const checks: PortalHealthCheck[] = [];
  for (const valueCheck of candidate.checks) {
    if (!valueCheck || typeof valueCheck !== "object") return null;
    const check = valueCheck as { name?: unknown; state?: unknown; code?: unknown };
    if (typeof check.name !== "string" || !healthCheckNames.has(check.name as PortalHealthCheckName)) return null;
    if (typeof check.state !== "string" || !healthStates.has(check.state as PortalHealthCheck["state"])) return null;
    if (typeof check.code !== "string") return null;
    checks.push({ name: check.name as PortalHealthCheckName, state: check.state as PortalHealthCheck["state"], code: check.code });
  }

  return { state: candidate.state, checks };
}

export function toOverviewOperations(runs: readonly OperationalOverviewRun[]): OverviewOperation[] {
  return runs.map((run) => ({
    id: run.id,
    title: run.title,
    actor: run.actor,
    status: run.status,
    timeLabel: new Date(run.updatedAt || run.startedAt).toLocaleString("ru-RU"),
  }));
}
