import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  formatArchitectureFitnessIssues,
  inspectArchitectureFitness,
  readTrackedSourceFiles,
  validateArchitectureFitness,
} from "../../scripts/architecture-fitness.mjs";
import { portalCompatibilityAdapters } from "../../worker/application-composition-contract.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

test("rejects reverse src -> worker/runtime adapter dependencies with actionable edges", () => {
  const issues = inspectArchitectureFitness(new Map([
    ["src/domain/service.ts", 'import { x } from "../../worker/secure-entry.ts";\nimport "../runtime/helper.mjs";'],
    ["worker/secure-entry.ts", "export const x = 1;"],
    ["runtime/helper.mjs", "export {};"],
  ]));
  assert.equal(issues.length, 2);
  assert.deepEqual(issues.map((entry) => entry.code), [
    "reverse-adapter-dependency",
    "reverse-adapter-dependency",
  ]);
  assert.match(formatArchitectureFitnessIssues(issues), /src\/domain\/service\.ts -> worker\/secure-entry\.ts/u);
  assert.match(formatArchitectureFitnessIssues(issues), /src\/runtime\/helper\.mjs/u);
});

test("rejects resurrection or imports of the retired central Worker tail", () => {
  const issues = inspectArchitectureFitness(new Map([
    ["worker/index.ts", "export default {};"],
    ["worker/example.ts", 'import runtime from "./index";\nexport default runtime;'],
  ]));
  assert.deepEqual(issues.map((entry) => entry.code), [
    "retired-central-tail",
    "retired-central-tail-import",
  ]);
  assert.throws(
    () => validateArchitectureFitness(new Map([
      ["worker/index.ts", "export default {};"],
    ])),
    /Architecture fitness failed:[\s\S]*retired-central-tail/u,
  );
});

test("compatibility exceptions must be unique existing and actionable", () => {
  const files = new Map([["worker/kept-entry.ts", "export {};"]]);
  const issues = inspectArchitectureFitness(files, {
    compatibilityAdapters: [
      {
        path: "worker/kept-entry.ts",
        responsibility: "keeps a real compatibility behavior while migration remains in progress",
        reason: "required until exact behavior has an explicit canonical replacement owner",
        removalCondition: "remove after parity tests prove the canonical replacement owns the behavior",
      },
      {
        path: "worker/kept-entry.ts",
        responsibility: "duplicate record should be rejected by the architecture fitness guard",
        reason: "duplicates make exception ownership ambiguous and therefore are not acceptable",
        removalCondition: "delete this duplicate record before merging the architecture contract",
      },
      {
        path: "worker/missing-entry.ts",
        responsibility: "points at a file that is absent from the tracked repository source snapshot",
        reason: "a stale exception cannot document a real active compatibility ownership boundary",
        removalCondition: "remove the stale record or restore the intended tracked compatibility owner",
      },
    ],
  });
  assert.ok(issues.some((entry) => entry.code === "duplicate-compatibility-exception"));
  assert.ok(issues.some((entry) => entry.code === "missing-compatibility-exception-target"));
});

test("harmless moves inside src do not fail dependency direction", () => {
  const files = new Map([
    ["src/domain/new-place.ts", 'import { value } from "../shared/value.ts";'],
    ["src/shared/value.ts", "export const value = 1;"],
    ["worker/application.ts", 'import { value } from "../src/shared/value.ts"; void value;'],
  ]);
  assert.deepEqual(inspectArchitectureFitness(files), []);
});

test("current tracked architecture satisfies the fitness foundation", () => {
  const files = readTrackedSourceFiles(repositoryRoot);
  assert.ok(files.has("worker/application.ts"));
  assert.equal(files.has("worker/index.ts"), false);
  assert.doesNotThrow(() => validateArchitectureFitness(files, {
    compatibilityAdapters: portalCompatibilityAdapters,
  }));
});
