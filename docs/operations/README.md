# Operations documentation

This section contains active operator-facing runbooks and operational safety contracts.

- [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md) — persistent maintenance state, guarded transitions, verification and recovery coordination.
- [`OFFLINE_FULL_RESTORE.md`](OFFLINE_FULL_RESTORE.md) — destructive offline restore, recovery point, candidate verification, atomic swap, rollback and failed-maintenance recovery.
- [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md) — canonical schema migration lifecycle, journal, drift detection and controlled apply contract.
- [`STORAGE_STATUS.md`](STORAGE_STATUS.md) — bounded read-only storage status contract.
- [`STORAGE_INTEGRITY.md`](STORAGE_INTEGRITY.md) — read-only SQLite/index integrity diagnostics and operator boundary.
- [`P0_OPERATIONAL_ACCEPTANCE.md`](P0_OPERATIONAL_ACCEPTANCE.md) — automated P0 operational acceptance for local authentication, persistence and report redaction.
- [`LOCAL_ACCEPTANCE_TESTS.md`](LOCAL_ACCEPTANCE_TESTS.md) — manual local acceptance scenario for authentication/RBAC, FreeIPA, XYOps, persistence and secret-safe reporting.
- [`HEALTH_CONTRACTS.md`](HEALTH_CONTRACTS.md) — liveness, readiness, dependency-health and operator-diagnostics contracts.
- [`HEALTH_METRICS.md`](HEALTH_METRICS.md) — Prometheus-compatible health metrics, cardinality and alerting baseline.

Other operational families remain at their current canonical paths until migrated in dedicated #268 slices. Relocation PRs must preserve external compatibility pointers and must not rewrite operational policy while moving them.
