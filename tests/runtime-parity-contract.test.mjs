import assert from "node:assert/strict";
import test from "node:test";

import {
  COMMON_PARITY_PATHS,
  assertCommonParity,
} from "../scripts/runtime-parity-smoke.mjs";

test("phase-1 parity covers only DB-independent invariants", () => {
  assert.deepEqual(COMMON_PARITY_PATHS, ["/health/live", "/api/schema/status"]);
  assert.equal(COMMON_PARITY_PATHS.includes("/health/ready"), false);
});

test("common parity accepts equivalent liveness and auth boundaries", () => {
  const legacy = {
    "/health/live": { status: 200, body: { contractVersion: "1", service: "freeipa-admin-dashboard", check: "liveness", state: "healthy", code: "health_live", ok: true } },
    "/api/schema/status": { status: 401, body: { code: "schema_authorization_required" } },
  };
  const candidate = structuredClone(legacy);
  assert.doesNotThrow(() => assertCommonParity(legacy, candidate));
});

test("common parity rejects a changed security boundary", () => {
  const legacy = {
    "/health/live": { status: 200, body: { contractVersion: "1", service: "freeipa-admin-dashboard", check: "liveness", state: "healthy", code: "health_live", ok: true } },
    "/api/schema/status": { status: 401, body: { code: "schema_authorization_required" } },
  };
  const candidate = structuredClone(legacy);
  candidate["/api/schema/status"].status = 200;
  assert.throws(() => assertCommonParity(legacy, candidate), /status mismatch/u);
});
