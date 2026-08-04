import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const dryRun = process.argv.includes("--dry-run");

function commandPlan(project, artifactRoot, secretsRoot) {
  const base = [
    "docker", "compose",
    "-f", "compose.recovery.test.yaml",
    "--project-name", project,
    "--profile", "recovery-test",
  ];
  const environment = {
    ...process.env,
    PORTAL_RECOVERY_TEST_DIR: artifactRoot,
    PORTAL_RECOVERY_TEST_SECRETS_DIR: secretsRoot,
  };
  const compose = (...args) => ({ command: base[0], args: [...base.slice(1), ...args], environment });
  const sql = [
    "PRAGMA journal_mode=WAL;",
    "CREATE TABLE app_settings (id TEXT PRIMARY KEY, encrypted_secrets TEXT);",
    "CREATE TABLE portal_audit_events (id TEXT PRIMARY KEY);",
    "CREATE TABLE portal_maintenance_state (id TEXT PRIMARY KEY);",
    "CREATE TABLE portal_schema_migrations (version INTEGER PRIMARY KEY);",
    "CREATE TABLE portal_users (id TEXT PRIMARY KEY);",
    "INSERT INTO portal_schema_migrations(version) VALUES (3);",
  ].join(" ");
  const discoveryCode = [
    "import('./recovery-discovery.ts')",
    ".then(async ({discoverPortalDatabase}) => {",
    "const value = await discoverPortalDatabase({dataRoot:'/portal-data'});",
    "process.stdout.write(JSON.stringify({database:value})+'\\n');",
    "})",
    ".catch((error)=>{process.stderr.write(String(error?.code||'smoke_failed')+'\\n');process.exit(1);});",
  ].join("");
  const integrityCode = [
    "import('./recovery-sqlite.ts')",
    ".then(async ({verifySqliteIntegrity}) => {",
    "await verifySqliteIntegrity('/portal-data/state/v3/d1/fixture.sqlite');",
    "process.stdout.write(JSON.stringify({integrity:'ok'})+'\\n');",
    "})",
    ".catch(()=>process.exit(1));",
  ].join("");
  return {
    environment,
    commands: [
      compose("build", "recovery"),
      compose("run", "--rm", "--entrypoint", "id", "recovery", "-u"),
      compose("run", "--rm", "--entrypoint", "which", "recovery", "sqlite3"),
      compose("run", "--rm", "--entrypoint", "which", "recovery", "flock"),
      compose("run", "--rm", "--entrypoint", "mkdir", "recovery", "-p", "/portal-data/state/v3/d1"),
      compose("run", "--rm", "--entrypoint", "sqlite3", "recovery", "/portal-data/state/v3/d1/fixture.sqlite", sql),
      compose("run", "--rm", "--entrypoint", "node", "recovery", "--experimental-strip-types", "-e", discoveryCode),
      compose("run", "--rm", "--entrypoint", "node", "recovery", "--experimental-strip-types", "-e", integrityCode),
    ],
    holder: compose("run", "--rm", "--entrypoint", "flock", "recovery", "-x", "/portal-data/.portal-exclusive.lock", "sleep", "4"),
    contender: compose("run", "--rm", "--entrypoint", "flock", "recovery", "-xn", "/portal-data/.portal-exclusive.lock", "true"),
    cleanup: compose("down", "--volumes", "--remove-orphans"),
  };
}

function redact(value, secrets) {
  let output = String(value);
  for (const secret of secrets) {
    if (secret) output = output.replaceAll(secret, "[REDACTED]");
  }
  return output;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: new URL("..", import.meta.url),
      env: options.environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    const append = (current, chunk) => {
      const next = Buffer.concat([current, Buffer.from(chunk)]);
      if (next.byteLength > MAX_OUTPUT_BYTES) {
        child.kill("SIGKILL");
        throw new Error("recovery_compose_output_limit");
      }
      return next;
    };
    child.stdout.on("data", (chunk) => { try { stdout = append(stdout, chunk); } catch (error) { reject(error); } });
    child.stderr.on("data", (chunk) => { try { stderr = append(stderr, chunk); } catch (error) { reject(error); } });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      const result = {
        code: code ?? (signal ? 128 : 1),
        stdout: stdout.toString("utf8"),
        stderr: stderr.toString("utf8"),
      };
      if (options.allowFailure || result.code === 0) resolve(result);
      else reject(Object.assign(new Error("recovery_compose_command_failed"), { result }));
    });
  });
}

