# Local D1-compatible SQLite adapter

This document defines the self-hosted production database compatibility boundary introduced for issue #51.

## Purpose

The portal application was built around a Cloudflare D1-shaped binding. The standalone Node runtime must preserve the database calling conventions used by the existing domain and migration code without carrying Wrangler/Miniflare into production and without reimplementing the complete Cloudflare D1 API.

The adapter is therefore intentionally narrow. It translates only the D1 methods actually used by this repository to one owned SQLite driver.

## Supported public surface

Database object:

- `prepare(sql)`
- `batch(preparedStatements)`

Prepared statement:

- `bind(...values)`
- `first()`
- `first(columnName)`
- `all()`
- `run()`

The adapter does **not** expose `exec()`, `raw()`, dump/export helpers, driver handles or arbitrary SQLite APIs. Repository inventory did not find a production call site that requires those methods. New surface must be justified by a concrete application/migration use case and added through behavior tests first.

## Behavioral contract

### Prepared statements

`prepare(sql)` produces an adapter-owned prepared statement. `bind()` is immutable: rebinding the same prepared statement creates an independent statement view rather than mutating parameters previously bound by another caller.

### Reads

`first()` returns one plain row object or `null`. `first(columnName)` returns that column value or `null` when no row/column exists.

`all()` returns a D1-shaped result containing `success`, plain `results` row objects and sanitized metadata. Driver-specific prototypes/row wrappers are normalized at this boundary and never escape into domain code.

### Mutations

`run()` returns D1-shaped metadata including mutation count and a safe numeric `last_row_id`. A native BigInt row id outside JavaScript's safe integer range is rejected rather than silently truncated.

### Batch

`batch()` accepts only prepared statements produced by the same adapter instance. The statements execute exactly once, in order, inside one SQLite transaction. Foreign/native statements are rejected so domain code cannot bypass the adapter boundary.

Canonical portal migrations depend on atomic batches for migration DDL and journal writes; preserving transaction semantics is therefore part of the production runtime contract.

For drivers that expose a boolean statement reader flag, the adapter can use it. The flag is **not** part of the required driver interface: built-in Node SQLite does not expose the `better-sqlite3` `.reader` property. For batch execution the adapter therefore falls back to a deliberately small SQL statement classification for the row-returning forms required by the portal (`SELECT`, `PRAGMA`, `EXPLAIN`, `VALUES`). Expanding this classification requires a concrete repository use case and a RED test.

## Driver boundary

`runtime/d1-sqlite-adapter.mjs` consumes a synchronous SQLite-driver interface with:

- `prepare(sql)` returning a statement with `get()`, `all()` and `run()`; an optional boolean `reader` hint may be present but is not required;
- `transaction(fn)` returning an executable synchronous transaction wrapper.

The concrete production driver is selected separately. It must support the repository Node baseline (`>=22.13.0`), pass production dependency audit/SBOM/Trivy gates, and pass canonical migration plus restart/recreate persistence tests before production cutover.

Domain/application modules must never import the concrete SQLite driver directly.

## Persistence boundary

The companion runtime-store contract uses `/data/portal.sqlite` by default. `/data` is the persistent writable boundary; source/build output remains read-only and `/tmp` is temporary state. SQLite pragmas and lifecycle/close behavior are owned by the runtime infrastructure layer, not domain code.

## Coordination ownership

While the #51 storage migration is active, the D1 compatibility contract is a single-owner surface. The active adapter PR owns `runtime/d1-sqlite-adapter.mjs`, `tests/d1-sqlite-adapter.test.mjs`, and this document. Parallel work that needs to change any of these paths must depend on that PR or wait until it merges; it must not introduce a second D1/SQLite adapter path.

The repository PR collision guard is the mechanical backstop for missed overlaps. A collision should be resolved by merge order, dependency ordering, or narrowing scope rather than weakening the collision policy.

## Change policy

Do not expand the adapter for convenience or theoretical D1 completeness. A new method requires:

1. a real repository call site that cannot use the existing surface;
2. a RED behavior test defining required semantics;
3. driver-independent adapter tests;
4. real SQLite integration coverage;
5. unchanged auth/RBAC/schema/audit boundaries.
