# PR Collision Guard Design

## Context

Several AI agents work in this repository concurrently. `docs/ai/README.md` already requires checking active PRs and following the rule “one contract — one active owner”, but that rule is currently procedural. A missed check can let two otherwise valid PRs modify the same canonical/high-conflict surface.

Issue #134 adds a mechanical safety net without replacing the existing ownership/source-of-truth model.

## Goal

Detect overlaps between the current pull request and other open pull requests targeting `main`, classify the overlap by repository risk, and fail only when a canonical/high-conflict ownership surface is shared.

## Non-goals

- no automatic PR closing or branch mutation;
- no persistent ownership database;
- no replacement for `docs/ai/README.md`, `SOURCE_OF_TRUTH.md`, Issues or PR dependencies;
- no blocking merely because two PRs both contain independent planning documents;
- no runtime/UI/API behavior changes.

## Architecture

Create `scripts/pr-collision-guard.mjs` with two layers:

1. **Pure policy/report layer** exported for deterministic tests:
   - normalize paths;
   - classify high-conflict paths;
   - compare current PR files with a supplied set of open PRs;
   - format a stable report;
   - return whether the collision is blocking.
2. **GitHub API CLI layer** used only by CI:
   - read `GITHUB_REPOSITORY`, `GITHUB_TOKEN`, `GITHUB_EVENT_PATH`/explicit PR number;
   - list open PRs targeting `main`;
   - fetch changed files with pagination;
   - exclude the current PR;
   - call the pure layer;
   - print the report and exit `1` only for blocking collisions.

No new npm dependency is required; Node 22 native `fetch` is sufficient.

## High-conflict policy

Blocking when an exact overlapping file matches one of these ownership surfaces:

### Exact files

- `app/page.tsx`
- `worker/index.ts`
- `package.json`
- `package-lock.json`
- `portal-permissions.ts`
- `local-auth.ts`
- `admin-session-authorization.ts`
- `docs/SOURCE_OF_TRUTH.md`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT_STRUCTURE.md`
- `docs/SECURITY_MODEL.md`
- `docs/ai/README.md`

### Prefixes

- `db/`
- `.github/workflows/`

Ordinary exact-file overlap outside this policy is informational and does not fail the check. `docs/superpowers/**` is therefore nonblocking unless a future explicit policy says otherwise.

## Report semantics

For each overlapping path report:

- severity: `BLOCKING` or `INFO`;
- path;
- conflicting PR numbers/titles.

Sort output deterministically by severity, path and PR number. The current PR is always excluded. Only open PRs whose base is `main` participate.

When no overlap exists, print a short success message.

When only informational overlap exists, exit `0` and explain that review/coordination is recommended but not blocked.

When any blocking overlap exists, exit `1` and tell the agent to establish ordering/dependency, narrow scope, or replay after the owning PR merges.

## Workflow

Add `.github/workflows/pr-collision-guard.yml`:

- trigger: `pull_request` targeting `main`;
- stable job name: `PR Collision Guard / ownership-collision`;
- permissions: `contents: read`, `pull-requests: read` only;
- checkout current PR source;
- setup Node 22.13.0;
- execute the script with repository token;
- no repository write permission and no secrets beyond the ephemeral GitHub token.

The script must not execute code from another PR; it only reads GitHub metadata/files.

## Testing

Add `tests/pr-collision-guard.test.mjs` covering:

- exact high-conflict path classification;
- prefix high-conflict classification;
- ordinary overlap is informational;
- planning-doc overlap is informational;
- current PR exclusion;
- closed/non-main entries ignored by the pure comparison input contract;
- multiple PR conflicts produce deterministic ordering;
- blocking status is true only when at least one high-conflict overlap exists.

TDD sequence: commit the failing test before the script exists, verify CI failure is caused by the missing implementation, then add the implementation.

## Documentation

Update:

- `.github/REQUIRED_CHECKS.md` with the new stable check and remediation;
- `docs/ai/README.md` with the requirement to treat a collision failure as an ownership/order problem, not something to bypass.

## Security

The workflow uses read-only GitHub permissions. No credentials, PR bodies, patches or source contents from other branches are logged. Only PR number/title and overlapping repository paths are reported.

## Acceptance

The implementation is complete when deterministic tests pass, the workflow can fail a synthetic blocking collision and allow informational overlap, documentation is updated, and repository CI is green on the exact candidate head.