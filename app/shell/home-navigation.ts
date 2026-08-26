export type HomePage =
  | "overview"
  | "automation"
  | "users"
  | "groups"
  | "operations"
  | "approvals"
  | "audit"
  | "settings"
  | "showcase";

export interface HomeAutomationSection {
  category: string;
  slug: string;
}

export interface HomeLocation {
  page: HomePage;
  automationCategory: string;
}

export const HOME_PAGE_PATHS: Record<HomePage, string> = {
  overview: "/",
  automation: "/automation",
  users: "/users",
  groups: "/groups",
  operations: "/operations",
  approvals: "/approvals",
  audit: "/audit",
  settings: "/settings",
  showcase: "/showcase",
};

function normalizePath(pathname: string): string {
  const path = pathname.trim().replace(/\/+$/u, "");
  return path || "/";
}

export function resolveHomeLocation(
  pathname: string,
  automationSections: readonly HomeAutomationSection[],
): HomeLocation {
  const path = normalizePath(pathname);

  if (path === "/automation" || path.startsWith("/automation/")) {
    const slug = path.split("/")[2] ?? "";
    const section = automationSections.find((item) => item.slug === slug);
    return {
      page: "automation",
      automationCategory: section?.category ?? "all",
    };
  }

  const match = (Object.entries(HOME_PAGE_PATHS) as Array<[HomePage, string]>).find(
    ([, value]) => value === path,
  );

  return {
    page: match?.[0] ?? "overview",
    automationCategory: "all",
  };
}

export function buildHomePath(
  page: HomePage,
  automationCategory: string,
  automationSections: readonly HomeAutomationSection[],
): string {
  if (page !== "automation" || automationCategory === "all") return HOME_PAGE_PATHS[page];
  const section = automationSections.find((item) => item.category === automationCategory);
  return section ? `/automation/${section.slug}` : HOME_PAGE_PATHS.automation;
}
