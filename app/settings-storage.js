const STORAGE_KEY = "freeipa-admin-dashboard-settings";

const DEFAULT_SETTINGS = {
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

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeSettings(value) {
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

function loadSettings(storage = typeof window !== "undefined" ? window.localStorage : null) {
  if (!storage) return DEFAULT_SETTINGS;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings, storage = typeof window !== "undefined" ? window.localStorage : null) {
  const sanitized = sanitizeSettings(settings);
  if (storage) {
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
  }
  return sanitized;
}

function clearSettings(storage = typeof window !== "undefined" ? window.localStorage : null) {
  if (storage) {
    storage.removeItem(STORAGE_KEY);
  }
}

export { DEFAULT_SETTINGS, loadSettings, saveSettings, clearSettings, STORAGE_KEY };
export default { DEFAULT_SETTINGS, loadSettings, saveSettings, clearSettings, STORAGE_KEY };
