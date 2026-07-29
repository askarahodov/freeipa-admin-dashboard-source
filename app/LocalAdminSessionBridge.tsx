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
    let observer: MutationObserver | null = null;

    const attach = () => {
      if (!active) return false;
      const existing = document.getElementById("local-admin-session-bridge");
      if (existing) {
        setMount(existing);
        observer?.disconnect();
        return true;
      }
      const target = document.querySelector<HTMLElement>(".settings-page");
      if (!target) return false;
      const node = document.createElement("div");
      node.id = "local-admin-session-bridge";
      target.prepend(node);
      setMount(node);
      observer?.disconnect();
      return true;
    };

    if (!attach()) {
      observer = new MutationObserver(() => void attach());
      observer.observe(document.body, { childList: true, subtree: true });
    }

    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) as SessionPayload }))
      .then(({ response, data }) => {
        if (!active) return;
        const storedMarker = window.sessionStorage.getItem("xyops-admin-token");
        const localAdmin = response.ok && data.enabled === true && data.authenticated === true && data.user?.role === "admin";
        if (localAdmin) {
          if (storedMarker !== LOCAL_ADMIN_SESSION_MARKER) {
            window.sessionStorage.setItem("xyops-admin-token", LOCAL_ADMIN_SESSION_MARKER);
            window.location.reload();
            return;
          }
          document.documentElement.dataset.portalAdminAuthorization = "session";
          setSession(data.user);
          return;
        }
        if (storedMarker === LOCAL_ADMIN_SESSION_MARKER) {
          window.sessionStorage.removeItem("xyops-admin-token");
          window.location.reload();
        }
      })
      .catch(() => {});

    return () => {
      active = false;
      observer?.disconnect();
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
