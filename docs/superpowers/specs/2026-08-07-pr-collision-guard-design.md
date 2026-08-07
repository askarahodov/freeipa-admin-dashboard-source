# PR Collision Guard Design

## Context

Several AI agents work in this repository concurrently. Current project rules already require checking active PRs and following “one contract — one active owner”, but that protection is procedural. Issue #134 adds a mechanical safety net for missed ownership collisions.

## Goal

Detect exact-file overlaps between the current PR and other open PRs targeting `main`, classify the overlap by repository risk, and fail only when a canonical/high-conflict ownership surface is shared.

## Non-goals

- no automatic PR closing or branch mutation;
- no persistent ownership database;
- no replacement for Issue/PR dependencies or canonical source-of-truth owners;
- no blocking merely because independent planning documents coexist;
- no runtime/UI/API behavior changes.

## Architecture

`scripts/pr-collision-guard.mjs` is a dependency-free pure module with three exported contracts:

- `isHighConflictPath(path)`;
- `analyzePullRequestCollisions({ currentPrNumber, currentFiles, pullRequests })`;
- `formatCollisionReport(result)`.

The module has no GitHub credential/network ownership. `.github/workflows/pr-collision-guard.yml` uses the official GitHub Actions authenticated client to list open PR metadata and changed filenames, then delegates all policy/report decisions to the tested module.

## High-conflict policy

An overlap blocks only when the exact shared path is classified high-conflict.

Exact owners:

- `app/page.tsx`;
- `worker/index.ts`;
- `package.json`;
- `package-lock.json`;
- `portal-permissions.ts`;
- `local-auth.ts`;
- `admin-session-authorization.ts`;
- `docs/SOURCE_OF_TRUTH.md`;
- `docs/ARCHITECTURE.md`;
- `docs/PROJECT_STRUCTURE.md`;
- `docs/SECURITY_MODEL.md`;
- `docs/ai/README.md`.

High-conflict prefixes:

- `db/`;
- `.github/workflows/`.

Ordinary exact-file overlap outside this policy is informational. `docs/superpowers/**` is nonblocking by default.

## Report semantics

Each overlap contains:

- severity `BLOCKING` or `INFO`;
- exact path;
- conflicting PR numbers/titles.

Output is deterministic: blocking entries first, then path, then PR number. The current PR is excluded. Closed PRs and PRs not targeting `main` are ignored by the analyzer contract.

A blocking result instructs the agent to establish dependency/order, narrow scope, or replay after the owning PR merges.

## Workflow security

The workflow:

- triggers only for pull requests targeting `main`;
- uses `contents: read` and `pull-requests: read`;
- uses official `actions/checkout`, `actions/setup-node` and `actions/github-script`;
- does not log PR bodies, patches, source contents or credentials;
- does not mutate PRs, branches or repository contents.

## Testing

`tests/pr-collision-guard.test.mjs` covers exact/prefix policy, informational overlap, blocking overlap, self exclusion, non-main/closed filtering, deduplication, deterministic ordering, report formatting and workflow permission/delegation contracts.

TDD evidence is preserved in the superseded draft #136: the test was committed before the analyzer existed and failed with `ERR_MODULE_NOT_FOUND`; the workflow-boundary test was added before the workflow and failed with `ENOENT`.

## Documentation

`.github/REQUIRED_CHECKS.md` owns the stable check name, policy summary, permissions and remediation procedure. `docs/ai/README.md` is intentionally not modified in the clean replay because current `main` already owns the generic multi-agent coordination rule and is a documentation-agent/high-conflict surface.

## Acceptance

The feature is complete when focused tests pass, the new workflow evaluates real open PR metadata with read-only permissions, CI is green on the exact replay head, and any real blocking collision is resolved by ownership ordering rather than bypassing the policy.