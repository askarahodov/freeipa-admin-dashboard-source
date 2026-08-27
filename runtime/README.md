# Runtime module

`runtime/` owns the canonical self-hosted production host used by `scripts/start-production.mjs`.

## Responsibilities

- host the built application in Node production runtime;
- provide the local D1-compatible SQLite adapter and explicit `/data` persistence boundary;
- coordinate scheduler, private FreeIPA Gateway lifecycle and graceful shutdown;
- preserve existing application/security/health contracts rather than reimplementing them.

## Non-responsibilities

- do not move domain authorization, route registries, permission definitions or schema ownership into `runtime/`;
- do not make domain modules import Node runtime internals;
- do not introduce Wrangler/Vite development servers as production fallback paths.

## Canonical references

- `scripts/start-production.mjs`
- `runtime/production-runtime.mjs`
- `runtime/d1-sqlite-adapter.mjs`
- `docs/ARCHITECTURE.md`
- `docs/DEPLOYMENT_MATRIX.md`
- `docs/reference/CONFIGURATION.md`
- `docs/adr/README.md`

## Verification

Changes here normally require the production-runtime/persistence/health/shutdown contract tests and Required CI. Changes to persistence paths or Compose interaction also require `tests/compose-persistence-contract.test.mjs`.

Update architecture, deployment, configuration and the relevant ADR when a change alters a durable runtime topology or ownership decision.