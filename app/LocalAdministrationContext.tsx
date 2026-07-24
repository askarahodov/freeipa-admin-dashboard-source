"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  portalPermissionMetadata,
  portalPermissionOrder,
  portalRoleLabels,
  portalRolePermissions,
  portalRoles,
  roleHasPermission,
  type PortalPermission,
  type PortalRole,
} from "../portal-permissions";

type SessionPayload = {
  enabled?: boolean;
  authenticated?: boolean;
  user?: { id: string; username: string; displayName: string; role: PortalRole };
};

type AccessPayload = {
  access?: {
    identity?: string;
    role?: PortalRole;
    permissions?: PortalPermission[];
  };
};

type PortalSummary = {
  users: number;
  activeUsers: number;
  admins: number;
  operators: number;
  viewers: number;
  disabledUsers: number;
  lockedUsers: number;
  activeSessions: number;
};

type DiagnosticsPayload = {
  portal?: Partial<PortalSummary>;
};

function safeSummary(value: DiagnosticsPayload["portal"]): PortalSummary {
  const number = (item: unknown) => Math.max(0, Number(item) || 0);
  return {
    users: number(value?.users),
    activeUsers: number(value?.activeUsers),
    admins: number(value?.admins),
    operators: number(value?.operators),
    viewers: number(value?.viewers),
    disabledUsers: number(value?.disabledUsers),
    lockedUsers: number(value?.lockedUsers),
    activeSessions: number(value?.activeSessions),
  };
}

function usePortalMount(pathname: string) {
  const [mount, setMount] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const existing = document.getElementById("local-administration-context");
      existing?.remove();

      const node = document.createElement("div");
      node.id = "local-administration-context";

      if (pathname === "/") {
        const target = document.querySelector(".content-stack");
        if (!target) return;
        target.prepend(node);
      } else if (pathname === "/access") {
        const target = document.querySelector(".access-topbar");
        if (!target?.parentElement) return;
        target.insertAdjacentElement("afterend", node);
      } else {
        return;
      }
      setMount(node);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      setMount((current) => {
        current?.remove();
        return null;
      });
    };
  }, [pathname]);

  return mount;
}

function PermissionChip({ permission }: { permission: PortalPermission }) {
  const metadata = portalPermissionMetadata[permission];
  return <span className="local-permission-chip" title={metadata.description}><b>{metadata.scope}</b>{metadata.shortTitle}</span>;
}

function AdministrationLinks() {
  return (
    <nav className="local-admin-links" aria-label="Локальное администрирование">
      <Link href="/access">Пользователи и роли</Link>
      <Link href="/sessions">Активные сессии</Link>
      <Link href="/diagnostics">Диагностика</Link>
      <Link href="/audit">Аудит</Link>
      <Link href="/settings">Настройки</Link>
    </nav>
  );
}

function DashboardSummary({ summary, role, permissions }: { summary: PortalSummary; role: PortalRole; permissions: PortalPermission[] }) {
  return (
    <section className="local-dashboard-access panel">
      <div className="local-dashboard-access-head">
        <div><span className="eyebrow">LOCAL ACCESS</span><h2>Внутренний доступ к порталу</h2><p>Локальные пользователи и сессии портала не зависят от учётных записей FreeIPA.</p></div>
        <span className="local-role-badge">{portalRoleLabels[role]}</span>
      </div>
      <div className="local-access-metrics">
        <article><strong>{summary.users}</strong><span>Пользователей</span><small>{summary.activeUsers} активны</small></article>
        <article><strong>{summary.admins}</strong><span>Администраторов</span><small>полный доступ</small></article>
        <article><strong>{summary.operators}</strong><span>Операторов</span><small>FreeIPA и XYOps</small></article>
        <article><strong>{summary.viewers}</strong><span>Наблюдателей</span><small>только чтение</small></article>
        <article className={summary.lockedUsers ? "warning" : ""}><strong>{summary.lockedUsers}</strong><span>Блокировок</span><small>{summary.disabledUsers} отключены</small></article>
        <article><strong>{summary.activeSessions}</strong><span>Активных сессий</span><small>HttpOnly cookies</small></article>
      </div>
      <div className="local-effective-access"><div><strong>Ваши effective permissions</strong><small>Получены из серверного `/api/integrations/status`</small></div><div>{permissions.map((permission) => <PermissionChip permission={permission} key={permission} />)}</div></div>
      <AdministrationLinks />
    </section>
  );
}

