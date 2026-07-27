"use client";

import { useEffect } from "react";

const userRefreshSelector = ".freeipa-user-browser-head button";
const memberRefreshSelector = ".freeipa-group-member-summary button";

function refreshButton(selector: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
    .find((button) => !button.disabled && button.textContent?.includes("Обновить")) ?? null;
}

function triggerRefresh(selector: string): void {
  const run = () => refreshButton(selector)?.click();
  run();
  window.setTimeout(run, 150);
  window.setTimeout(run, 500);
  window.setTimeout(run, 1_000);
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

    const synchronize = () => {
      scheduled = 0;
      const pathname = window.location.pathname;
      const modalOpen = Boolean(document.querySelector(".dynamic-modal"));
      const modalJustClosed = freeIpaModalOpen && !modalOpen;

      const nextUsers = textSignature(".section-page .data-table .tr.users-row:not(.th)");
      if (pathname === "/users" && usersSignature && nextUsers !== usersSignature) {
        triggerRefresh(userRefreshSelector);
      }
      usersSignature = nextUsers;

      const nextMembers = textSignature(".identity-modal .member-table > div");
      if (pathname === "/groups" && membersSignature && nextMembers !== membersSignature) {
        triggerRefresh(memberRefreshSelector);
      }
      membersSignature = nextMembers;

      if (modalJustClosed) {
        if (pathname === "/users") triggerRefresh(userRefreshSelector);
        if (pathname === "/groups") triggerRefresh(memberRefreshSelector);
      }
      freeIpaModalOpen = modalOpen;
    };

    const schedule = () => {
      if (scheduled) window.clearTimeout(scheduled);
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
    };
  }, []);

  return null;
}
