import { createReadStream, readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createGzip } from "node:zlib";
import { fileURLToPath } from "node:url";

const DECIMAL_UNITS = new Map([
  ["B", 1],
  ["KB", 1_000],
  ["MB", 1_000_000],
  ["GB", 1_000_000_000],
  ["TB", 1_000_000_000_000],
]);

export function parseHumanBytes(value, unit) {
  const multiplier = DECIMAL_UNITS.get(String(unit).toUpperCase());
  if (!multiplier) throw new Error(`Unsupported Docker size unit: ${unit}`);
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid Docker size value: ${value}`);
  return Math.round(number * multiplier);
}

export function parseBuildContextBytes(buildLog) {
  const lines = String(buildLog).split(/\r?\n/u);
  let inBuildContext = false;
  let observed = null;

  for (const line of lines) {
    if (line.includes("[internal] load build context")) {
      inBuildContext = true;
      observed = null;
      continue;
    }
    if (!inBuildContext) continue;

    const match = line.match(/transferring context:\s*([0-9]+(?:\.[0-9]+)?)\s*(B|kB|MB|GB|TB)\b/iu);
    if (match) observed = parseHumanBytes(match[1], match[2]);

    if (/\bDONE\b/u.test(line)) {
      if (observed !== null) return observed;
      inBuildContext = false;
    }
  }

  if (observed !== null) return observed;
  throw new Error("Docker build log does not contain a completed build-context transfer measurement");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) throw new Error("Arguments must be supplied as --key value pairs");
    options[key.slice(2)] = value;
  }
  for (const required of ["image", "target", "build-log", "output"]) {
    if (!options[required]) throw new Error(`Missing required argument --${required}`);
  }
  return options;
}

function dockerJson(args) {
  const output = execFileSync("docker", args, { encoding: "utf8" });
  return JSON.parse(output);
}

async function gzipDockerSaveBytes(image) {
  return await new Promise((resolve, reject) => {
    const docker = spawn("docker", ["save", image], { stdio: ["ignore", "pipe", "pipe"] });
    const gzip = createGzip({ level: 6 });
    let compressedBytes = 0;
    let stderr = "";

    docker.stderr.setEncoding("utf8");
    docker.stderr.on("data", (chunk) => { stderr += chunk; });
    gzip.on("data", (chunk) => { compressedBytes += chunk.length; });
    docker.stdout.pipe(gzip);

    let dockerClosed = false;
    let gzipEnded = false;
    let dockerCode = null;

    const finish = () => {
      if (!dockerClosed || !gzipEnded) return;
      if (dockerCode !== 0) reject(new Error(`docker save failed with exit ${dockerCode}: ${stderr.trim()}`));
      else resolve(compressedBytes);
    };

    docker.on("error", reject);
    gzip.on("error", reject);
    docker.on("close", (code) => {
      dockerClosed = true;
      dockerCode = code;
      finish();
    });
    gzip.on("end", () => {
      gzipEnded = true;
      finish();
    });
  });
}

function readOsRelease() {
  try {
    const values = Object.fromEntries(
      readFileSync("/etc/os-release", "utf8")
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf("=");
          if (separator < 0) return [line, ""];
          return [line.slice(0, separator), line.slice(separator + 1).replace(/^"|"$/gu, "")];
        }),
    );
    return { id: values.ID ?? null, version_id: values.VERSION_ID ?? null, pretty_name: values.PRETTY_NAME ?? null };
  } catch {
    return { id: null, version_id: null, pretty_name: null };
  }
}

export async function collectDockerPackagingMetrics({ image, target, buildLog, sourceSha = null }) {
  const inspect = dockerJson(["image", "inspect", image]);
  if (!Array.isArray(inspect) || inspect.length !== 1) throw new Error(`Expected exactly one Docker image for ${image}`);
  const imageInfo = inspect[0];
  const dockerVersion = dockerJson(["version", "--format", "{{json .}}"]) ?? {};

  return {
    schema_version: 1,
    source_sha: sourceSha,
    target,
    image,
    image_id: imageInfo.Id ?? null,
    image_logical_size_bytes: imageInfo.Size,
    docker_save_gzip_bytes: await gzipDockerSaveBytes(image),
    build_context_transfer_bytes: parseBuildContextBytes(buildLog),
    measurement_note: "docker_save_gzip_bytes is a gzip-compressed local docker-save archive; it is not a registry transfer-size claim.",
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      os_release: readOsRelease(),
      docker_client_version: dockerVersion.Client?.Version ?? null,
      docker_server_version: dockerVersion.Server?.Version ?? null,
      docker_server_os: dockerVersion.Server?.Os ?? null,
      docker_server_arch: dockerVersion.Server?.Arch ?? null,
    },
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const buildLog = readFileSync(options["build-log"], "utf8");
  const metrics = await collectDockerPackagingMetrics({
    image: options.image,
    target: options.target,
    buildLog,
    sourceSha: options["source-sha"] ?? process.env.GITHUB_SHA ?? null,
  });
  await mkdir(dirname(options.output), { recursive: true });
  writeFileSync(options.output, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(metrics));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  await main();
}
