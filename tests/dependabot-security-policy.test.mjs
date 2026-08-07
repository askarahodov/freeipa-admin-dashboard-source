import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const configUrl = new URL("../.github/dependabot.yml", import.meta.url);

test("Dependabot separates security remediation from routine version groups", () => {
  assert.equal(existsSync(configUrl), true, "dependabot.yml must exist");
  const config = readFileSync(configUrl, "utf8");
  assert.match(config, /production-security:[\s\S]*applies-to:\s*security-updates[\s\S]*dependency-type:\s*production/u);
  assert.match(config, /development-security:[\s\S]*applies-to:\s*security-updates[\s\S]*dependency-type:\s*development/u);
  assert.match(config, /routine-development:[\s\S]*applies-to:\s*version-updates/u);
});
