# Operations documentation

This section contains active operator-facing runbooks and operational safety contracts.

- [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md) — persistent maintenance state, guarded transitions, verification and recovery coordination.

Other operational families remain at their current canonical paths until migrated in dedicated #268 slices. Relocation PRs must preserve external compatibility pointers and must not rewrite operational policy while moving it.
