import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createProductionAcceptanceManifest } from "../../scripts/production-acceptance-contract.mjs";

test("unconfigured previous-supported policy fails before any Docker execution", async () => {
  const directory = await mkdtemp(join(tmpdir(), "portal-upgrade-preflight-"));
  const planPath = join(directory, "plan.json");
  const markerPath = join(directory, "docker-called");
  const dockerPath = join(directory, "docker");
  const executorPath = fileURLToPath(new URL("../../scripts/production-acceptance-executor.mjs", import.meta.url));
  const policyPath = fileURLToPath(new URL("../../release/previous-supported.json", import.meta.url));

  try {
    const manifest = createProductionAcceptanceManifest({
      imageReference: `registry.example.test/portal/admin-dashboard@sha256:${"a".repeat(64)}`,
      commitSha: "b".repeat(40),
    });
    await writeFile(planPath, JSON.stringify(manifest));
    await writeFile(dockerPath, `#!/bin/sh\nprintf called > "${markerPath}"\nexit 97\n`);
    await chmod(dockerPath, 0o755);

    const result = spawnSync(process.execPath, [
      executorPath,
      "--plan", planPath,
      "--run-upgrade",
      "--upgrade-policy", policyPath,
      "--base-url", "http://127.0.0.1:3001",
    ], {
      cwd: dirname(dirname(executorPath)),
      env: { ...process.env, PATH: directory },
      encoding: "utf8",
    });

    assert.equal(result.status, 2);
    assert.match(result.stderr, /acceptance_upgrade_source_unconfigured/u);
    await assert.rejects(() => readFile(markerPath), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
