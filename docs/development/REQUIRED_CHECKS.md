# Required GitHub checks

This repository keeps three stable branch-protection contexts for pull requests targeting `main`:

- `CI / Required CI` — stable aggregate over the canonical plan for Required CI and the jobs that plan marks required for the current diff.
- `Scoped E2E / scoped-e2e` — always exists for pull requests. It validates browser-routing contracts/planner outputs, then runs selected contract/Chromium coverage or records an intentional no-browser plan.
- `PR Collision Guard / ownership-collision` — read-only ownership gate that compares exact changed paths with other open PRs targeting `main`.

Branch protection should require all three stable contexts. Dynamic shard jobs are not required contexts individually.

## Required CI planning

`scripts/ci-required-plan.mjs` projects the canonical changed-input semantics into Required CI job requirements. It reuses `parseChangedInputs` from `scripts/auth-e2e-scope.mjs`, including NUL-delimited rename/delete-safe parsing. `.github/workflows/ci.yml` prepares the full pull-request diff from merge-base to head; it does not classify only the last commit.

The plan is versioned and includes changed inputs, execution mode, per-job booleans and reasons. `scripts/ci-required-gate.mjs` compares actual terminal job results with those booleans. YAML consumes planner outputs for `container-security` and `recovery-compose`; it does not contain a second path allowlist or a second success interpretation.

## Ordinary documentation-only fast path

The positive allowlist is deliberately narrow and limited to user-facing Knowledge Base prose:

- `docs/guide/README.md`;
- Markdown below `docs/guide/getting-started/**`, `user/**`, `operator/**`, `administrator/**`, `support/**`, `concepts/**` or `troubleshooting/**`.

The root `README.md`, `docs/README.md`, `docs/guide/developer/**` and `docs/guide/operations/**` remain outside that fast path because their current content includes development, deployment, security, testing or operational instructions. Testing/development policy, AI instructions, security/operations references, workflows, executable examples/fixtures and any mixed documentation + non-documentation PR are also not ordinary docs-only.

For an allowed docs-only PR these jobs remain required: `plan`, `discover-tests`, `docs-consistency`, `dependency-security` and the final `Required CI` aggregate. The fast path may mark `build`, `test`, `container-security` and `recovery-compose` not required.

## Risk-routed Docker jobs for code/policy PRs

For every non-docs-only PR, product `build` and the complete discovered Node/server suite remain required. The planner selects only the two Docker-heavy jobs by affected boundary:

| Input class | `container-security` | `recovery-compose` |
| --- | --- | --- |
| isolated UI or ordinary application/runtime behavior | not required | not required |
| root `Dockerfile` | required | required |
| `package.json` / `package-lock.json` | required | required |
| dependency audit allowlist/policy or scheduled security workflow | required | not required |
| `src/recovery/**`, `src/backup/**`, `src/storage/**`, `db/**` | not required | required |
| recovery/storage tests | not required | required |
| recovery-related maintenance/encryption/identity/startup scripts | not required | required |
| `compose.yaml`, `.env.example` | not required | required |
| canonical CI planner/gate or `ci.yml` | required | required |
| mixed diff | union | union |

The runtime vulnerability scan is not a substitute for behavioral tests: changing application code without changing the installed package/image composition may skip `container-security`, but still runs build, the full Node suite and applicable browser coverage. Likewise, a UI-only PR does not build the recovery image when none of its source/configuration boundaries changed.

Planner/workflow changes select both Docker jobs conservatively so a routing edit proves both execution branches before merge. Pushes to `main` force all Required CI jobs regardless of the merged diff.

## Fail-closed aggregate semantics

`CI / Required CI` runs with `if: always()` and checks the planner result before parsing the plan. The gate accepts only these states:

- plan says **required** → job result must be `success`;
- plan says **not required** → job result may be `success` or `skipped`;
- `failure` or `cancelled` never becomes a successful intentional skip;
- missing/unknown result, missing requirement, malformed/missing plan or failed planner blocks the aggregate.

A required job reporting `skipped` also blocks the aggregate. This prevents dependency-chain skips, expression mistakes or broken planner outputs from silently satisfying branch protection.

No workflow-level `paths-ignore` is used, so the stable aggregate is always created and cannot remain pending merely because a heavy job was intentionally not selected.

## Full main path

Pushes to `main` retain the complete CI topology:

1. deterministic test discovery;
2. documentation consistency;
3. dependency security policy and conditional live audit/SBOM;
4. dependency install, production dependency-tree validation, lint and build;
5. runtime-image vulnerability scan;
6. every discovered Node/server test exactly once through the shard matrix;
7. recovery contracts, isolated recovery image and named-volume smoke;
8. stable aggregate verification.

This keeps post-merge full regression intact while PR runner time is reduced only where the canonical risk plan proves the Docker jobs inapplicable.

## Browser planner contract

`scripts/auth-e2e-scope.mjs` remains the canonical browser/risk planner. `tests/auth/auth-e2e-routing.test.mjs` and `tests/architecture/test-scope-routing.test.mjs` protect browser routing. It uses full PR merge-base diff semantics, evaluates additions/deletions and both sides of rename/copy records, and conservatively expands unknown runtime-sensitive paths.

Browser routing examples remain:

| Representative change | Browser plan |
| --- | --- |
| `src/auth/local-auth.ts` | auth browser coverage |
| `src/auth/portal-request-context.ts` | auth + RBAC browser coverage |
| `src/freeipa/freeipa-user-query.ts` | FreeIPA browser coverage |
| `db/**` schema change | schema contracts; no unrelated browser category by default |
| `fixtures/compose/e2e.yaml`, `fixtures/env/e2e.example` | full browser regression |
| dependency graph/lockfile or runtime/build package script | full browser regression |
| ordinary allowlisted guide prose | no browser suite after routing contract |
| unknown runtime-sensitive path | conservative full browser regression |
| push to `main`, manual dispatch or schedule | full browser regression |

## Server test sharding

`scripts/ci-test-shards.mjs` normalizes and sorts discovered test paths, distributes them into deterministic shards, and fails closed on missing, duplicate or unexpected membership. Risk-routing `container-security`/`recovery-compose` does not reduce this Node test inventory for code changes.

## Security continuity

PR changes that can alter runtime image/dependency composition or security enforcement still require `container-security`. Independently, the trusted scheduled/manual security workflow introduced by #566 performs fresh dependency and runtime-image vulnerability scans even when the lockfile has not changed. `Required CI` does not depend on the latest scheduled result and scheduled scans do not replace PR validation of changed package/security inputs.

## Concurrency and artifacts

Obsolete pull-request runs may be cancelled when a newer commit is pushed to the same PR. `main` runs are not cancelled by newer runs. Full browser runs keep sanitized Playwright artifacts under the existing retention policy; risk-routed PRs do not create Docker artifacts for jobs the canonical plan did not select.

## Regression contracts

`tests/architecture/ci-required-plan.test.mjs` contains table-driven cases for UI, runtime, Docker, dependency, security-policy, recovery, backup, storage, schema, encryption/identity, Compose, planner and mixed diffs. It also protects main-full behavior and fail-closed gate semantics for missing, failed, cancelled and unauthorized skipped jobs.
