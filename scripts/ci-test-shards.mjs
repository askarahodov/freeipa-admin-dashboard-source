import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function normalizeTestPath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "");
}

function normalizedTestPaths(paths) {
  return Array.from(new Set(Array.from(paths ?? [], normalizeTestPath).filter(Boolean))).sort();
}

export function assertCompleteShardCoverage(paths, shards) {
  const expected = normalizedTestPaths(paths);
  const expectedSet = new Set(expected);
  const seen = new Set();

  for (const shard of shards ?? []) {
    for (const rawPath of shard?.files ?? []) {
      const path = normalizeTestPath(rawPath);
      if (!expectedSet.has(path)) throw new Error(`Unexpected test file in shards: ${path}`);
      if (seen.has(path)) throw new Error(`Duplicate test file in shards: ${path}`);
      seen.add(path);
    }
  }

  const missing = expected.filter((path) => !seen.has(path));
  if (missing.length) throw new Error(`Missing test file from shards: ${missing.join(", ")}`);
  return true;
}

export function buildTestShards(paths, maximumShards = 8) {
  const tests = normalizedTestPaths(paths);
  if (!tests.length) throw new Error("No test files discovered");
  if (!Number.isInteger(maximumShards) || maximumShards < 1) {
    throw new Error("maximumShards must be a positive integer");
  }

  const count = Math.min(maximumShards, tests.length);
  const width = Math.max(2, String(count).length);
  const shards = Array.from({ length: count }, (_, index) => ({
    name: String(index + 1).padStart(width, "0"),
    files: [],
  }));

  tests.forEach((path, index) => shards[index % count].files.push(path));
  assertCompleteShardCoverage(tests, shards);
  return shards;
}

function parseCli(argv) {
  const options = { input: "", githubOutput: "", maximumShards: 8 };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--input") options.input = String(argv[++index] ?? "");
    else if (value === "--github-output") options.githubOutput = String(argv[++index] ?? "");
    else if (value === "--max-shards") options.maximumShards = Number(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!options.input) throw new Error("--input is required");
  return options;
}

export function runCiTestShardsCli(argv) {
  const options = parseCli(argv);
  const tests = readFileSync(options.input, "utf8")
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean);
  const shards = buildTestShards(tests, options.maximumShards);
  const output = `shards=${JSON.stringify(shards)}\ncount=${normalizedTestPaths(tests).length}\n`;
  if (options.githubOutput) appendFileSync(options.githubOutput, output, "utf8");
  else process.stdout.write(output);
  return shards;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runCiTestShardsCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Unable to build CI test shards"}\n`);
    process.exitCode = 1;
  }
}
