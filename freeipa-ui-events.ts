export type FreeIpaOperation =
  | "user_add"
  | "user_mod"
  | "user_password"
  | "user_enable"
  | "user_disable"
  | "user_del"
  | "group_add"
  | "group_del"
  | "group_add_member"
  | "group_remove_member";

export type FreeIpaAction = {
  operation: FreeIpaOperation;
  title: string;
  preset: Record<string, string>;
  choices?: { users?: string[]; groups?: string[] };
};

export type FreeIpaAccess = {
  canWrite: boolean;
  canDelete: boolean;
};

export const FREEIPA_OPEN_ACTION_EVENT = "portal:freeipa:open-action";
export const FREEIPA_DIRECTORY_CHANGED_EVENT = "portal:freeipa:directory-changed";

export function openFreeIpaAction(action: FreeIpaAction): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<FreeIpaAction>(FREEIPA_OPEN_ACTION_EVENT, { detail: action }));
}

export function announceFreeIpaDirectoryChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(FREEIPA_DIRECTORY_CHANGED_EVENT));
}

export async function loadFreeIpaAccess(): Promise<FreeIpaAccess> {
  const response = await fetch("/api/integrations/status", { cache: "no-store" });
  if (!response.ok) return { canWrite: false, canDelete: false };
  const data = await response.json().catch(() => ({})) as { access?: { permissions?: unknown } };
  const permissions = Array.isArray(data.access?.permissions) ? data.access.permissions.map(String) : [];
  return {
    canWrite: permissions.includes("freeipa.write"),
    canDelete: permissions.includes("freeipa.delete"),
  };
}