function PermissionMatrix({ currentRole, effectivePermissions }: { currentRole: PortalRole; effectivePermissions: PortalPermission[] }) {
  const effective = useMemo(() => new Set(effectivePermissions), [effectivePermissions]);
  return (
    <section className="local-permission-panel access-panel">
      <div className="local-permission-panel-head">
        <div><span className="eyebrow">EFFECTIVE PERMISSIONS</span><h2>Точная матрица серверных прав</h2><p>Матрица соответствует проверкам `requirePortalPermission` в runtime. Роль определяет полный набор прав без скрытого наследования в браузере.</p></div>
        <div className="local-current-effective"><span>Текущая роль</span><strong>{portalRoleLabels[currentRole]}</strong><small>{effective.size} из {portalPermissionOrder.length} разрешений</small></div>
      </div>
      <div className="local-permission-table-wrap">
        <table className="local-permission-table">
          <thead><tr><th>Разрешение</th>{portalRoles.map((role) => <th className={role === currentRole ? "current" : ""} key={role}>{portalRoleLabels[role]}</th>)}</tr></thead>
          <tbody>{portalPermissionOrder.map((permission) => {
            const metadata = portalPermissionMetadata[permission];
            return <tr key={permission}><td><strong>{metadata.title}</strong><code>{permission}</code><small>{metadata.description}</small></td>{portalRoles.map((role) => <td className={role === currentRole ? "current" : ""} key={role}><span className={roleHasPermission(role, permission) ? "allowed" : "denied"}>{roleHasPermission(role, permission) ? "✓ Разрешено" : "— Нет"}</span></td>)}</tr>;
          })}</tbody>
        </table>
      </div>
      <div className="local-effective-access"><div><strong>Фактически выдано текущей сессии</strong><small>Если список расходится с ролью, серверная конфигурация требует проверки.</small></div><div>{effectivePermissions.map((permission) => <PermissionChip permission={permission} key={permission} />)}</div></div>
      <AdministrationLinks />
    </section>
  );
}

export default function LocalAdministrationContext() {
  const pathname = usePathname();
  const mount = usePortalMount(pathname);
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [access, setAccess] = useState<AccessPayload["access"] | null>(null);
  const [summary, setSummary] = useState<PortalSummary | null>(null);

  useEffect(() => {
    if (pathname !== "/" && pathname !== "/access") return;
    let active = true;
    Promise.all([
      fetch("/api/auth/session", { cache: "no-store" }).then((response) => response.json().catch(() => ({}))),
      fetch("/api/integrations/status", { cache: "no-store" }).then((response) => response.json().catch(() => ({}))),
    ]).then(([sessionData, accessData]: [SessionPayload, AccessPayload]) => {
      if (!active) return;
      setSession(sessionData);
      setAccess(accessData.access ?? null);
      if (pathname === "/" && sessionData.authenticated && sessionData.user?.role === "admin") {
        fetch("/api/auth/diagnostics", { cache: "no-store" })
          .then((response) => response.ok ? response.json() : Promise.reject())
          .then((data: DiagnosticsPayload) => active && setSummary(safeSummary(data.portal)))
          .catch(() => active && setSummary(null));
      }
    }).catch(() => {
      if (active) { setSession(null); setAccess(null); setSummary(null); }
    });
    return () => { active = false; };
  }, [pathname]);

  if (!mount || !session?.enabled || !session.authenticated || session.user?.role !== "admin") return null;
  const currentRole = access?.role ?? session.user.role;
  const effectivePermissions = Array.isArray(access?.permissions) ? access.permissions : portalRolePermissions[currentRole];

  if (pathname === "/" && summary) return createPortal(<DashboardSummary summary={summary} role={currentRole} permissions={effectivePermissions} />, mount);
  if (pathname === "/access") return createPortal(<PermissionMatrix currentRole={currentRole} effectivePermissions={effectivePermissions} />, mount);
  return null;
}
