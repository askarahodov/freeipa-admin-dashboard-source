# Deployment support matrix

This document describes the deployment modes that are supported by the current repository state. It is a current-state reference, not a roadmap. Canonical runtime behavior remains owned by `Dockerfile`, `compose.yaml`, `scripts/start-production.mjs`, runtime code and their tests.

## Status definitions

- **Supported production** — repository-owned production path with explicit runtime, persistence and CI/acceptance coverage.
- **Supported development** — intended for local development/test only; not a production topology.
- **Temporary / constrained** — currently used by the supported path but known to require hardening or replacement; limitations are tracked explicitly.
- **Unsupported** — no repository-owned production contract or acceptance guarantee.

## Matrix

| Deployment mode | Status | Canonical owner / evidence | Notes |
| --- | --- | --- | --- |
| Docker Compose using repository `compose.yaml` and the runtime image from `Dockerfile` | **Supported production** | `compose.yaml`, `Dockerfile`, `scripts/start-production.mjs`, runtime tests, recovery/persistence tests | Canonical production entrypoint is the Node runtime. The `dashboard-data` named volume is mounted at `/data`; the default SQLite store is `/data/portal.sqlite`. |
| Production runtime image started directly with equivalent required environment and a persistent `/data` mount | **Supported production, operator-integrated** | `Dockerfile`, `scripts/start-production.mjs`, `runtime/sqlite-runtime-store.mjs` | The repository defines the image/runtime contract, but external orchestration, restart policy, secrets injection and network exposure remain the operator's responsibility. |
| Compose recovery profile | **Supported operational/recovery mode** | `compose.yaml`, recovery image target, recovery scripts/tests | Recovery mounts the same `dashboard-data` volume at `/portal-data`; use the dedicated recovery runbooks rather than ad-hoc SQLite manipulation. |
| Local package-script development server / development tooling | **Supported development** | `package.json`, development scripts and tests | Intended for development and verification only. It is not the production startup path. |
| Direct Wrangler/Vite/Miniflare development server as production | **Unsupported** | Production `Dockerfile` and `scripts/start-production.mjs` do not use the development runtime | Historical pre-#51 behavior. Do not use it as the production deployment contract. |
| Current Compose `network_mode: host` networking | **Temporary / constrained** | `compose.yaml`; replacement tracked by #52 | It is part of the current Compose topology, but it weakens isolation and portability. #52 owns migration to an explicit bridge-network model. Do not infer that host networking is the long-term target architecture. |
| Kubernetes / Helm deployment | **Unsupported by this repository today** | No canonical chart/manifests/acceptance contract in current repository | A custom deployment may be possible, but this repository does not currently guarantee Kubernetes/Helm lifecycle, probes, storage, networking, upgrades or rollback semantics. |
| Multiple active replicas sharing the same local SQLite database | **Unsupported** | Canonical runtime uses local SQLite under `PORTAL_DATA_DIR` | The repository does not provide a distributed locking/storage contract for horizontally scaled active replicas. |
| SQLite database path outside `PORTAL_DATA_DIR` | **Unsupported** | `runtime/sqlite-runtime-store.mjs` | `PORTAL_DATABASE_PATH`, when set, must remain inside `PORTAL_DATA_DIR`. |
| Arbitrary writable source-tree runtime | **Unsupported** | Multi-stage production `Dockerfile` | Production is expected to run the built artifact and runtime dependencies, not a mutable source checkout or interactive build server. |

## Launcher command contract

Package-script names distinguish production from development runtimes explicitly:

| Command | Contract | Notes |
| --- | --- | --- |
| `npm start` | **Production** | Alias for `npm run start:production`. Requires the built Worker/client artifacts and production configuration; Docker Compose remains the normal self-hosted production path. |
| `npm run start:production` | **Production** | Starts the canonical Node runtime through `scripts/start-production.mjs`, matching the production `Dockerfile` entrypoint. |
| `npm run dev` | **Development** | Starts the Vite development workflow. It is not a production deployment mode. |
| `npm run start:vinext:dev` | **Development** | Starts the Vinext development/runtime tooling explicitly. It is not the production Node runtime. |
| `npm run start:worker:dev` | **Legacy development** | Starts `scripts/start-worker.mjs`, which uses local Wrangler persistence under `.wrangler`. Use only when that legacy local Worker runtime is intentionally required. |
| `npm run start:docker` | **Deprecated compatibility alias** | Preserved for existing callers, but emits a warning and delegates to the legacy development Worker runtime. It is **not** the Docker production entrypoint. Migrate callers to an explicit production or development command. |

The command name `start:docker` is retained only to avoid silently breaking unknown external automation. Production Docker/Compose continues to use the image `CMD` and `scripts/start-production.mjs`; it does not invoke `npm run start:docker`.

Do not point the production runtime at `.wrangler` persistence. The canonical production persistence contract remains `PORTAL_DATA_DIR=/data` (default database `/data/portal.sqlite`), while `.wrangler` belongs to legacy/local development tooling.

## Production invariants

The supported production contract currently assumes:

1. the image starts `scripts/start-production.mjs` through the `Dockerfile` command;
2. `PORTAL_DATA_DIR` defaults to `/data` and the default database is `/data/portal.sqlite`;
3. persistent deployment mounts durable storage at `/data`;
4. the internal FreeIPA Gateway remains process-private/loopback and is not exposed as a public service;
5. production configuration and secrets follow `docs/reference/CONFIGURATION.md` and the dedicated security runbooks;
6. health, migration, recovery and persistence behavior is validated by repository tests rather than inferred from historical issues or plans.

## Image packaging dependencies

The final production runtime image intentionally does **not** ship the repository `node_modules` tree. The production host graph is Node built-ins plus repository-owned modules, and the generated Worker artifact must report no external runtime packages in `dist/server/vinext-externals.json`. Package and lock metadata remain part of the build/audit/SBOM workflow even though the installed project dependency tree is not copied into the final image.

The recovery image likewise does not ship project `node_modules`. It retains `sqlite3` because offline recovery performs SQLite integrity and data operations through the CLI, `util-linux` because recovery uses `flock` for exclusive locking, and `ca-certificates` for outbound TLS verification where recovery verification requires HTTPS. Both runtime and recovery remain Node 22 images because their entrypoints execute repository JavaScript/TypeScript directly.

Local recovery artifact and secret roots (`./recovery` and `./recovery-secrets` by default) are host-side operational state, not image inputs. `.dockerignore` excludes those roots together with local environment files, development/runtime caches, dependency trees and generated output directories. The tracked environment example files remain explicit exceptions where the repository requires them as documentation/test inputs.

## Known deployment limitations

The current supported Compose path still uses host networking. This is a known deployment-hardening limitation owned by #52. A limitation being documented here does not make alternative, untested network topologies automatically supported.

TLS reverse-proxy hardening is tracked separately by #53. Until a repository-owned reverse-proxy profile is implemented and accepted, operators may place the service behind their own proxy, but repository support does not imply guarantees for arbitrary forwarded-header, TLS-termination or proxy configurations.

## Adding a new supported deployment mode

A deployment mode should not be marked **Supported production** until the repository has all of the following:

- an explicit startup/runtime owner;
- a persistence and migration contract;
- documented network and secret boundaries;
- health/readiness behavior;
- upgrade/rollback or recovery semantics;
- deterministic automated tests or acceptance evidence;
- documentation updated in the same change.

If any of these are missing, document the mode as development, constrained or unsupported rather than relying on "it appears to work".
