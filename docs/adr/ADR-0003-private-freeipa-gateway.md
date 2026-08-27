# ADR-0003: Keep FreeIPA behind a private loopback Gateway

- Status: Accepted
- Date: 2026-08-27
- Decision owner: FreeIPA integration and production runtime security boundary

## Context

FreeIPA operations require Node-side integration behavior and sensitive upstream credentials/session material. Browser-facing portal handlers must not expose those credentials or turn the FreeIPA API into a public browser-accessible backend. The canonical production launcher can lifecycle-manage a private Gateway alongside the portal runtime.

## Decision

FreeIPA operations cross a private Node Gateway bound to loopback (`127.0.0.1`). The production launcher creates ephemeral Gateway authentication material at process start and passes only the private connection contract into the portal runtime. Gateway tokens, FreeIPA credentials and upstream session material are server-side secrets and never browser configuration.

The Gateway is part of the production process lifecycle: it starts before readiness can succeed and is closed during coordinated shutdown.

## Consequences

Positive:

- browser/API code does not directly own FreeIPA credentials or sessions;
- the integration boundary remains private even when the portal listener is externally reachable;
- production startup/shutdown can fail closed around Gateway availability;
- FreeIPA-specific Node behavior stays outside browser-facing modules.

Constraints:

- deployment topology must preserve loopback reachability between the runtime and Gateway;
- ephemeral Gateway credentials must not be persisted in `.env.example`, Compose secrets or documentation examples;
- moving the Gateway to a separate host/container requires a new trust/network decision and must not silently expose the current private protocol.

## Canonical evidence / owners

- `scripts/start-production.mjs` — Gateway lifecycle, loopback bind and ephemeral runtime values;
- `scripts/ipa-node-gateway.mjs` — Gateway implementation;
- `docs/reference/CONFIGURATION.md` — runtime configuration and ephemeral-value rules;
- `docs/SECURITY_MODEL.md` — trust boundary and secret-handling requirements;
- FreeIPA Gateway contract tests under `tests/`.

## Supersession

No prior ADR is superseded. Any change that makes this Gateway remotely reachable or changes its trust/authentication boundary requires a new ADR that supersedes this decision.
