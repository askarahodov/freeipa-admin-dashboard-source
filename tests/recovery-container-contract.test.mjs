import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dockerfile = await readFile(new URL("../Dockerfile", import.meta.url), "utf8");
const compose = await readFile(new URL("../compose.yaml", import.meta.url), "utf8");
const testCompose = await readFile(new URL("../compose.recovery.test.yaml", import.meta.url), "utf8");

function recoveryService(source) {
  const match = /(?:^|\n)  recovery:\n([\s\S]*?)(?=\n  [a-zA-Z0-9_-]+:\n|\nvolumes:\n|$)/u.exec(source);
  assert.ok(match, "recovery service must exist");
  return match[1];
}

test("Dockerfile contains a dedicated non-root recovery target", () => {
  assert.match(dockerfile, /FROM dependencies AS recovery/u);
  assert.match(dockerfile, /apt-get install[^\n]*sqlite3[^\n]*util-linux[^\n]*ca-certificates/u);
  assert.match(dockerfile, /useradd[^\n]*--uid 10001[^\n]*recovery/u);
  assert.match(dockerfile, /mkdir -p \/portal-data \/recovery \/run\/portal-recovery-secrets/u);
  assert.match(dockerfile, /USER recovery/u);
  assert.match(dockerfile, /ENTRYPOINT \["node", "--experimental-strip-types", "scripts\/portal-recovery\.ts"\]/u);
  const target = dockerfile.slice(dockerfile.indexOf("FROM dependencies AS recovery"));
  assert.doesNotMatch(target, /CMD \["npm", "run", "start:docker"\]/u);
  assert.doesNotMatch(target, /ENV[^\n]*(?:ADMIN_TOKEN|CONFIG_ENCRYPTION_KEY|PASSWORD)/u);
});

test("Compose recovery profile is opt-in and shares only bounded mounts", () => {
  const service = recoveryService(compose);
  assert.match(service, /profiles:\s*\["recovery"\]/u);
  assert.match(service, /target: recovery/u);
  assert.match(service, /user: "\$\{PORTAL_RECOVERY_UID:-10001\}:\$\{PORTAL_RECOVERY_GID:-10001\}"/u);
  assert.match(service, /dashboard-data:\/portal-data/u);
  assert.match(service, /\$\{PORTAL_RECOVERY_DIR:-\.\/recovery\}:\/recovery/u);
  assert.match(service, /\$\{PORTAL_RECOVERY_SECRETS_DIR:-\.\/recovery-secrets\}:\/run\/portal-recovery-secrets:ro/u);
  assert.match(service, /read_only: true/u);
  assert.match(service, /tmpfs:\s*\n\s*- \/tmp/u);
  assert.match(service, /no-new-privileges:true/u);
  assert.match(service, /cap_drop:\s*\n\s*- ALL/u);
  assert.doesNotMatch(service, /restart:/u);
  assert.doesNotMatch(service, /ports:/u);
  assert.doesNotMatch(service, /healthcheck:/u);
  assert.doesNotMatch(service, /docker\.sock/u);
  assert.doesNotMatch(service, /(?:ADMIN_TOKEN|CONFIG_ENCRYPTION_KEY|PASSWORD)\s*:/u);
});

test("recovery test Compose uses disposable explicit bind roots", () => {
  const service = recoveryService(testCompose);
  assert.match(service, /profiles:\s*\["recovery-test"\]/u);
  assert.match(service, /PORTAL_RECOVERY_TEST_DIR/u);
  assert.match(service, /PORTAL_RECOVERY_TEST_SECRETS_DIR/u);
  assert.match(service, /dashboard-recovery-test-data:\/portal-data/u);
  assert.doesNotMatch(service, /docker\.sock/u);
  assert.doesNotMatch(service, /(?:ADMIN_TOKEN|CONFIG_ENCRYPTION_KEY|PASSWORD)\s*:/u);
});
