import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

function runDry() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/recovery-compose-smoke.mjs", "--dry-run"], {
      cwd: new URL("..", import.meta.url),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `exit ${code}`)));
  });
}

test("compose smoke dry-run is deterministic and shell-free", async () => {
  const result = await runDry();
  assert.equal(result.stderr, "");
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.dryRun, true);
  assert.ok(plan.commands.length >= 8);
  for (const command of [...plan.commands, plan.holder, plan.contender, plan.cleanup]) {
    assert.equal(command[0], "docker");
    assert.equal(command[1], "compose");
    assert.equal(command.includes("sh"), false);
    assert.equal(command.includes("bash"), false);
    assert.equal(command.some((value) => /docker\.sock/u.test(value)), false);
  }
  assert.ok(plan.commands.some((command) => command.includes("build") && command.includes("recovery")));
  assert.ok(plan.commands.some((command) => command.includes("sqlite3")));
  assert.ok(plan.commands.some((command) => command.some((value) => value.includes("recovery-discovery.ts"))));
  assert.ok(plan.holder.includes("flock"));
  assert.ok(plan.contender.includes("-xn"));
  assert.ok(plan.cleanup.includes("--volumes"));
});

test("compose smoke source never invokes a shell or prints environment values", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../scripts/recovery-compose-smoke.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /shell\s*:\s*true/u);
  assert.doesNotMatch(source, /exec\s*\(/u);
  assert.doesNotMatch(source, /console\.log\(process\.env/u);
  assert.doesNotMatch(source, /ADMIN_TOKEN|CONFIG_ENCRYPTION_KEY|backup-password|controller-secret/u);
  assert.match(source, /down", "--volumes", "--remove-orphans/u);
});
