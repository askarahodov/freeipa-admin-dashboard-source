# Local D1-compatible SQLite adapter

This document defines the self-hosted production database compatibility boundary introduced for issue #51.

## Purpose

The portal application was built around a Cloudflare D1-shaped binding. The standalone Node runtime must preserve the database calling conventions used by the existing domain and migration code without carrying Wrangler/Miniflare into production and without reimplementing the complete Cloudflare D1 API.

The adapter is therefore intentionally narrow. It translates the D1 methods that are actually used by this repository to one owned SQLite driver.

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

`first()` returns one row or `null`. `first(columnName)` returns that column value or `null` when no row/column exists.

`all()` returns a D1-shaped result containing `success`, `results` and sanitized metadata. Native driver objects are not exposed.

### Mutations

`run()` returns D1-shaped metadata including mutation count and a safe numeric `last_row_id`. A native BigInt row id outside JavaScript's safe integer range is rejected rather than silently truncated.

### Batch

`batch()` accepts only prepared statements produced by the same adapter instance. The statements execute exactly once, in order, inside one SQLite transaction. Foreign/native statements are rejected so domain code cannot bypass the adapter boundary.

Canonical portal migrations depend on atomic batches for migration DDL and journal writes; preserving transaction semantics is therefore part of the production runtime contract.

## Driver boundary

`runtime/d1-sqlite-adapter.mjs` currently consumes only a synchronous SQLite-driver interface with:

- `prepare(sql)` returning a statement with `reader`, `get()`, `all()` and `run()`;
- `transaction(fn)` returning an executable transaction wrapper.

The concrete production driver is selected separately. It must support the repository Node baseline (`>=22.13.0`), pass production dependency audit/SBOM/Trivy gates, and pass canonical migration plus restart/recreate persistence tests before production cutover.

Domain/application modules must never import the concrete SQLite driver directly.

## Persistence boundary

The companion runtime-store contract uses `/data/portal.sqlite` by default. `/data` is the persistent writable boundary; source/build output remains read-only and `/tmp` is temporary state. SQLite pragmas and lifecycle/close behavior are owned by the runtime infrastructure layer, not domain code.

## Change policy

Do not expand the adapter for convenience or theoretical D1 completeness. A new method requires:

1. a real repository call site that cannot use the existing surface;
2. a RED behavior test defining required semantics;
3. driver-independent adapter tests;
4. real SQLite integration coverage;
5. unchanged auth/RBAC/schema/audit boundaries.
