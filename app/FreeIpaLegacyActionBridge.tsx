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

function markLegacyMemberRemovalConfirmed(uid: string): void {
  const rows = Array.from(document.querySelectorAll<HTMLElement>(".identity-modal .member-table > div"));
  const row = rows.find((item) => normalizedText(item).includes(uid));
  const button = row?.querySelector<HTMLButtonElement>("button.danger-link");
  if (button) button.dataset.portalConfirmed = "1";
}

function markFreeIpaConfirmationHandled(): void {
  for (const modal of document.querySelectorAll<HTMLElement>(".dynamic-modal")) {
    if (!modal.querySelector(".danger-confirm")) continue;
    const submit = modal.querySelector<HTMLButtonElement>(".modal-actions button.primary");
    if (submit) submit.dataset.portalConfirmationControl = "1";
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>(".identity-modal button")) {
    const text = normalizedText(button);
    if (text === "Удалить" || text === "Удалить группу" || text === "Отключить") {
      button.dataset.portalConfirmationControl = "1";
    }
  }
}

function retryLegacyAction(resolveButton: () => HTMLButtonElement | null, modalSelector: string, attempt = 0): void {
  if (document.querySelector(modalSelector)) return;
  const button = resolveButton();
  if (button && !button.disabled) button.click();
  if (attempt < 12) window.setTimeout(() => retryLegacyAction(resolveButton, modalSelector, attempt + 1), 50);
}

export default function FreeIpaLegacyActionBridge() {
  useEffect(() => {
    markFreeIpaConfirmationHandled();
    const observer = new MutationObserver(markFreeIpaConfirmationHandled);
    observer.observe(document.body, { childList: true, subtree: true });

    const handleClick = (event: MouseEvent) => {
      const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>("button");
      if (!button) return;

      const memberRow = button.closest(".freeipa-group-member-row");
      if (memberRow && normalizedText(button) === "Удалить") {
        const uid = memberRow.querySelector("code")?.textContent?.trim() ?? "";
        if (uid) markLegacyMemberRemovalConfirmed(uid);
        return;
      }

      if (!button.closest(".freeipa-user-browser-shell")) return;
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

    document.addEventListener("click", handleClick, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
    };
  }, []);

  return null;
}
