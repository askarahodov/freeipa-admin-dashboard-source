import type { CatalogEvent } from "./automation-types";

export type CatalogPolicyEffect = "allow" | "deny";
export type CatalogPolicyRole = "viewer" | "operator" | "admin";

export type CatalogVisibilityRule = {
  id: string;
  effect: CatalogPolicyEffect;
  users: string[];
  groups: string[];
  roles: CatalogPolicyRole[];
  categories: string[];
  processes: string[];
};

export type CatalogPolicySet = {
  version: 1;
  defaultEffect: CatalogPolicyEffect;
  adminBypass: boolean;
  rules: CatalogVisibilityRule[];
};

export type CatalogPolicySubject = {
  identity: string;
  role: CatalogPolicyRole;
  groups: string[];
};

type PolicyEnv = {
  DB?: D1Database;
  PORTAL_CATALOG_POLICIES_JSON?: string;
};

const defaultPolicy: CatalogPolicySet = {
  version: 1,
  defaultEffect: "allow",
  adminBypass: true,
  rules: [],
};

const createPolicyTable = `CREATE TABLE IF NOT EXISTS catalog_visibility_policies (
  id TEXT PRIMARY KEY NOT NULL,
  policy_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

function cleanText(value: unknown, limit = 160): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, limit);
}

function normalizedIdentity(value: unknown): string {
  const normalized = cleanText(value, 160).toLowerCase();
  return normalized && normalized.includes("@") && !/[\s,]/.test(normalized) ? normalized : "";
}

function normalizedGroup(value: unknown): string {
  const normalized = cleanText(value, 120).toLowerCase();
  return normalized && !/[,\r\n]/.test(normalized) ? normalized : "";
}

function normalizedCategory(value: unknown): string {
  return cleanText(value, 160).toLowerCase();
}

function normalizedProcess(value: unknown): string {
  return cleanText(value, 160);
}

function uniqueValues<T>(values: T[], limit: number): T[] {
  return Array.from(new Set(values)).slice(0, limit);
}

function stringArray(value: unknown, normalize: (item: unknown) => string, limit = 100): string[] {
  if (!Array.isArray(value)) return [];
  return uniqueValues(value.map(normalize).filter(Boolean), limit);
}

function roleArray(value: unknown): CatalogPolicyRole[] {
  if (!Array.isArray(value)) return [];
  return uniqueValues(value.filter((item): item is CatalogPolicyRole => item === "viewer" || item === "operator" || item === "admin"), 3);
}

export function sanitizeCatalogPolicySet(value: unknown): CatalogPolicySet {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Policy must be a JSON object");
  const source = value as Record<string, unknown>;
  const defaultEffect = source.defaultEffect === "deny" ? "deny" : source.defaultEffect === "allow" || source.defaultEffect === undefined ? "allow" : null;
  if (!defaultEffect) throw new Error("defaultEffect must be allow or deny");
  if (source.rules !== undefined && !Array.isArray(source.rules)) throw new Error("rules must be an array");
  const rawRules = Array.isArray(source.rules) ? source.rules.slice(0, 200) : [];
  const rules: CatalogVisibilityRule[] = rawRules.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`Rule ${index + 1} must be an object`);
    const rule = raw as Record<string, unknown>;
    if (rule.effect !== "allow" && rule.effect !== "deny") throw new Error(`Rule ${index + 1}: effect must be allow or deny`);
    const id = cleanText(rule.id, 120) || `rule-${index + 1}`;
    const users = stringArray(rule.users, normalizedIdentity);
    const groups = stringArray(rule.groups, normalizedGroup);
    const roles = roleArray(rule.roles);
    const categories = stringArray(rule.categories, normalizedCategory);
    const processes = stringArray(rule.processes, normalizedProcess);
    if (!users.length && !groups.length && !roles.length && rule.subjects !== undefined) throw new Error(`Rule ${id}: subjects are invalid`);
    return { id, effect: rule.effect, users, groups, roles, categories, processes };
  });
  const ids = new Set<string>();
  for (const rule of rules) {
    if (ids.has(rule.id)) throw new Error(`Duplicate policy rule id: ${rule.id}`);
    ids.add(rule.id);
  }
  return {
    version: 1,
    defaultEffect,
    adminBypass: source.adminBypass !== false,
    rules,
  };
}

function subjectMatches(rule: CatalogVisibilityRule, subject: CatalogPolicySubject): boolean {
  if (!rule.users.length && !rule.groups.length && !rule.roles.length) return true;
  if (rule.users.includes(subject.identity.toLowerCase())) return true;
  if (rule.roles.includes(subject.role)) return true;
  const subjectGroups = new Set(subject.groups.map((group) => group.toLowerCase()));
  return rule.groups.some((group) => subjectGroups.has(group));
}

function resourceMatches(rule: CatalogVisibilityRule, event: Pick<CatalogEvent, "id" | "category">): boolean {
  if (!rule.categories.length && !rule.processes.length) return true;
  if (rule.processes.includes(event.id)) return true;
  return rule.categories.includes(String(event.category ?? "").trim().toLowerCase());
}

export function catalogEventAllowed(policy: CatalogPolicySet, subject: CatalogPolicySubject, event: Pick<CatalogEvent, "id" | "category">): boolean {
  if (policy.adminBypass && subject.role === "admin") return true;
  const matching = policy.rules.filter((rule) => subjectMatches(rule, subject) && resourceMatches(rule, event));
  if (matching.some((rule) => rule.effect === "deny")) return false;
  if (matching.some((rule) => rule.effect === "allow")) return true;
  return policy.defaultEffect === "allow";
}

async function ensurePolicyTable(env: PolicyEnv): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(createPolicyTable).run();
}

export async function readCatalogPolicySet(env: PolicyEnv): Promise<{ policy: CatalogPolicySet; source: "database" | "environment" | "default"; updatedAt: number | null }> {
  if (env.DB) {
    await ensurePolicyTable(env);
    const row = await env.DB.prepare("SELECT policy_json, updated_at FROM catalog_visibility_policies WHERE id = ?")
      .bind("current").first<{ policy_json: string; updated_at: number }>();
    if (row) {
      try {
        return { policy: sanitizeCatalogPolicySet(JSON.parse(row.policy_json)), source: "database", updatedAt: Number(row.updated_at) };
      } catch {
        throw new Error("Stored catalog visibility policy is invalid");
      }
    }
  }
  if (env.PORTAL_CATALOG_POLICIES_JSON) {
    try {
      return { policy: sanitizeCatalogPolicySet(JSON.parse(env.PORTAL_CATALOG_POLICIES_JSON)), source: "environment", updatedAt: null };
    } catch (error) {
      throw new Error(error instanceof Error ? `PORTAL_CATALOG_POLICIES_JSON: ${error.message}` : "PORTAL_CATALOG_POLICIES_JSON is invalid");
    }
  }
  return { policy: defaultPolicy, source: "default", updatedAt: null };
}

export async function saveCatalogPolicySet(env: PolicyEnv, value: unknown): Promise<{ policy: CatalogPolicySet; updatedAt: number }> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  const policy = sanitizeCatalogPolicySet(value);
  const updatedAt = Date.now();
  await ensurePolicyTable(env);
  await env.DB.prepare("INSERT INTO catalog_visibility_policies (id, policy_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET policy_json = excluded.policy_json, updated_at = excluded.updated_at")
    .bind("current", JSON.stringify(policy), updatedAt).run();
  return { policy, updatedAt };
}
