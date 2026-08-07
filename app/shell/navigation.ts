export type ProductNavItemId =
  | "overview"
  | "users"
  | "groups"
  | "catalog"
  | "operations"
  | "approvals"
  | "access"
  | "sessions"
  | "audit"
  | "diagnostics"
  | "settings";

export type ProductNavIconName =
  | "dashboard"
  | "users"
  | "groups"
  | "workflow"
  | "activity"
  | "approval"
  | "access"
  | "sessions"
  | "audit"
  | "diagnostics"
  | "settings";

export interface ProductNavItem {
  id: ProductNavItemId;
  label: string;
  href: string;
  icon: ProductNavIconName;
}

export interface ProductNavGroup {
  id: "overview" | "directory" | "automation" | "security" | "system" | "settings";
  label?: string;
  items: readonly ProductNavItem[];
}

export const PRODUCT_NAV_GROUPS: readonly ProductNavGroup[] = [
  {
    id: "overview",
    items: [{ id: "overview", label: "Обзор", href: "/", icon: "dashboard" }],
  },
  {
    id: "directory",
    label: "DIRECTORY",
    items: [
      { id: "users", label: "Пользователи", href: "/users", icon: "users" },
      { id: "groups", label: "Группы", href: "/groups", icon: "groups" },
    ],
  },
  {
    id: "automation",
    label: "AUTOMATION",
    items: [
      { id: "catalog", label: "Каталог", href: "/automation", icon: "workflow" },
      { id: "operations", label: "Операции", href: "/operations", icon: "activity" },
      { id: "approvals", label: "Согласования", href: "/approvals", icon: "approval" },
    ],
  },
  {
    id: "security",
    label: "SECURITY",
    items: [
      { id: "access", label: "Доступ", href: "/access", icon: "access" },
      { id: "sessions", label: "Сессии", href: "/sessions", icon: "sessions" },
      { id: "audit", label: "Аудит", href: "/audit", icon: "audit" },
    ],
  },
  {
    id: "system",
    label: "SYSTEM",
    items: [{ id: "diagnostics", label: "Диагностика", href: "/diagnostics", icon: "diagnostics" }],
  },
  {
    id: "settings",
    items: [{ id: "settings", label: "Настройки", href: "/settings", icon: "settings" }],
  },
] as const;

export function normalizeProductPath(path: string): string {
  const clean = path.split(/[?#]/, 1)[0] || "/";
  return clean === "/" ? "/" : clean.replace(/\/+$/, "") || "/";
}

export function isProductNavItemActive(item: ProductNavItem, currentPath: string): boolean {
  const path = normalizeProductPath(currentPath);
  if (item.id === "overview") return path === "/";
  if (item.id === "catalog") return path === "/automation" || path.startsWith("/automation/");
  return path === item.href;
}
