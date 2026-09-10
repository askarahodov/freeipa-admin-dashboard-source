import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production compose uses an explicit bridge network and safe dashboard publication", async () => {
  const compose = await readFile(new URL("../../compose.yaml", import.meta.url), "utf8");

  assert.doesNotMatch(compose, /network_mode:\s*host/u);
  assert.match(compose, /\$\{DASHBOARD_BIND_ADDRESS:-127\.0\.0\.1\}:\$\{DASHBOARD_PORT:-3001\}:3001/u);
  assert.match(compose, /networks:\n\s+portal:\n\s+driver:\s+bridge/u);

  const serviceNetworkRefs = compose.match(/\n\s{4}networks:\n\s{6}- portal/gu) ?? [];
  assert.equal(serviceNetworkRefs.length, 2, "dashboard and recovery must use the explicit portal network");
});
