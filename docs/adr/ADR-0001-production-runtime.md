# ADR-0001: Replace Wrangler development mode with the canonical Node production runtime

- Status: Accepted
- Date: 2026-08-07
- Implemented: 2026-08-26
- Decision owner: production runtime

## Context

The original self-hosted container used `wrangler dev --local`/Miniflare as its production host. That coupled production to a development emulator and implicit `.wrangler` persistence while the application already had stable Worker-facing HTTP, D1, scheduled-work and integration contracts.

The repository needed a production host that preserved those contracts while providing explicit process lifecycle, SQLite ownership, scheduled work, static assets and the private FreeIPA Gateway without invoking development tooling.

## Decision

Use the standalone canonical Node production runtime. `scripts/start-production.mjs` is the container entrypoint and lifecycle owner; `runtime/production-runtime.mjs` owns the production host adapters. Production must not invoke Wrangler/Vite development servers or use `.wrangler` as its persistence contract.

The Node runtime preserves application-facing contracts through explicit adapters rather than rewriting the portal into a second backend architecture. Local D1 semantics are provided by the SQLite adapter, scheduled catalog work is lifecycle-managed by the runtime, and the FreeIPA Gateway remains private and loopback-only.

## Consequences

Positive:

- production no longer depends on Wrangler/Miniflare development mode;
- process signals, startup/readiness and shutdown have one explicit owner;
- persistence is explicit under `/data` rather than framework cache state;
- runtime security/dependency surface is easier to audit;
- existing portal/domain contracts remain reusable.

Constraints:

- the Node/D1 compatibility adapters are production infrastructure and require regression tests;
- deployment must provide persistent `/data` for the SQLite store;
- unsupported development launchers must not be reintroduced as production fallbacks;
- changes to runtime topology must preserve security/readiness contracts or supersede this ADR.

## Canonical evidence / owners

- `Dockerfile` — production image command;
- `scripts/start-production.mjs` — canonical launcher and lifecycle coordination;
- `runtime/production-runtime.mjs` — production runtime host;
- `runtime/d1-sqlite.mjs` — local D1-compatible persistence adapter;
- `compose.yaml` — supported self-hosted topology;
- `docs/ARCHITECTURE.md` and `docs/DEPLOYMENT_MATRIX.md` — active current-state references;
- runtime, recovery, persistence and health contract tests under `tests/`.

## Supersession

This decision supersedes the former implicit architecture in which `wrangler dev --local`/Miniflare acted as the production host. It does not supersede a prior numbered ADR because that legacy topology predated the ADR registry.

Any future durable change of production hosting model must be recorded in a new ADR that explicitly supersedes ADR-0001.
