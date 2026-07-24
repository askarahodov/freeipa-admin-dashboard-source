"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

type Session = {
  enabled?: boolean;
  authenticated?: boolean;
  user?: { username: string; displayName: string; role: "viewer" | "operator" | "admin" };
};

export default function LocalAuthToolbar() {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (pathname === "/login") return;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data) => setSession(data))
      .catch(() => setSession(null));
  }, [pathname]);

  if (!session?.enabled || !session.authenticated || pathname === "/login") return null;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/login");
  }

  return (
    <div className="local-auth-toolbar">
      <span><strong>{session.user?.displayName || session.user?.username}</strong><small>{session.user?.role}</small></span>
      {session.user?.role === "admin" && <Link href="/access">Доступ</Link>}
      <button onClick={() => void logout()}>Выйти</button>
    </div>
  );
}
