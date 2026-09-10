# Scheduled dependency and image security scans

The repository runs a dedicated **Scheduled Security Scan** against trusted `main` so newly published advisories are detected even when `package.json` and `package-lock.json` do not change.

## Cadence and manual execution

The workflow is scheduled once per day at **03:17 UTC**. A non-round minute reduces the chance of competing with the common top-of-hour GitHub Actions load while keeping a predictable daily security check. The same workflow also supports `workflow_dispatch` for an operator-requested rescan.

Both scheduled and manual executions are fail-closed to `refs/heads/main`. The checkout SHA must equal the workflow SHA before scanning. A manual dispatch from another ref fails instead of executing untrusted branch code as a trusted security scan.

## What is refreshed

Every run performs all of the following regardless of lockfile history:

- the existing `npm run security:audit` production policy, including its expiry-controlled allowlist and bounded transport retry behavior;
- a production lockfile CycloneDX SBOM;
- a fresh build of the current runtime image, optionally reading the trusted BuildKit cache populated by normal `main` CI;
- the pinned Trivy HIGH/CRITICAL fixable-vulnerability policy used by pull-request CI;
- provenance containing the exact source SHA, workflow run/attempt, scanner action revision and `trivy --version` output after the vulnerability database is available.

The scheduled workflow is a cache reader only. It does not publish BuildKit cache state. A cache miss can make the run slower but cannot change which source SHA is built or which security checks execute.

## Evidence and retention

The workflow uploads the SBOM, Trivy JSON, Trivy version/database information and scan provenance as `scheduled-security-scan-<sha>`. Evidence is retained for 14 days, matching the existing runtime image security evidence window.

Artifacts must not contain credentials, environment dumps, cookies or application data. The workflow uses only repository read permission and does not require deployment credentials.

## Failure triage

A scheduled/manual run is considered unhealthy when the dependency policy fails, the SBOM is invalid, the current runtime image cannot be built, Trivy reports a blocking finding, or required provenance cannot be produced. Transport/setup failures are infrastructure failures, not clean security results; the dependency audit helper already uses bounded retry and still exits non-zero after exhaustion.

Use the failing GitHub Actions step and retained evidence to identify whether the failure is an npm advisory, image vulnerability, build regression or infrastructure problem. Policy exceptions continue to be managed only through `security/audit-allowlist.json` with owner, reason and expiry; this workflow does not create exceptions automatically.

## Relationship to pull-request gates

`Required CI` remains based only on the canonical plan and checks for the current pull request. It does **not** consume or trust the last scheduled scan result. Dependency/security-sensitive pull requests still execute their existing pre-merge checks; scheduled scanning closes the separate time-of-disclosure gap where advisories appear without a repository change.

Rollback is a revert of the workflow/documentation change. Removing the scheduled workflow does not alter application runtime state or cache contents, but it restores the advisory-discovery gap and therefore requires explicit security review.
