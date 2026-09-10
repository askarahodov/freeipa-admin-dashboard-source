import { readFileSync } from "node:fs";

import { CI_JOB_KEYS } from "./ci-required-plan.mjs";

const terminalResults = new Set(["success", "failure", "cancelled", "skipped"]);

export function verifyRequiredCI(plan, results) {
  if (!plan || plan.version !== 1 || !plan.jobs || typeof plan.jobs !== "object") throw new Error("Missing or invalid canonical CI plan");
  for (const job of CI_JOB_KEYS) {
    if (typeof plan.jobs[job] !== "boolean") throw new Error(`Missing canonical requirement for job: ${job}`);
    const result = results?.[job];
    if (!terminalResults.has(result)) throw new Error(`Unknown or missing result for job ${job}: ${String(result)}`);
    if (plan.jobs[job] && result !== "success") throw new Error(`Required job ${job} finished with result: ${result}`);
    if (!plan.jobs[job] && !["success", "skipped"].includes(result)) throw new Error(`Not-required job ${job} finished unexpectedly with result: ${result}`);
  }
  return true;
}

function runCli(argv) {
  if (argv.length !== 2) throw new Error("Usage: node scripts/ci-required-gate.mjs PLAN_JSON RESULTS_JSON");
  const plan = JSON.parse(argv[0].startsWith("@") ? readFileSync(argv[0].slice(1), "utf8") : argv[0]);
  const results = JSON.parse(argv[1].startsWith("@") ? readFileSync(argv[1].slice(1), "utf8") : argv[1]);
  verifyRequiredCI(plan, results);
  process.stdout.write("Required CI gate accepted canonical plan/results.\n");
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Required CI gate failed"}\n`);
    process.exitCode = 1;
  }
}
