"use client";

import { useEffect } from "react";

const userRefreshSelector = ".freeipa-user-browser-head button";
const memberRefreshSelector = ".freeipa-group-member-summary button";
const userSignatureSelector = ".section-page .data-table .tr.users-row:not(.th)";
const memberSignatureSelector = ".identity-modal .member-table > div";
const refreshDelaysMs = [0, 150, 500, 1_000] as const;

function refreshButton(selector: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
    .find((button) => !button.disabled && button.textContent?.includes("Обновить")) ?? null;
}

function textSignature(selector: string): string {
  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .map((node) => node.textContent?.replace(/\s+/g, " ").trim() ?? "")
    .join("\n");
}

export default function FreeIpaDirectorySync() {
  useEffect(() => {
    let usersSignature = "";
    let membersSignature = "";
    let freeIpaModalOpen = Boolean(document.querySelector(".dynamic-modal"));
    let scheduled = 0;
    const refreshTimers = new Map<string, Set<number>>();

    const clearRefreshTimers = (selector: string): void => {
      const timers = refreshTimers.get(selector);
      if (!timers) return;
      for (const timer of timers) window.clearTimeout(timer);
      refreshTimers.delete(selector);
    };

    const triggerRefresh = (selector: string): void => {
      clearRefreshTimers(selector);
      const timers = new Set<number>();
      refreshTimers.set(selector, timers);

      for (const delay of refreshDelaysMs) {
        if (delay === 0) {
          refreshButton(selector)?.click();
          continue;
        }

        const timer = window.setTimeout(() => {
          timers.delete(timer);
          refreshButton(selector)?.click();
          if (timers.size === 0) refreshTimers.delete(selector);
        }, delay);
        timers.add(timer);
      }
    };

    const synchronize = () => {
      scheduled = 0;
      const pathname = window.location.pathname;
      const modalOpen = Boolean(document.querySelector(".dynamic-modal"));
      const modalJustClosed = freeIpaModalOpen && !modalOpen;
      const refreshSelectors = new Set<string>();

      const nextUsers = textSignature(userSignatureSelector);
      if (pathname === "/users" && usersSignature && nextUsers !== usersSignature) {
        refreshSelectors.add(userRefreshSelector);
      }
      usersSignature = nextUsers;

      const nextMembers = textSignature(memberSignatureSelector);
      if (pathname === "/groups" && membersSignature && nextMembers !== membersSignature) {
        refreshSelectors.add(memberRefreshSelector);
      }
      membersSignature = nextMembers;

      if (modalJustClosed) {
        if (pathname === "/users") refreshSelectors.add(userRefreshSelector);
        if (pathname === "/groups") refreshSelectors.add(memberRefreshSelector);
      }
      freeIpaModalOpen = modalOpen;

      for (const selector of refreshSelectors) triggerRefresh(selector);
    };

    const schedule = () => {
      if (scheduled) return;
      scheduled = window.setTimeout(synchronize, 60);
    };

    synchronize();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("popstate", schedule);

    return () => {
      observer.disconnect();
      window.removeEventListener("popstate", schedule);
      if (scheduled) window.clearTimeout(scheduled);
      for (const selector of refreshTimers.keys()) clearRefreshTimers(selector);
    };
  }, []);

  return null;
}
