# Required GitHub checks

This repository keeps three stable branch-protection contexts for pull requests targeting `main`:

- `CI / Required CI` — stable aggregate over the canonical plan for Required CI and the jobs that plan marks required for the current diff.
- `Scoped E2E / scoped-e2e` — always exists for pull requests. It validates browser-routing contracts/planner outputs, then runs selected contract/Chromium coverage or records an intentional no-browser plan.
- `PR Collision Guard / ownership-collision` — read-only ownership gate that compares exact changed paths with other open PRs targeting `main`.

Branch protection should require all three stable contexts. Dynamic shard jobs are not required contexts individually.

## Required CI planning

`scripts/ci-required-plan.mjs` projects the canonical changed-input semantics into Required CI job requirements. It reuses `parseChangedInputs` from `scripts/auth-e2e-scope.mjs`, including NUL-delimited rename/delete-safe parsing. `.github/workflows/ci.yml` prepares the full pull-request diff from merge-base to head; it does not classify only the last commit.

The plan is versioned and includes changed inputs, execution mode, per-job booleans and reasons. `scripts/ci-required-gate.mjs` compares actual terminal job results with those booleans. YAML does not contain a second docs allowlist or a second success interpretation.

## Ordinary documentation-only fast path

The positive allowlist is deliberately narrow and limited to user-facing Knowledge Base prose:

- `docs/guide/README.md`;
- Markdown below `docs/guide/getting-started/**`, `user/**`, `operator/**`, `administrator/**`, `support/**`, `concepts/**` or `troubleshooting/**`.

The root `README.md`, `docs/README.md`, `docs/guide/developer/**` and `docs/guide/operations/**` remain on full CI because their current content includes development, deployment, security, testing or operational instructions. Testing/development policy, AI instructions, security/operations references, workflows, executable examples/fixtures and any mixed documentation + non-documentation PR are also not ordinary docs-only.

For an allowed docs-only PR these jobs remain required:

1. `plan` — computes and validates the canonical Required CI plan;
2. `discover-tests` — preserves deterministic repository test-inventory/shard validation without installing dependencies;
3. `docs-consistency` — runs `npm run docs:check`; this script uses Node core APIs and does not require `npm ci`;
4. `dependency-security` — preserves deterministic dependency-policy/allowlist validation; live audit/SBOM remains conditional on dependency inputs;
5. `required` / `Required CI` — verifies the plan and all actual results.

The fast path may mark `build`, `test`, `container-security` and `recovery-compose` not required. That means no product `npm ci`/build, no eight server-test shard jobs, and no runtime/recovery Docker builds for confirmed ordinary prose-only changes.

No workflow-level `paths-ignore` is used, so `Required CI` is always created for pull requests.

## Fail-closed aggregate semantics

`CI / Required CI` runs with `if: always()` and checks the planner result before parsing the plan. The gate accepts only these states:

- plan says **required** → job result must be `success`;
- plan says **not required** → job result may be `success` or `skipped`;
- `failure` or `cancelled` never becomes a successful intentional skip;
- missing/unknown result, missing requirement, malformed/missing plan or failed planner blocks the aggregate.

A required job reporting `skipped` also blocks the aggregate. This prevents dependency-chain skips, expression mistakes or broken planner outputs from silently satisfying branch protection.

## Full CI path

All non-docs-only pull requests retain the existing complete CI topology:

1. deterministic test discovery;
2. documentation consistency;
3. dependency security policy and conditional live audit/SBOM;
4. dependency install, production dependency-tree validation, lint and build;
5. runtime-image vulnerability scan;
6. every discovered Node/server test exactly once through the shard matrix;
7. recovery contracts, isolated recovery image and named-volume smoke;
8. stable aggregate verification.

Pushes to `main` force full CI regardless of changed paths. The docs-only fast path is therefore PR-only and cannot reduce post-merge `main` verification.

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

`scripts/ci-test-shards.mjs` normalizes and sorts discovered test paths, distributes them round-robin into at most eight deterministic shards, and fails closed on missing, duplicate or unexpected membership. Shard-count optimization belongs to #564 and must use `docs/development/CI_BASELINE.md` evidence; #563 does not reduce the test inventory for code changes.

## Security artifacts

Dependency/SBOM and runtime-image scan behavior remains governed by the active CI/security policy. The docs-only fast path does not classify package/security policy changes as ordinary prose. Scheduled dependency/image security work remains owned by #566.

## Concurrency and artifacts

Obsolete pull-request runs may be cancelled when a newer commit is pushed to the same PR. `main` runs are not cancelled by newer runs. Full browser runs keep sanitized Playwright artifacts under the existing retention policy; docs-only runs do not create browser/Docker/build artifacts that were not executed.

## Regression contracts

`tests/architecture/ci-required-plan.test.mjs` covers the positive docs allowlist, exclusions, mixed diffs, full-main behavior, empty-diff failure, planner/gate missing data, unknown results, required skip/failure/cancellation, unauthorized failure of skipped jobs and stable workflow trigger/gate structure.
