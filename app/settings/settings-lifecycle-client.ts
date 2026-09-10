export type SessionState = {
  authenticated?: boolean;
  user?: { role?: string; displayName?: string };
};

export type SettingField = "demoMode" | "ipaUrl" | "ipaUsername" | "ipaPassword" | "xyopsUrl" | "xyopsApiKey";

export type FieldSource = {
  value?: unknown;
  configured?: boolean;
  source: "database" | "environment" | "default";
  envName: string;
  envConfigured: boolean;
  overridden: boolean;
  resettable?: boolean;
  fallbackSource?: "environment" | "default";
};

export type EffectiveSettings = {
  revision: number;
  overrideCount?: number;
  conflictCount?: number;
  settings: {
    updatedAt?: number | null;
    demoMode: boolean;
    freeipa: { url: string; username: string; passwordConfigured: boolean };
    xyops: { url: string; apiKeyConfigured: boolean };
  };
  fields: Record<SettingField, FieldSource>;
};

export type SettingsDraft = {
  id: string;
  baseRevision?: number;
  status: string;
  diff?: Array<{ field?: string; before?: unknown; after?: unknown; secret?: boolean; reset?: boolean; source?: string }>;
  validation?: { ok?: boolean; services?: Array<{ service: string; ok: boolean; latencyMs?: number; error?: string }> };
};

export type SettingsApiError = Error & {
  status?: number;
  payload?: { draft?: SettingsDraft; rolledBack?: boolean; code?: string };
};

export async function requestSettingsJson(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { cache: "no-store", ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data.error || `HTTP ${response.status}`)) as SettingsApiError;
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

export async function loadAdminEffectiveSettings(): Promise<{ session: SessionState; effective: EffectiveSettings | null }> {
  const session = await requestSettingsJson("/api/auth/session") as SessionState;
  if (!session.authenticated || session.user?.role !== "admin") return { session, effective: null };
  const effective = await requestSettingsJson("/api/integrations/settings/effective") as EffectiveSettings;
  return { session, effective };
}

export async function createSettingsDraft(baseRevision: number, changes: Record<string, unknown>): Promise<SettingsDraft> {
  const data = await requestSettingsJson("/api/integrations/settings/drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ baseRevision, changes }),
  }) as { draft: SettingsDraft };
  return data.draft;
}

export async function validateSettingsDraft(draftId: string): Promise<SettingsDraft> {
  const data = await requestSettingsJson(`/api/integrations/settings/drafts/${encodeURIComponent(draftId)}/validate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  }) as { draft: SettingsDraft };
  return data.draft;
}

export async function applySettingsDraft(draftId: string): Promise<unknown> {
  return requestSettingsJson(`/api/integrations/settings/drafts/${encodeURIComponent(draftId)}/apply`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}

export async function cancelSettingsDraft(draftId: string): Promise<void> {
  await requestSettingsJson(`/api/integrations/settings/drafts/${encodeURIComponent(draftId)}/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
}
