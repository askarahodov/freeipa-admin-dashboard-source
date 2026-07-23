import type { CatalogEvent } from "./automation-types";

export type LocalizedProcessPresentationOverride = {
  title?: string;
  description?: string;
  category?: string;
  help?: string;
};

export type ProcessPresentationOverride = LocalizedProcessPresentationOverride & {
  icon?: string;
  order?: number;
  locales?: Record<string, LocalizedProcessPresentationOverride>;
};

export type ProcessPresentationSet = {
  version: 1;
  defaultLocale?: string;
  processes: Record<string, ProcessPresentationOverride>;
};

export type ProcessPresentationState = {
  metadata: ProcessPresentationSet;
  source: "database" | "environment" | "default";
  updatedAt: number | null;
};

type PresentationEnv = {
  DB?: D1Database;
  PORTAL_PROCESS_METADATA_JSON?: string;
};

const emptyMetadata: ProcessPresentationSet = { version: 1, processes: {} };
const createPresentationTable = `CREATE TABLE IF NOT EXISTS process_presentation_sets (
  id TEXT PRIMARY KEY NOT NULL,
  metadata_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
)`;

function cleanText(value: unknown, limit: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function processId(value: unknown): string {
  const normalized = cleanText(value, 240);
  if (!normalized || !/^[A-Za-z0-9_.:@/-]+$/.test(normalized)) throw new Error("Process metadata contains an invalid process ID");
  return normalized;
}

function optionalText(value: unknown, limit: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = cleanText(value, limit);
  return normalized || undefined;
}

function iconValue(value: unknown): string | undefined {
  const icon = optionalText(value, 40);
  if (!icon) return undefined;
  if (!/^[a-z0-9_-]+$/i.test(icon)) throw new Error("Process icon must be a symbolic key such as database, backup or security");
  return icon.toLowerCase();
}

function orderValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const order = Number(value);
  if (!Number.isInteger(order) || order < -100000 || order > 100000) throw new Error("Process order must be an integer between -100000 and 100000");
  return order;
}

export function normalizeProcessPresentationLocale(value: unknown): string | null {
  const locale = cleanText(value, 40);
  if (!locale || !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(locale)) return null;
  try { return Intl.getCanonicalLocales(locale)[0] ?? null; }
  catch { return null; }
}

