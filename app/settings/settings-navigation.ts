export const settingsSections = [
  { id: "general", label: "Общие", path: "/settings/general" },
  { id: "integrations", label: "Интеграции", path: "/settings/integrations" },
  { id: "catalog", label: "Каталог", path: "/settings/catalog" },
  { id: "visibility", label: "Видимость", path: "/settings/visibility" },
  { id: "approvals", label: "Согласования", path: "/settings/approvals" },
  { id: "presentation", label: "Представление", path: "/settings/presentation" },
  { id: "access", label: "Доступ", path: "/settings/access" },
  { id: "diagnostics", label: "Диагностика", path: "/settings/diagnostics" },
  { id: "advanced", label: "Расширенные", path: "/settings/advanced" },
] as const;

export type SettingsSectionId = (typeof settingsSections)[number]["id"];

const byId = new Map<SettingsSectionId, (typeof settingsSections)[number]>(
  settingsSections.map((section) => [section.id, section]),
);

const legacyTabAliases: Readonly<Record<string, SettingsSectionId>> = Object.freeze({
  general: "general",
  integrations: "integrations",
  freeipa: "integrations",
  xyops: "integrations",
  catalog: "catalog",
  visibility: "visibility",
  policies: "visibility",
  approvals: "approvals",
  presentation: "presentation",
  access: "access",
  diagnostics: "diagnostics",
  advanced: "advanced",
});

export function buildSettingsPath(section: SettingsSectionId): string {
  return byId.get(section)?.path ?? "/settings/general";
}

export function resolveSettingsSection(pathname: string): SettingsSectionId | null {
  const normalized = pathname.replace(/\/+$/u, "") || "/";
  const match = settingsSections.find((section) => section.path === normalized);
  return match?.id ?? null;
}

export function resolveLegacySettingsTab(tab: string | null | undefined): SettingsSectionId | null {
  if (!tab) return null;
  const normalized = tab.trim().toLowerCase();
  return Object.hasOwn(legacyTabAliases, normalized) ? legacyTabAliases[normalized] : null;
}

export function resolveLegacySettingsRedirect(tab: string | null | undefined): string {
  const section = resolveLegacySettingsTab(tab) ?? "general";
  return buildSettingsPath(section);
}
