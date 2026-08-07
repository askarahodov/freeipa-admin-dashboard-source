# Dependabot Capacity Policy

Dependabot updates share the same GitHub-hosted Actions capacity as human and AI-agent pull requests. Dependency automation must therefore remain bounded without weakening security-update coverage.

## Version-update capacity

The repository allows at most three open npm **version-update** pull requests at a time. Existing minor/patch development updates remain grouped as `routine-development` so routine tool maintenance does not fan out into many independent CI runs.

Only one GitHub Actions **version-update PR** may be open at a time. Action runtime changes affect CI itself, so they should be reviewed and merged deliberately before the next Actions version update is opened.

## Security updates

The npm `production-security` and `development-security` groups remain enabled. Dependabot security updates are not constrained by `open-pull-requests-limit`; that option applies to version updates, so reducing version-update fan-out must never be used to disable, defer or hide security updates.

## High-risk dependency changes

Major runtime and toolchain changes remain individually reviewable. Do not hide major changes to runtime/framework/build surfaces such as Wrangler, Vinext/Vite, TypeScript, ESLint or similar infrastructure inside a broad routine group merely to reduce PR count.

When a runtime migration or CI topology change is active, explicitly order overlapping dependency updates after the owning migration PR. A dependency PR that changes the same runtime/CI surface should be rebased or recreated after the owner merges rather than merged from a stale base.

## CI contract

All dependency PRs use the sharded CI introduced by #151: deterministic test discovery, dependency audit + CycloneDX SBOM, build validation, runtime-image Trivy, at most eight normal server-test shards, recovery verification and Auth E2E routing.

Reducing Dependabot PR fan-out is a capacity control only. It must not remove or bypass audit, SBOM, Trivy, recovery, Auth E2E, or PR Collision Guard requirements.
