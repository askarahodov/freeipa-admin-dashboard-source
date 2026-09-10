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
| Docker Compose using repository `compose.yaml` and the runtime image from `Dockerfile` | **Supported production** | `compose.yaml`, `Dockerfile`, `scripts/start-production.mjs`, runtime tests, recovery/persistence tests | Canonical production entrypoint is the Node runtime. Dashboard and recovery use the explicit `portal` bridge network. The dashboard publishes container port `3001` to `${DASHBOARD_BIND_ADDRESS:-127.0.0.1}:${DASHBOARD_PORT:-3001}`. The `dashboard-data` named volume is mounted at `/data`; the default SQLite store is `/data/portal.sqlite`. |
| Standard Compose plus operator-local DNS/search/host-alias override | **Supported production customization** | `compose.network.example.yaml`, `docs/operations/NETWORK_CONFIGURATION.md`, architecture tests | Copy the tracked non-routable example to ignored `compose.network.local.yaml`, replace values, validate the merged model with `docker compose ... config`, and use the same ordered file set for lifecycle commands. This customization does not weaken TLS or change dashboard publication/security settings. |
| Production Node runtime with opt-in outbound HTTP(S) proxy | **Supported production customization** | `scripts/outbound-proxy-policy.mjs`, `scripts/start-production.mjs`, runtime tests, `docs/operations/NETWORK_CONFIGURATION.md` | Enable with Node's standard `NODE_USE_ENV_PROXY=1` plus HTTP(S) proxy variables. Proxying requires Node 22.21.0+ on the Node 22 line, Node 24.5.0+, or newer; startup fails closed otherwise. `NO_PROXY`/`no_proxy` must bypass `127.0.0.1` so the private Gateway bearer token never traverses the proxy. |
| Production runtime image started directly with equivalent required environment and a persistent `/data` mount | **Supported production, operator-integrated** | `Dockerfile`, `scripts/start-production.mjs`, `runtime/sqlite-runtime-store.mjs` | The repository defines the image/runtime contract, but external orchestration, restart policy, secrets injection and network exposure remain the operator's responsibility. |
| Compose recovery profile | **Supported operational/recovery mode** | `compose.yaml`, recovery image target, recovery scripts/tests | Recovery mounts the same `dashboard-data` volume at `/portal-data` and joins the explicit `portal` bridge network; use the dedicated recovery runbooks rather than ad-hoc SQLite manipulation. |
| Local package-script development server / development tooling | **Supported development** | `package.json`, development scripts and tests | Intended for development and verification only. It is not the production startup path. |
| Direct Wrangler/Vite/Miniflare development server as production | **Unsupported** | Production `Dockerfile` and `scripts/start-production.mjs` do not use the development runtime | Historical pre-#51 behavior. Do not use it as the production deployment contract. |
| Standard Compose with `network_mode: host` | **Unsupported by the canonical profile** | `compose.yaml`, `tests/architecture/compose-network-isolation.test.mjs` | The standard profile deliberately rejects host networking. A separate opt-in legacy override is tracked by #52 and is not part of the canonical deployment until it has explicit safeguards and tests. |
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
4. dashboard and recovery use the explicit `portal` bridge network rather than host networking;
5. dashboard publication defaults to host loopback (`DASHBOARD_BIND_ADDRESS=127.0.0.1`) while the process still listens on `0.0.0.0:3001` inside the container;
6. the internal FreeIPA Gateway binds only to `127.0.0.1` inside the dashboard process namespace and is not published by Compose;
7. when outbound proxying is enabled, startup validates Node proxy support, proxy URL shape, and a `127.0.0.1` bypass before loading runtime work;
8. production configuration and secrets follow `docs/reference/CONFIGURATION.md` and the dedicated security runbooks;
9. health, migration, recovery and persistence behavior is validated by repository tests rather than inferred from historical issues or plans.

