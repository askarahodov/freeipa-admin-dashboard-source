## Summary

<!-- What changed and why? Keep the PR scope narrow and link the owning issue. -->

## Validation

<!-- Exact lint/build/test/inspection commands executed and their result. Do not claim checks that were not run. -->

## Security and operational impact

- [ ] No security or operational contract change
- [ ] Auth/RBAC/same-origin impact reviewed
- [ ] Secrets/PII/logging/redaction impact reviewed
- [ ] Migration/backup/recovery impact reviewed
- [ ] Deployment/health/runtime impact reviewed

If a box is applicable, explain the impact in the PR description.

## Documentation impact

- [ ] No documentation impact — reason provided below
- [ ] README/index updated
- [ ] Architecture/ADR updated
- [ ] API/reference updated
- [ ] Configuration reference/examples updated
- [ ] Security/runbook updated
- [ ] Tests and verification commands documented
- [ ] Superseded or stale information removed

### Documentation notes

<!-- State which documents are authoritative for this change and why no update is needed for unchecked areas. -->

## Coordination

Owning issue: <!-- Required. Use #123 or explicitly state none. -->
Canonical domain / contract: <!-- Required. Name the existing owner, not a proposed replacement. -->
High-conflict paths: <!-- Required. List paths such as app/page.tsx, worker/index.ts, db/**, workflows, or state none. -->
Dependencies / merge order: <!-- Required. Link blocking/stacked PRs and state the order, or state none. -->
Parallel-safe with: <!-- Required. Name known independent work or state none identified. -->
Explicitly out of scope: <!-- Required. State adjacent contracts this PR will not change. -->

- [ ] Active pull requests and branches were inspected before implementation
- [ ] Overlaps are absent or documented above with explicit ownership and merge order

## Source-of-truth review

- [ ] Existing owner/source of truth was identified before adding a new contract
- [ ] No parallel implementation or duplicate documentation owner was introduced
- [ ] Current-state claims were checked against the target branch, not only an issue/plan

## Rollback / recovery

<!-- For code/config/schema changes, describe rollback or explain why it is not applicable. -->
