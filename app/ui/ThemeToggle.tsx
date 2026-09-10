"use client";

import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem("portal-theme") as "light" | "dark") || "light";
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("portal-theme", next);
  }

  return (
    <button type="button" className="theme-toggle" aria-label="Переключить тему оформления" title={theme === "dark" ? "Светлая тема" : "Тёмная тема"} onClick={toggle}>
      {theme === "dark" ? "☀" : "☾"}
    </button>
  );
}
