# ADR-0006: Persistent maintenance mode as an external safety boundary

- Status: Accepted
- Date: 2026-08-27
- Decision owner: maintenance/recovery boundary

## Context

Selective restore and destructive offline recovery require a durable way to stop ordinary user mutations and scheduled work across process restarts. An in-memory flag or operator convention would be insufficient because restart is part of the recovery workflow.

## Decision

Maintenance mode is persistent state stored in `portal_maintenance_state` and enforced as an external safety boundary before ordinary Worker API execution. The state survives restart and fails closed when its persisted representation is invalid or unreadable.

Entering, verifying and exiting maintenance are explicit state-machine transitions guarded by administrative authorization, same-origin protections and the service-admin boundary where applicable.

## Consequences

- recovery operations keep their safety boundary across restarts;
- scheduled work and ordinary API activity can be deterministically blocked;
- maintenance cannot silently clear because of process restart or timeout;
- corrupted maintenance state is treated as unsafe rather than ignored;
- operators must explicitly complete or cancel the maintenance workflow.

## Canonical evidence / owners

- maintenance runtime and `portal_maintenance_state` persistence;
- `docs/MAINTENANCE_MODE.md`;
- `docs/OFFLINE_FULL_RESTORE.md`;
- maintenance/recovery contract tests under `tests/`.

## Supersession

No earlier numbered ADR is superseded. Any future move to an ephemeral or externally-owned maintenance gate must explicitly supersede this ADR.