function localizedOverride(value: unknown, context: string): LocalizedProcessPresentationOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${context} must be an object`);
  const item = value as Record<string, unknown>;
  return {
    title: optionalText(item.title, 240),
    description: optionalText(item.description, 1200),
    category: optionalText(item.category, 120),
    help: optionalText(item.help, 4000),
  };
}

export function sanitizeProcessPresentationSet(value: unknown): ProcessPresentationSet {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Process metadata must be an object");
  const source = value as Record<string, unknown>;
  if (source.version !== 1) throw new Error("Process metadata version must be 1");
  if (!source.processes || typeof source.processes !== "object" || Array.isArray(source.processes)) throw new Error("Process metadata processes must be an object");
  const entries = Object.entries(source.processes as Record<string, unknown>);
  if (entries.length > 500) throw new Error("Process metadata supports at most 500 processes");
  const defaultLocale = source.defaultLocale === undefined ? undefined : normalizeProcessPresentationLocale(source.defaultLocale);
  if (source.defaultLocale !== undefined && !defaultLocale) throw new Error("Process metadata defaultLocale must be a valid BCP 47 locale such as ru, en or en-GB");
  const processes: Record<string, ProcessPresentationOverride> = {};
  let localeEntries = 0;
  for (const [rawId, rawOverride] of entries) {
    const id = processId(rawId);
    if (!rawOverride || typeof rawOverride !== "object" || Array.isArray(rawOverride)) throw new Error(`Process metadata for ${id} must be an object`);
    const item = rawOverride as Record<string, unknown>;
    const locales: Record<string, LocalizedProcessPresentationOverride> = {};
    if (item.locales !== undefined) {
      if (!item.locales || typeof item.locales !== "object" || Array.isArray(item.locales)) throw new Error(`Process metadata locales for ${id} must be an object`);
      const localizedEntries = Object.entries(item.locales as Record<string, unknown>);
      if (localizedEntries.length > 50) throw new Error(`Process metadata for ${id} supports at most 50 locales`);
      for (const [rawLocale, rawLocalized] of localizedEntries) {
        const locale = normalizeProcessPresentationLocale(rawLocale);
        if (!locale) throw new Error(`Process metadata locale ${rawLocale} for ${id} is invalid`);
        const sanitizedLocale = localizedOverride(rawLocalized, `Process metadata locale ${locale} for ${id}`);
        if (Object.values(sanitizedLocale).some((entry) => entry !== undefined)) locales[locale] = sanitizedLocale;
        localeEntries += 1;
        if (localeEntries > 5000) throw new Error("Process metadata supports at most 5000 localized process entries");
      }
    }
    const sanitized: ProcessPresentationOverride = {
      ...localizedOverride(item, `Process metadata for ${id}`),
      icon: iconValue(item.icon),
      order: orderValue(item.order),
      locales: Object.keys(locales).length ? locales : undefined,
    };
    if (Object.values(sanitized).some((entry) => entry !== undefined)) processes[id] = sanitized;
  }
  return { version: 1, defaultLocale, processes };
}

function envMetadata(value: string | undefined): ProcessPresentationSet | null {
  if (!value) return null;
  try { return sanitizeProcessPresentationSet(JSON.parse(value)); }
  catch { return null; }
}

async function ensureTable(env: PresentationEnv): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(createPresentationTable).run();
}

export async function readProcessPresentationSet(env: PresentationEnv): Promise<ProcessPresentationState> {
  if (env.DB) {
    await ensureTable(env);
    const row = await env.DB.prepare("SELECT metadata_json, updated_at FROM process_presentation_sets WHERE id = ?").bind("current").first<{ metadata_json: string; updated_at: number }>();
    if (row) {
      try { return { metadata: sanitizeProcessPresentationSet(JSON.parse(row.metadata_json)), source: "database", updatedAt: Number(row.updated_at) }; }
      catch { /* Invalid persisted metadata falls back safely. */ }
    }
  }
  const configured = envMetadata(env.PORTAL_PROCESS_METADATA_JSON);
  return configured
    ? { metadata: configured, source: "environment", updatedAt: null }
    : { metadata: emptyMetadata, source: "default", updatedAt: null };
}

export async function saveProcessPresentationSet(env: PresentationEnv, value: unknown): Promise<ProcessPresentationState> {
  if (!env.DB) throw new Error("Persistent database is unavailable");
  const metadata = sanitizeProcessPresentationSet(value);
  const updatedAt = Date.now();
  await ensureTable(env);
  await env.DB.prepare("INSERT INTO process_presentation_sets (id, metadata_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET metadata_json = excluded.metadata_json, updated_at = excluded.updated_at")
    .bind("current", JSON.stringify(metadata), updatedAt).run();
  return { metadata, source: "database", updatedAt };
}

function localeChain(locale: string | null | undefined): string[] {
  const normalized = normalizeProcessPresentationLocale(locale);
  if (!normalized) return [];
  const parts = normalized.split("-");
  return parts.map((_, index) => parts.slice(0, index + 1).join("-"));
}

export function presentationLocalePreferences(explicitLocale: unknown, acceptLanguage: unknown): string[] {
  const values: Array<{ locale: string; quality: number; order: number }> = [];
  const explicit = normalizeProcessPresentationLocale(explicitLocale);
  if (explicit) values.push({ locale: explicit, quality: 2, order: -1 });
  const header = String(acceptLanguage ?? "").slice(0, 1000);
  header.split(",").slice(0, 30).forEach((entry, index) => {
    const [rawLocale, ...parameters] = entry.trim().split(";");
    if (!rawLocale || rawLocale === "*") return;
    const locale = normalizeProcessPresentationLocale(rawLocale);
    if (!locale) return;
    const qualityValue = parameters.map((parameter) => parameter.trim()).find((parameter) => /^q=/i.test(parameter));
    const quality = qualityValue ? Number(qualityValue.slice(2)) : 1;
    if (!Number.isFinite(quality) || quality <= 0 || quality > 1) return;
    values.push({ locale, quality, order: index });
  });
  values.sort((left, right) => right.quality - left.quality || left.order - right.order);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of values) {
    if (seen.has(item.locale)) continue;
    seen.add(item.locale);
    result.push(item.locale);
    if (result.length >= 12) break;
  }
  return result;
}

export function availableProcessPresentationLocales(metadata: ProcessPresentationSet): string[] {
  const locales = new Set<string>();
  const defaultLocale = normalizeProcessPresentationLocale(metadata.defaultLocale);
  if (defaultLocale) locales.add(defaultLocale);
  for (const override of Object.values(metadata.processes)) {
    for (const locale of Object.keys(override.locales ?? {})) {
      const normalized = normalizeProcessPresentationLocale(locale);
      if (normalized) locales.add(normalized);
    }
  }
  return Array.from(locales).sort((left, right) => left.localeCompare(right));
}

export function resolveProcessPresentationLocale(metadata: ProcessPresentationSet, preferences: string[]): string | null {
  const available = new Set(availableProcessPresentationLocales(metadata));
  for (const preference of preferences) {
    const chain = localeChain(preference);
    for (let index = chain.length - 1; index >= 0; index -= 1) {
      if (available.has(chain[index])) return chain[index];
    }
  }
  const fallback = localeChain(metadata.defaultLocale);
  for (let index = fallback.length - 1; index >= 0; index -= 1) {
    if (available.has(fallback[index])) return fallback[index];
  }
  return null;
}

export function applyProcessPresentation(events: CatalogEvent[], metadata: ProcessPresentationSet, preferences: string[] = []): CatalogEvent[] {
  const resolvedLocale = resolveProcessPresentationLocale(metadata, preferences);
  return events.map((event) => {
    const override = metadata.processes[event.id];
    if (!override) return { ...event };
    const localized: LocalizedProcessPresentationOverride = {};
    const mergeLocalized = (source: LocalizedProcessPresentationOverride | undefined) => {
      if (!source) return;
      if (source.title !== undefined) localized.title = source.title;
      if (source.description !== undefined) localized.description = source.description;
      if (source.category !== undefined) localized.category = source.category;
      if (source.help !== undefined) localized.help = source.help;
    };
    for (const locale of localeChain(metadata.defaultLocale)) mergeLocalized(override.locales?.[locale]);
    if (resolvedLocale) for (const locale of localeChain(resolvedLocale)) mergeLocalized(override.locales?.[locale]);
    const presentationOverridden = Object.values(override).some((entry) => entry !== undefined);
    return {
      ...event,
      title: localized.title ?? override.title ?? event.title,
      description: localized.description ?? override.description ?? event.description,
      category: localized.category ?? override.category ?? event.category,
      icon: override.icon ?? event.icon,
      order: override.order ?? event.order,
      help: localized.help ?? override.help ?? event.help,
      presentationLocale: resolvedLocale ?? undefined,
      presentationOverridden,
    };
  }).sort((left, right) => {
    const order = (left.order ?? 0) - (right.order ?? 0);
    return order || `${left.category}\0${left.title}\0${left.id}`.localeCompare(`${right.category}\0${right.title}\0${right.id}`);
  });
}
