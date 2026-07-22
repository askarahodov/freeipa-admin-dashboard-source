export type DashboardSettings = {
  freeipa: {
    url: string;
    realm: string;
    timeout: string;
    serviceAccount: string;
  };
  xyops: {
    url: string;
    apiKey: string;
  };
};

export const DEFAULT_SETTINGS: DashboardSettings = {
  freeipa: {
    url: "https://ipa.company.local",
    realm: "COMPANY.LOCAL",
    timeout: "30",
    serviceAccount: "xyops-freeipa-reader",
  },
  xyops: {
    url: "https://xyops.company.local",
    apiKey: "xyops-secret-key",
  },
};

const STORAGE_KEY = "freeipa-admin-dashboard-settings";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeSettings(value: unknown): DashboardSettings {
  if (!isPlainObject(value)) {
    return DEFAULT_SETTINGS;
  }

  const freeipa = isPlainObject(value.freeipa) ? value.freeipa : {};
  const xyops = isPlainObject(value.xyops) ? value.xyops : {};

  return {
    freeipa: {
      url: typeof freeipa.url === "string" ? freeipa.url : DEFAULT_SETTINGS.freeipa.url,
      realm: typeof freeipa.realm === "string" ? freeipa.realm : DEFAULT_SETTINGS.freeipa.realm,
      timeout: typeof freeipa.timeout === "string" ? freeipa.timeout : DEFAULT_SETTINGS.freeipa.timeout,
      serviceAccount: typeof freeipa.serviceAccount === "string" ? freeipa.serviceAccount : DEFAULT_SETTINGS.freeipa.serviceAccount,
    },
    xyops: {
      url: typeof xyops.url === "string" ? xyops.url : DEFAULT_SETTINGS.xyops.url,
      apiKey: typeof xyops.apiKey === "string" ? xyops.apiKey : DEFAULT_SETTINGS.xyops.apiKey,
    },
  };
}

export function loadSettings(storage: StorageLike | null | undefined = typeof window !== "undefined" ? window.localStorage : null): DashboardSettings {
  if (!storage) return DEFAULT_SETTINGS;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeSettings(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: DashboardSettings, storage: StorageLike | null | undefined = typeof window !== "undefined" ? window.localStorage : null): DashboardSettings {
  const sanitized = sanitizeSettings(settings);
  if (storage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  }
  return sanitized;
}

export function clearSettings(storage: StorageLike | null | undefined = typeof window !== "undefined" ? window.localStorage : null) {
  if (storage) {
    storage.removeItem(STORAGE_KEY);
  }
}
