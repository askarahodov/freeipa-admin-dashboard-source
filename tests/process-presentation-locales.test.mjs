import assert from "node:assert/strict";
import test from "node:test";

import worker from "../dist/server/index.js";

class LocaleD1 {
  presentation = null;
  audits = [];

  prepare(sql) {
    let values = [];
    const statement = {
      bind: (...args) => { values = args; return statement; },
      run: async () => {
        if (sql.startsWith("INSERT INTO process_presentation_sets")) {
          this.presentation = { metadata_json: values[1], updated_at: values[2] };
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT INTO portal_audit_events")) {
          this.audits.push({ action: values[6], metadata_json: values[16] });
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      },
      first: async () => {
        if (sql.includes("FROM process_presentation_sets")) return this.presentation;
        if (sql.includes("FROM app_settings")) return null;
        return null;
      },
      all: async () => ({ results: [] }),
    };
    return statement;
  }
}

const metadata = {
  version: 1,
  defaultLocale: "ru",
  processes: {
    alpha: {
      title: "Fallback Alpha",
      description: "Fallback description",
      category: "Fallback category",
      icon: "backup",
      order: 10,
      help: "Fallback help",
      locales: {
        ru: { title: "Процесс Альфа", description: "Русское описание", category: "Самообслуживание", help: "Русская справка" },
        en: { title: "Alpha process", description: "English description", category: "Self-service", help: "English help" },
        "en-GB": { title: "Alpha process UK" },
      },
    },
    production: {
      locales: {
        en: { title: "Friendly production", category: "Friendly section" },
      },
    },
  },
};

const catalogResponse = {
  events: [
    { id: "alpha", title: "Source Alpha", description: "Source description", category: "General", user_fields: [] },
    { id: "production", title: "Source Production", description: "", category: "Production", user_fields: [] },
  ],
};

function env(identity = "operator@example.test", extra = {}) {
  return {
    PORTAL_IDENTITY_MODE: "static",
    PORTAL_STATIC_IDENTITY: identity,
    PORTAL_DEFAULT_ROLE: "viewer",
    PORTAL_RBAC_JSON: JSON.stringify({ "admin@example.test": "admin", "operator@example.test": "operator" }),
    ADMIN_TOKEN: "admin-secret",
    XYOPS_URL: "https://xyops.example.test",
    XYOPS_API_KEY: "xyops-secret",
    PORTAL_PROCESS_METADATA_JSON: JSON.stringify(metadata),
    ...extra,
  };
}

async function request(runtimeEnv, path, options = {}) {
  return worker.fetch(new Request(`https://portal.test${path}`, options), runtimeEnv, {});
}

test("resolves localized presentation from explicit locale and Accept-Language without changing source authorization", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.pathname.endsWith("/get_events/v1")) return Response.json(catalogResponse);
    if (url.pathname.endsWith("/run_event/v1")) return Response.json({ job_id: "locale_job", status: "queued" });
    return new Response("not found", { status: 404 });
  };

  try {
    let response = await request(env(), "/api/integrations/catalog");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-language"), "ru");
    assert.match(response.headers.get("vary") ?? "", /Accept-Language/i);
    let payload = await response.json();
    let alpha = payload.events.find((item) => item.id === "alpha");
    assert.equal(alpha.title, "Процесс Альфа");
    assert.equal(alpha.description, "Русское описание");
    assert.equal(alpha.category, "Самообслуживание");
    assert.equal(alpha.help, "Русская справка");
    assert.equal(alpha.presentationLocale, "ru");
    assert.equal(payload.presentation.locale, "ru");
    assert.deepEqual(payload.presentation.availableLocales, ["en", "en-GB", "ru"]);
    const schemaVersion = alpha.schemaVersion;

    response = await request(env(), "/api/integrations/catalog?locale=en-GB", { headers: { "accept-language": "ru" } });
    payload = await response.json();
    alpha = payload.events.find((item) => item.id === "alpha");
    assert.equal(response.headers.get("content-language"), "en-GB");
    assert.equal(alpha.title, "Alpha process UK", "exact locale must override base language");
    assert.equal(alpha.description, "English description", "missing exact field must fall back to base language");
    assert.equal(alpha.category, "Self-service");
    assert.equal(alpha.help, "English help");
    assert.equal(alpha.presentationLocale, "en-GB");
    assert.equal(alpha.schemaVersion, schemaVersion, "presentation locale must not alter schemaVersion");

    response = await request(env(), "/api/integrations/catalog", { headers: { "accept-language": "fr-CA, en;q=0.8, ru;q=0.4" } });
    payload = await response.json();
    alpha = payload.events.find((item) => item.id === "alpha");
    assert.equal(alpha.title, "Alpha process", "first supported Accept-Language entry must be selected");
    assert.equal(alpha.presentationLocale, "en");

    const denySourceCategory = {
      version: 1,
      defaultEffect: "allow",
      adminBypass: false,
      rules: [{ id: "deny-production", effect: "deny", users: [], groups: [], roles: ["operator"], categories: ["Production"], processes: [] }],
    };
    response = await request(env("operator@example.test", { PORTAL_CATALOG_POLICIES_JSON: JSON.stringify(denySourceCategory) }), "/api/integrations/catalog?locale=en");
    payload = await response.json();
    assert.equal(payload.events.some((item) => item.id === "production"), false, "localized category must not bypass source-category policy");

    response = await request(env(), "/api/integrations/catalog/run?locale=en", {
      method: "POST",
      headers: { "content-type": "application/json", "accept-language": "ru" },
      body: JSON.stringify({ eventId: "alpha", values: {}, targets: [] }),
    });
    assert.equal(response.status, 202);
    payload = await response.json();
    assert.equal(payload.process.title, "Alpha process", "new runs must store the presentation visible to the requester");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("canonicalizes and validates localized metadata through the admin API", async () => {
  const db = new LocaleD1();
  const runtimeEnv = env("admin@example.test", { DB: db, PORTAL_PROCESS_METADATA_JSON: undefined });
  const submitted = {
    version: 1,
    defaultLocale: "RU",
    processes: {
      alpha: {
        locales: {
          "en-gb": { title: "Alpha UK" },
          ru: { title: "Альфа" },
        },
      },
    },
  };

  let response = await request(runtimeEnv, "/api/integrations/catalog/presentation", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": "admin-secret" },
    body: JSON.stringify({ metadata: submitted }),
  });
  assert.equal(response.status, 200);
  let payload = await response.json();
  assert.equal(payload.metadata.defaultLocale, "ru");
  assert.equal(payload.metadata.processes.alpha.locales["en-GB"].title, "Alpha UK");
  assert.deepEqual(payload.availableLocales, ["en-GB", "ru"]);
  assert.ok(db.audits.some((item) => item.action === "catalog.presentation.updated"));
  assert.match(db.audits.find((item) => item.action === "catalog.presentation.updated")?.metadata_json ?? "", /localeCount/);

  response = await request(runtimeEnv, "/api/integrations/catalog/presentation", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": "admin-secret" },
    body: JSON.stringify({ metadata: { version: 1, defaultLocale: "../ru", processes: {} } }),
  });
  assert.equal(response.status, 400);

  response = await request(runtimeEnv, "/api/integrations/catalog/presentation", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-admin-token": "admin-secret" },
    body: JSON.stringify({ metadata: { version: 1, processes: { alpha: { locales: { en_US: { title: "Invalid" } } } } } }),
  });
  assert.equal(response.status, 400);
});
