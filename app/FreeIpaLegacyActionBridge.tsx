"use client";

import { useEffect } from "react";

function normalizedText(element: HTMLElement): string {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

function legacyUserButton(uid: string, label: string): HTMLButtonElement | null {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(".section-page .data-table .tr.users-row:not(.th)"));
  const row = rows.find((item) => item.querySelector(".mono")?.textContent?.trim() === uid);
  return Array.from(row?.querySelectorAll<HTMLButtonElement>("button") ?? [])
    .find((button) => normalizedText(button) === label) ?? null;
}

function retryLegacyAction(resolveButton: () => HTMLButtonElement | null, modalSelector: string, attempt = 0): void {
  if (document.querySelector(modalSelector)) return;
  const button = resolveButton();
  if (button && !button.disabled) button.click();
  if (attempt < 12) window.setTimeout(() => retryLegacyAction(resolveButton, modalSelector, attempt + 1), 50);
}

export default function FreeIpaLegacyActionBridge() {
  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
      if (!button || !button.closest(".freeipa-user-browser-shell")) return;

      const text = normalizedText(button);
      if (text.includes("Создать пользователя")) {
        window.setTimeout(() => retryLegacyAction(
          () => document.querySelector<HTMLButtonElement>(".section-page > .panel-title button.primary"),
          ".dynamic-modal",
        ), 0);
        return;
      }

      if (text !== "Карточка" && text !== "Редактировать") return;
      const row = button.closest("tr");
      const uid = row?.querySelector("code")?.textContent?.trim() ?? "";
      if (!uid) return;
      window.setTimeout(() => retryLegacyAction(
        () => legacyUserButton(uid, text),
        text === "Карточка" ? ".identity-modal" : ".dynamic-modal",
      ), 0);
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  return null;
}