async function execute() {
  const root = await mkdtemp(join(tmpdir(), "portal-recovery-compose-"));
  const artifactRoot = join(root, "artifacts");
  const secretsRoot = join(root, "secrets");
  await mkdir(artifactRoot, { mode: 0o700 });
  await mkdir(secretsRoot, { mode: 0o700 });
  const project = `portal-recovery-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const plan = commandPlan(project, artifactRoot, secretsRoot);
  const knownSecrets = [];

  if (dryRun) {
    process.stdout.write(`${JSON.stringify({
      dryRun: true,
      commands: plan.commands.map(({ command, args }) => [command, ...args]),
      holder: [plan.holder.command, ...plan.holder.args],
      contender: [plan.contender.command, ...plan.contender.args],
      cleanup: [plan.cleanup.command, ...plan.cleanup.args],
    })}\n`);
    await rm(root, { recursive: true, force: true });
    return;
  }

  const summary = { image: "pending", uid: null, sqlite: "pending", flock: "pending", discovery: "pending", integrity: "pending", contention: "pending", cleanup: "pending" };
  try {
    for (let index = 0; index < plan.commands.length; index += 1) {
      const entry = plan.commands[index];
      const result = await run(entry.command, entry.args, { environment: entry.environment });
      if (index === 0) summary.image = "ok";
      if (index === 1) {
        summary.uid = Number(result.stdout.trim());
        if (summary.uid !== 10001) throw new Error("recovery_compose_uid_invalid");
      }
      if (index === 2) summary.sqlite = result.stdout.includes("sqlite3") ? "ok" : "invalid";
      if (index === 3) summary.flock = result.stdout.includes("flock") ? "ok" : "invalid";
      if (index === 6) {
        const parsed = JSON.parse(result.stdout.trim());
        summary.discovery = String(parsed.database).endsWith("/state/v3/d1/fixture.sqlite") ? "ok" : "invalid";
      }
      if (index === 7) summary.integrity = JSON.parse(result.stdout.trim()).integrity;
    }

    const holder = spawn(plan.holder.command, plan.holder.args, {
      cwd: new URL("..", import.meta.url),
      env: plan.holder.environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const contender = await run(plan.contender.command, plan.contender.args, {
      environment: plan.contender.environment,
      allowFailure: true,
    });
    if (contender.code === 0) throw new Error("recovery_compose_lock_not_exclusive");
    summary.contention = "ok";
    await new Promise((resolve, reject) => {
      holder.on("exit", (code) => code === 0 ? resolve() : reject(new Error("recovery_compose_holder_failed")));
      holder.on("error", reject);
    });
  } catch (error) {
    const result = error?.result;
    if (result) {
      process.stderr.write(`${JSON.stringify({
        error: "recovery_compose_smoke_failed",
        stdout: redact(result.stdout, knownSecrets),
        stderr: redact(result.stderr, knownSecrets),
      })}\n`);
    }
    throw error;
  } finally {
    const cleanup = await run(plan.cleanup.command, plan.cleanup.args, {
      environment: plan.cleanup.environment,
      allowFailure: true,
    });
    summary.cleanup = cleanup.code === 0 ? "ok" : "failed";
    await rm(root, { recursive: true, force: true });
  }
  if (Object.values(summary).includes("invalid") || summary.cleanup !== "ok") throw new Error("recovery_compose_smoke_failed");
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

await execute();
