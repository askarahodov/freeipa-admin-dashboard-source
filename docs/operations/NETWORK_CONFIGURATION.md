# Production network configuration

This runbook describes the repository-supported network controls for the Docker Compose deployment. Canonical topology remains owned by `compose.yaml`; TLS/CA settings remain owned by the FreeIPA integration configuration and security documentation.

## Default topology

The standard profile uses the explicit `portal` bridge network. The dashboard process listens on container port `3001`, while Compose publishes it to `${DASHBOARD_BIND_ADDRESS:-127.0.0.1}:${DASHBOARD_PORT:-3001}` on the host. The private FreeIPA Gateway is created inside the dashboard process namespace and binds only to `127.0.0.1`; it is never a Compose-published service.

Keep the default loopback host publication unless clients or a reverse proxy must reach the dashboard from outside the host. Changing `DASHBOARD_BIND_ADDRESS` widens host-side exposure and does not configure TLS or a trusted proxy by itself.

## Custom DNS, search domains, and host aliases

Use the tracked `compose.network.example.yaml` only as a template. Do not edit it into environment-specific state in Git.

Create the ignored local override:

```bash
cp compose.network.example.yaml compose.network.local.yaml
```

Edit `compose.network.local.yaml` and replace every documentation-only address/domain with values supplied by the deployment/network owner. The example addresses are deliberately non-routable documentation ranges.

Supported service attributes in this override are limited to:

```yaml
services:
  dashboard:
    dns:
      - 10.0.0.53
    dns_search:
      - corp.example
    extra_hosts:
      freeipa.corp.example: "10.0.0.10"
      xyops.corp.example: "10.0.0.20"
```

`dns` sets resolver addresses for the dashboard container. `dns_search` sets resolver search domains. `extra_hosts` adds explicit hostname-to-address mappings to the container host table. Prefer normal DNS when available; use `extra_hosts` only for a deliberate fixed mapping with an operational owner.

Before startup, render the merged model:

```bash
docker compose -f compose.yaml -f compose.network.local.yaml config
```

Inspect the resulting `dashboard` service. It must still use the `portal` network, retain the normal dashboard port publication, volume/security settings, and contain only the intended DNS/search/host entries from the local override.

Start using the same explicit file set:

```bash
docker compose -f compose.yaml -f compose.network.local.yaml up -d --build
```

Use that same `-f compose.yaml -f compose.network.local.yaml` file order for subsequent `ps`, `logs`, `restart`, `down`, and upgrade commands so the effective model is reproducible.

`compose.network.local.yaml` is ignored by Git and Docker build context. Treat it as operator-local topology state. Do not put passwords, API keys, bearer tokens, cookies, private keys, CA private material, or other secrets in it.

## Outbound HTTP(S) proxy

The production Node runtime supports an explicit process-wide outbound proxy for the existing `fetch` transports used by FreeIPA and XYOps. Proxying is opt-in and uses Node's built-in environment-proxy implementation; the portal does not ship a second proxy client or disable TLS verification.

Enable it only on a Node release that implements built-in proxy support: Node `22.21.0+` on the Node 22 line, Node `24.5.0+`, or a newer supported major. The general portal runtime can still run on the broader Node version declared by `package.json` when proxying is disabled. Startup fails closed if proxying is requested on an unsupported Node version.

Canonical environment variables are:

```env
NODE_USE_ENV_PROXY=1
HTTP_PROXY=http://proxy.company.local:8080
HTTPS_PROXY=http://proxy.company.local:8080
NO_PROXY=localhost,127.0.0.1,.company.local
```

Node also recognizes lowercase `http_proxy`, `https_proxy`, and `no_proxy`; when both cases are present, lowercase values take precedence. The startup validator uses the same precedence so validation cannot approve one value while Node consumes another.

At least one HTTP(S) proxy URL must be configured when `NODE_USE_ENV_PROXY=1`. Proxy URLs may contain authentication credentials, for example `http://user:password@proxy.example:8080`; such values are secrets and must remain only in the server-side environment or deployment secret mechanism. Do not copy them into issues, logs, diagnostics, screenshots, or the DNS override.

`NO_PROXY`/`no_proxy` **must include the exact host `127.0.0.1`** (or `*`). This is a security boundary, not merely an availability recommendation: Worker requests to the private FreeIPA Gateway use `http://127.0.0.1:<ephemeral-port>` and carry an ephemeral bearer token. Startup rejects an enabled proxy configuration that would allow this loopback request to be routed through the proxy.

Proxy enablement is applied before Worker loading, Gateway startup, application startup, or scheduler activity. The supported path affects the default Node global HTTP(S) agents and global `fetch` dispatcher used by the production process. It therefore covers the existing outbound FreeIPA Gateway `fetch` and XYOps `fetch` paths without changing their request/response, authentication, timeout, redirect, or TLS contracts.

Do not use proxy configuration to work around a `tls` dependency-health result. HTTPS requests still require valid hostname/certificate/CA verification. If an authorized enterprise proxy performs TLS interception, its trust chain must be installed/configured through the deployment's normal CA policy; disabling certificate verification remains unsupported.

### Proxy verification

After enabling the proxy, start the normal production stack and verify:

```text
GET /health/live
GET /health/ready
GET /health/dependencies
```

Expected interpretation:

- `/health/live` remains independent of FreeIPA/XYOps;
- `/health/ready` proves the private loopback Gateway remains reachable directly;
- `/health/dependencies` exercises the existing external dependency transports and reports sanitized `dns`, `network`, `timeout`, `tls`, `authentication`, `rate_limited`, `upstream`, or `protocol` categories without exposing proxy URLs or credentials.

If startup rejects the proxy configuration, fix the Node version, proxy URL, or loopback `NO_PROXY` entry rather than bypassing the validator. If dependency health fails after startup, troubleshoot the authorized proxy/network path while preserving TLS verification.

### Proxy rollback

Remove `NODE_USE_ENV_PROXY=1` (and any proxy variables that are not needed by other processes) and restart the dashboard. Proxy enablement is startup-scoped; no database or schema migration is involved.

## Verification

First verify the portal itself:

```text
GET /health/live
GET /health/ready
```

Then verify external dependencies through the existing sanitized contract:

```text
GET /health/dependencies
GET /diagnostics/health
```

Interpret dependency categories according to `HEALTH_CONTRACTS.md`:

- `dns`: configured FreeIPA name could not be resolved from the container path;
- `network`: connection could not be established or was interrupted;
- `timeout`: bounded dependency probe did not finish in time;
- `tls`: FreeIPA TLS verification failed;
- `authentication`: upstream rejected configured credentials/key material.

A FreeIPA/XYOps dependency failure is not a liveness failure. Do not create a restart loop while `/health/live` remains healthy.

For DNS failures, confirm the configured hostname and the effective container resolver/host mapping. Do not substitute an arbitrary IP merely to bypass certificate-name validation. For TLS failures, repair hostname/certificate/CA configuration; do not disable certificate verification.

## Legacy host networking

The canonical Compose profile does not use `network_mode: host`. Do not add it to `compose.network.local.yaml`: host networking changes the isolation model rather than solving a DNS configuration problem.

A separately named, opt-in legacy host-network compatibility override remains follow-up work in #52. Until that override has explicit safeguards and tests, host networking is not a repository-supported standard deployment profile.

## Rollback

To return to the canonical network model, stop the stack using the same override file set, remove or archive the local override outside the repository, and start with plain `docker compose up -d --build`. No database migration is associated with DNS/search/host-alias customization; the `dashboard-data` volume remains unchanged.
