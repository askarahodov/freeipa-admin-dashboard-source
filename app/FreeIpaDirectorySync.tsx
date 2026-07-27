"use client";

import { useEffect } from "react";

function refreshButton(selector: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
    .find((button) => !button.disabled && button.textContent?.includes("Обновить")) ?? null;
}

function triggerRefresh(selector: string): void {
  const run = () => refreshButton(selector)?.click();
  run();
  window.setTimeout(run, 150);
  window.setTimeout(run, 500);
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
    let scheduled = 0;

    const synchronize = () => {
      scheduled = 0;
      const pathname = window.location.pathname;

      const nextUsers = textSignature(".section-page .data-table .tr.users-row:not(.th)");
      if (pathname === "/users" && usersSignature && nextUsers !== usersSignature) {
        triggerRefresh(".freeipa-user-browser-head button");
      }
      usersSignature = nextUsers;

      const nextMembers = textSignature(".identity-modal .member-table > div");
      if (pathname === "/groups" && membersSignature && nextMembers !== membersSignature) {
        triggerRefresh(".freeipa-group-member-summary button");
      }
      membersSignature = nextMembers;
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
    };
  }, []);

  return null;
}
