# Repository placement contract

This document defines the lightweight placement guard introduced by #271. The guard operates on tracked files (`git ls-files`), so local dependencies and build output created during CI do not create false positives.

## Root TypeScript allowlist

Production modules should live under a documented domain owner such as `src/`, `worker/` or `app/`. Repository-root TypeScript is limited to configuration entrypoints that are required by their tools:

- `drizzle.config.ts` — Drizzle configuration entrypoint.
- `next.config.ts` — Next.js configuration entrypoint.
- `vite.config.ts` — Vite/Vinext configuration entrypoint.

A new root `.ts` or `.tsx` file fails the placement contract with a message directing the author to a domain owner.

## Frozen transitional root modules

The following existing production files are explicit transitional baseline exceptions. This list is closed: it allows these exact paths but does not allow similar or newly named root modules.

- `audit-log.ts` — legacy audit owner; future ownership cleanup is coordinated with #43/#56.
- `login-rate-limit.ts` — legacy authentication-protection owner; future middleware ownership cleanup is coordinated with #56/#59.
- `storage-quick-check.ts` — compatibility re-export for the canonical storage integrity implementation; cleanup is coordinated with #44.

When one of these files moves to its canonical owner, remove its exception in the same change. Do not add a new transitional exception without an owning issue and a concrete migration reason.

## Generated and cache artifacts

Tracked repository-level output directories such as `.next`, `.sites-runtime`, `.vinext`, `.wrangler`, `artifacts`, `coverage`, `dist`, `out`, `outputs`, `playwright-report`, `test-results` and `work` are rejected. Unambiguous generated/dependency directories such as `node_modules`, `.next`, `.sites-runtime`, `.vinext`, `.wrangler`, `playwright-report` and `test-results` are also rejected when nested below a package or application directory.

Generic names such as `artifacts`, `work`, `out` and `outputs` are not treated as generated merely because they appear inside a source-owned domain path. For example, `src/recovery/artifacts/recovery-point.ts` is production source and is valid. This keeps the guard ownership-aware instead of classifying source code solely from a directory name.

Intentional test data under `fixtures/`, `e2e/fixtures/` or `tests/fixtures/` is exempt from the generated-name check because fixtures are source-controlled test inputs rather than disposable runtime output.

## Engineering-policy documents

Repository-level navigation/agent documents `README.md` and `AGENTS.md` are allowed at root, and `.github/pull_request_template.md` remains valid GitHub metadata. New engineering policy, architecture, testing, workflow, convention, guideline or standards documents should live under `docs/` (normally `docs/development/`) rather than accumulating at repository root or directly under `.github/`.

## Enforcement

`scripts/repository-placement-policy.mjs` contains the data-driven allowlists and classifier. `tests/architecture/repository-placement-policy.test.mjs` covers allowed, rejected and transitional cases and validates the repository's real tracked-file baseline. Because Node tests are discovered recursively, the guard runs in the normal CI shards and local `npm test` flow without a separate browser E2E job or additional workflow wiring.
