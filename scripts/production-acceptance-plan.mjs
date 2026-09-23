#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

import {
  assertProductionAcceptanceReportSafe,
  createProductionAcceptanceManifest,
} from "./production-acceptance-contract.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const imageReference = argument("--image") ?? process.env.PORTAL_ACCEPTANCE_IMAGE;
const commitSha = argument("--commit") ?? process.env.PORTAL_ACCEPTANCE_COMMIT ?? process.env.GITHUB_SHA;
const output = path.resolve(argument("--output") ?? "artifacts/production-acceptance/plan.json");

try {
  const manifest = createProductionAcceptanceManifest({ imageReference, commitSha });
  assertProductionAcceptanceReportSafe(manifest);

  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`ACCEPTANCE_MODE=${manifest.mode}`);
  console.log(`ACCEPTANCE_PROJECT=${manifest.compose.projectName}`);
  console.log(`ACCEPTANCE_IMAGE_DIGEST=${manifest.image.digest}`);
  console.log(`ACCEPTANCE_PLAN=${path.relative(process.cwd(), output)}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
