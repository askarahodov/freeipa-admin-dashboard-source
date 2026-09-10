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

## Proxy status

Repository support for `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` is **not established by this override**. The presence of variables in a container environment does not prove that the actual Node FreeIPA/XYOps clients consume them correctly. Proxy support remains a separate #52 slice and must be verified or implemented in the integration transport before it is documented as supported.

Do not put proxy credentials into this network override. Any future credential-bearing proxy configuration requires the normal secret-handling boundary.

## Legacy host networking

The canonical Compose profile does not use `network_mode: host`. Do not add it to `compose.network.local.yaml`: host networking changes the isolation model rather than solving a DNS configuration problem.

A separately named, opt-in legacy host-network compatibility override remains follow-up work in #52. Until that override has explicit safeguards and tests, host networking is not a repository-supported standard deployment profile.

## Rollback

To return to the canonical network model, stop the stack using the same override file set, remove or archive the local override outside the repository, and start with plain `docker compose up -d --build`. No database migration is associated with DNS/search/host-alias customization; the `dashboard-data` volume remains unchanged.
