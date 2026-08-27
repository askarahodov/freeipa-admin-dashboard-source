# ADR-0002: Explicit local SQLite/D1 production persistence

- Status: Accepted
- Date: 2026-08-27
- Decision owner: production runtime and persistence contracts

## Context

The portal domain is written against a D1-compatible database boundary. After the production runtime moved away from Wrangler/Miniflare, self-hosted production needed an explicit persistence owner rather than an emulator-owned `.wrangler` directory. The canonical Node runtime now provides the D1-compatible SQLite adapter and Compose persists its data directory.

## Decision

Self-hosted production keeps the existing D1-facing application contract and implements it with the narrow local SQLite adapter owned by `runtime/d1-sqlite.mjs`. Persistent application data is rooted at `/data`; the default database is `/data/portal.sqlite`. Docker Compose mounts its named application-data volume at `/data`.

This decision does not make local SQLite a horizontally shared database. Multiple active portal replicas sharing one local SQLite file are unsupported unless a future architecture decision replaces this storage topology.

## Consequences

Positive:

- domain code keeps one D1-style persistence contract;
- production persistence has an explicit operator-visible path;
- backup/recovery and container recreation can reason about one named data volume;
- no Wrangler state directory is part of the production contract.

Constraints:

- `/data` must be persistent for production deployments;
- local SQLite constrains horizontal active/active scaling;
- schema lifecycle remains owned by canonical migrations rather than request-time schema creation.

## Canonical evidence / owners

- `runtime/d1-sqlite.mjs` — D1-compatible SQLite adapter and database path handling;
- `runtime/production-runtime.mjs` — production runtime ownership;
- `compose.yaml` — named volume mounted at `/data`;
- `tests/compose-persistence-contract.test.mjs` — regression contract tying Compose, Dockerfile and SQLite defaults together;
- `docs/DEPLOYMENT_MATRIX.md` — supported deployment consequences;
- `docs/DATABASE_MIGRATIONS.md` — schema/migration lifecycle.

## Supersession

Supersedes the implicit production persistence ownership previously inherited from Wrangler/Miniflare `.wrangler` state. A future change to the production database technology or shared multi-replica storage model requires a new ADR that supersedes this one.
