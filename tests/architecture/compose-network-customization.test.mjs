import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repo = new URL("../../", import.meta.url);

function activeYaml(source) {
  return source
    .split("\n")
    .map((line) => line.replace(/\s+#.*$/u, ""))
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .join("\n");
}

test("optional network override exposes only DNS/search/host-alias customization", async () => {
  const source = await readFile(new URL("compose.network.example.yaml", repo), "utf8");
  const yaml = activeYaml(source);

  assert.match(yaml, /^services:\n\s{2}dashboard:/mu);
  assert.match(yaml, /\n\s{4}dns:\n\s{6}- 192\.0\.2\.53\n\s{6}- 198\.51\.100\.53/u);
  assert.match(yaml, /\n\s{4}dns_search:\n\s{6}- corp\.example/u);
  assert.match(yaml, /\n\s{4}extra_hosts:\n\s{6}freeipa\.corp\.example:\s+"192\.0\.2\.10"\n\s{6}xyops\.corp\.example:\s+"198\.51\.100\.20"/u);

  assert.doesNotMatch(yaml, /network_mode:|ports:|cap_add:|privileged:|security_opt:|volumes:|environment:/u);
  assert.doesNotMatch(yaml, /NODE_TLS_REJECT_UNAUTHORIZED|rejectUnauthorized|tls.*false|https?:\/\//iu);
});

test("operator-local network override cannot be committed or sent as Docker build context", async () => {
  const gitignore = await readFile(new URL(".gitignore", repo), "utf8");
  const dockerignore = await readFile(new URL(".dockerignore", repo), "utf8");

  assert.match(gitignore, /^\/compose\.network\.local\.yaml$/mu);
  assert.match(dockerignore, /^compose\.network\.local\.yaml$/mu);
});

test("network override template is explicit and fail-safe by default", async () => {
  const source = await readFile(new URL("compose.network.example.yaml", repo), "utf8");

  assert.match(source, /Copy this file to compose\.network\.local\.yaml/u);
  assert.match(source, /docker compose -f compose\.yaml -f compose\.network\.local\.yaml config/u);
  assert.match(source, /replace every documentation-only value/u);
  assert.match(source, /DNS\/host aliases do not disable or replace TLS verification/u);
  assert.match(source, /TEST-NET\/documentation values below are intentionally non-routable examples/u);
});
