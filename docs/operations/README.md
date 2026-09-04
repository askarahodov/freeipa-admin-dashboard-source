# Operations documentation

This section contains active operator-facing runbooks and operational safety contracts.

- [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md) — persistent maintenance state, guarded transitions, verification and recovery coordination.
- [`OFFLINE_FULL_RESTORE.md`](OFFLINE_FULL_RESTORE.md) — destructive offline restore, recovery point, candidate verification, atomic swap, rollback and failed-maintenance recovery.
- [`P0_OPERATIONAL_ACCEPTANCE.md`](P0_OPERATIONAL_ACCEPTANCE.md) — automated P0 operational acceptance for local authentication, persistence and report redaction.
- [`LOCAL_ACCEPTANCE_TESTS.md`](LOCAL_ACCEPTANCE_TESTS.md) — manual local acceptance scenario for authentication/RBAC, FreeIPA, XYOps, persistence and secret-safe reporting.

Other operational families remain at their current canonical paths until migrated in dedicated #268 slices. Relocation PRs must preserve external compatibility pointers and must not rewrite operational policy while moving them.
