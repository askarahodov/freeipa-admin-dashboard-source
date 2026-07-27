"use client";

import { useEffect } from "react";

const destructiveIdentityActions = new Set(["Удалить", "Удалить группу", "Отключить"]);
const retryDelayMs = 50;
const retryLimit = 12;

function normalizedText(element: HTMLElement): string {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

function elementsIncludingRoot<T extends Element>(root: ParentNode, selector: string): T[] {
  const elements = Array.from(root.querySelectorAll<T>(selector));
  if (root instanceof Element && root.matches(selector)) elements.unshift(root as T);
  return elements;
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

function markFreeIpaConfirmationControls(root: ParentNode = document): void {
  for (const modal of elementsIncludingRoot<HTMLElement>(root, ".dynamic-modal")) {
    if (!modal.querySelector(".danger-confirm")) continue;
    const submit = modal.querySelector<HTMLButtonElement>(".modal-actions button.primary");
    if (submit) submit.dataset.portalConfirmationControl = "1";
  }

  for (const button of elementsIncludingRoot<HTMLButtonElement>(root, ".identity-modal button")) {
    if (destructiveIdentityActions.has(normalizedText(button))) {
      button.dataset.portalConfirmationControl = "1";
    }
  }
}

export default function FreeIpaLegacyActionBridge() {
  useEffect(() => {
    const retryTimers = new Set<number>();

    const scheduleRetry = (
      resolveButton: () => HTMLButtonElement | null,
      modalSelector: string,
      attempt = 0,
    ): void => {
      if (document.querySelector(modalSelector)) return;
      const button = resolveButton();
      if (button && !button.disabled) button.click();
      if (attempt >= retryLimit) return;

      const timer = window.setTimeout(() => {
        retryTimers.delete(timer);
        scheduleRetry(resolveButton, modalSelector, attempt + 1);
      }, retryDelayMs);
      retryTimers.add(timer);
    };

    markFreeIpaConfirmationControls();
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) markFreeIpaConfirmationControls(node);
        }
      }
    });
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
        scheduleRetry(
          () => document.querySelector<HTMLButtonElement>(".section-page > .panel-title button.primary"),
          ".dynamic-modal",
        );
        return;
      }

      if (text !== "Карточка" && text !== "Редактировать") return;
      const row = button.closest("tr");
      const uid = row?.querySelector("code")?.textContent?.trim() ?? "";
      if (!uid) return;
      scheduleRetry(
        () => legacyUserButton(uid, text),
        text === "Карточка" ? ".identity-modal" : ".dynamic-modal",
      );
    };

    document.addEventListener("click", handleClick, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", handleClick, true);
      for (const timer of retryTimers) window.clearTimeout(timer);
      retryTimers.clear();
    };
  }, []);

  return null;
}
