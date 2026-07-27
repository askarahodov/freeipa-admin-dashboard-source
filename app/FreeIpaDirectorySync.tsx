"use client";

import { useEffect } from "react";

function visibleRefreshButton(selector: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll<HTMLButtonElement>(selector))
    .find((button) => !button.disabled && button.getClientRects().length > 0 && button.textContent?.includes("Обновить")) ?? null;
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
        visibleRefreshButton(".freeipa-user-browser-head button")?.click();
      }
      usersSignature = nextUsers;

      const nextMembers = textSignature(".identity-modal .member-table > div");
      if (pathname === "/groups" && membersSignature && nextMembers !== membersSignature) {
        visibleRefreshButton(".freeipa-group-member-summary button")?.click();
      }
      membersSignature = nextMembers;
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
