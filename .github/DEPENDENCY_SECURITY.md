# Dependency security policy

## Required checks

`CI / Required CI` includes two supply-chain gates:

- `Dependency security` runs the production-only npm audit policy and publishes `npm-production-sbom` as a CycloneDX artifact.
- `Runtime image security` builds the production `runtime` Docker target and scans it with the pinned Trivy action. Fixable `HIGH` or `CRITICAL` findings fail the job. The JSON result is uploaded as `runtime-image-security-scan` even when the scan fails.

`Auth E2E / auth-e2e` remains independently required for runtime-relevant changes.

## Production npm audit

Run locally with:

```bash
npm run security:audit
```

The policy executes `npm audit --omit=dev --json`. `HIGH` and `CRITICAL` advisories fail by default. Moderate/low findings remain visible to npm but do not block this production gate.

The current remediation moves the application dependency graph from Next `16.2.12` to `16.3.0`. The resolved production Sharp path is `>=0.35.0`, replacing the vulnerable `<0.35.0` libvips line. Vinext remains pinned to `0.0.50`; compatibility is proven by the normal build, server suite, Docker runtime and Auth E2E checks rather than by an automatic `npm audit fix --force`.

## Temporary audit exceptions

Exceptions live only in `security/audit-allowlist.json` and use schema version 1. Every entry must contain:

- exact advisory `id`;
- exact affected `package`;
- accountable `owner`;
- meaningful `reason`;
- ISO date `expires` in `YYYY-MM-DD` form.

Expired, malformed, duplicate and stale entries fail the audit policy. A stale entry is one that no longer matches an active blocking finding, so resolved vulnerabilities force removal of obsolete exceptions.

Do not add a broad package ignore or disable the audit job to make CI green.

## SBOM

Generate the production dependency SBOM without installing a second dependency tree:

```bash
npm run security:sbom > npm-production-sbom.cdx.json
```

The command uses `--omit=dev --package-lock-only --sbom-format=cyclonedx`. CI validates the result as JSON with `bomFormat: CycloneDX` and uploads it for 14 days.

## Runtime image scan

The CI scanner builds exactly the production target:

```bash
docker build --target runtime -t portal-security-scan .
```

Trivy scans OS and packaged library vulnerabilities with `HIGH,CRITICAL`, `ignore-unfixed: true` and `exit-code: 1`. The action is pinned to commit `ed142fd0673e97e23eac54620cfb913e5ce36c25` (Trivy Action v0.36.0) instead of a floating tag.

There is currently no separate release workflow in this repository. Until one exists, this required runtime-image CI gate is the canonical pre-release image scan. A future release workflow must reuse the same target and severity policy instead of introducing a weaker scanner configuration.

## Diagnostics metadata

The admin-only local diagnostics response includes a sanitized `build` object containing only the portal version and selected framework/runtime package versions: Next, React, Vinext, Vite and Wrangler. It contains no credentials, tokens, secret values or internal endpoints.

## Dependabot

`.github/dependabot.yml` separates:

- production security updates;
- development security updates;
- routine development minor/patch version updates.

Security groups use `applies-to: security-updates`, preventing them from being treated as routine version-update groups.

## Rollback

If the dependency upgrade causes a verified runtime regression:

1. revert the dependency-security PR as one unit;
2. do not disable the audit or image-scan gates;
3. create a time-bounded allowlist entry only when a specific production advisory must temporarily remain and a compatible patched dependency does not exist;
4. preserve the failing compatibility evidence in the remediation issue/PR;
5. re-run `CI / Required CI` and `Auth E2E / auth-e2e` on the rollback head.

A rollback that restores an unhandled `HIGH` or `CRITICAL` production advisory is intentionally blocked unless the exception policy is satisfied.