Changing `DASHBOARD_BIND_ADDRESS` to a non-loopback address deliberately widens host-side exposure. Do this only when LAN/reverse-proxy access is required and combine it with the host/network controls appropriate to the deployment. `DASHBOARD_PORT` changes only the host-side published port; the container-side application port remains `3001` in the canonical Compose profile.

## External dependency networking

FreeIPA and XYOps are outbound dependencies of the dashboard container. Their temporary failure must not be treated as a portal liveness failure. Use `GET /health/dependencies` or the operator diagnostics page to distinguish the already-supported sanitized categories `dns`, `network`, `timeout`, `tls`, `authentication`, `rate_limited`, `upstream` and `protocol`; see `docs/operations/HEALTH_CONTRACTS.md` for the exact response contract.

For the canonical bridge profile:

| Symptom/category | What it means at the portal boundary | Safe first checks |
| --- | --- | --- |
| `dns` | The configured FreeIPA name could not be resolved from the container path. | Verify the configured hostname and Docker/host DNS path. Do not replace the hostname with an unverified address merely to bypass name or certificate checks. |
| `network` | A connection could not be established or was interrupted. | Verify routing, target port and network reachability from the deployment environment. Keep the portal running if liveness/readiness remain healthy. |
| `timeout` | The bounded external probe did not complete within its limit. | Check route/proxy/upstream latency and availability; do not convert dependency health into a restart loop. |
| `tls` | FreeIPA TLS verification failed. | Verify the configured hostname, certificate chain and the CA/settings path owned by #40. Do not disable certificate verification. |
| `authentication` | The upstream rejected credentials/key material. | Validate the server-side integration configuration without exposing credentials in logs or diagnostics. |

For deployments that require corporate resolver addresses, search domains, or fixed host aliases, use the repository-owned procedure in `docs/operations/NETWORK_CONFIGURATION.md` and the tracked `compose.network.example.yaml`. Keep environment-specific values in ignored `compose.network.local.yaml`; validate the merged model before startup. DNS/host aliases do not disable TLS verification and must not be used to bypass certificate-name checks.

For authorized outbound HTTP(S) proxies, use the opt-in `NODE_USE_ENV_PROXY=1` procedure in `docs/operations/NETWORK_CONFIGURATION.md`. Node applies its built-in environment proxy configuration at process startup. The portal then validates the actual Node release and requires an effective `NO_PROXY`/`no_proxy` entry for `127.0.0.1` before any runtime work begins. Proxy credentials remain server-side secrets and TLS verification remains mandatory.

## Image packaging dependencies

The final production runtime image intentionally does **not** ship the repository `node_modules` tree. The production host graph is Node built-ins plus repository-owned modules, and the generated Worker artifact must report no external runtime packages in `dist/server/vinext-externals.json`. Package and lock metadata remain part of the build/audit/SBOM workflow even though the installed project dependency tree is not copied into the final image.

The recovery image likewise does not ship project `node_modules`. It retains `sqlite3` because offline recovery performs SQLite integrity and data operations through the CLI, `util-linux` because recovery uses `flock` for exclusive locking, and `ca-certificates` for outbound TLS verification where recovery verification requires HTTPS. Both runtime and recovery remain Node 22 images because their entrypoints execute repository JavaScript/TypeScript directly.

Local recovery artifact and secret roots (`./recovery` and `./recovery-secrets` by default) are host-side operational state, not image inputs. `.dockerignore` excludes those roots together with local environment files, development/runtime caches, dependency trees and generated output directories. The tracked environment example files remain explicit exceptions where the repository requires them as documentation/test inputs.

## Known deployment limitations

The canonical Compose profile uses an explicit bridge network and loopback-default dashboard publication. Repository-owned custom DNS/search-domain/host-alias customization and opt-in outbound HTTP(S) proxying are supported through the network runbook. #52 remains open only for the explicit decision on whether a safeguarded legacy host-network compatibility override is justified and for the remaining downstream platform/acceptance handoff.

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
