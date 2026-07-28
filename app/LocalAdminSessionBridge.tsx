"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { LOCAL_ADMIN_SESSION_MARKER } from "../admin-session-authorization";

type SessionPayload = {
  enabled?: boolean;
  authenticated?: boolean;
  user?: { username?: string; displayName?: string; role?: string };
};

export default function LocalAdminSessionBridge() {
  const pathname = usePathname();
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [session, setSession] = useState<SessionPayload["user"] | null>(null);

  useEffect(() => {
    if (pathname !== "/settings") return;
    let active = true;
    const timer = window.setTimeout(() => {
      if (!active) return;
      document.getElementById("local-admin-session-bridge")?.remove();
      const target = document.querySelector<HTMLElement>(".settings-page");
      if (!target) return;

      const node = document.createElement("div");
      node.id = "local-admin-session-bridge";
      target.prepend(node);
      setMount(node);

      fetch("/api/auth/session", { cache: "no-store" })
        .then(async (response) => ({ response, data: await response.json().catch(() => ({})) as SessionPayload }))
        .then(({ response, data }) => {
          if (!active) return;
          if (response.ok && data.enabled === true && data.authenticated === true && data.user?.role === "admin") {
            window.sessionStorage.setItem("xyops-admin-token", LOCAL_ADMIN_SESSION_MARKER);
            document.documentElement.dataset.portalAdminAuthorization = "session";
            setSession(data.user);
            return;
          }
          if (window.sessionStorage.getItem("xyops-admin-token") === LOCAL_ADMIN_SESSION_MARKER) {
            window.sessionStorage.removeItem("xyops-admin-token");
          }
        })
        .catch(() => {});
    }, 0);

    return () => {
      active = false;
      window.clearTimeout(timer);
      delete document.documentElement.dataset.portalAdminAuthorization;
      document.getElementById("local-admin-session-bridge")?.remove();
    };
  }, [pathname]);

  if (!mount || !session) return null;
  return createPortal(
    <section className="panel local-admin-session-panel" data-testid="local-admin-session-settings">
      <div>
        <span className="eyebrow">ADMIN SESSION</span>
        <h2>Настройки открыты по административной учётной записи</h2>
        <p>Повторный ADMIN_TOKEN не требуется. Сервер проверяет HttpOnly-сессию, роль администратора и источник изменяющего запроса.</p>
      </div>
      <div className="local-admin-session-identity">
        <small>Текущая учётная запись</small>
        <strong>{session.displayName || session.username || "Администратор"}</strong>
        <span>settings.manage</span>
      </div>
    </section>,
    mount,
  );
}
