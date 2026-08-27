# ADR-0007: Staged restore with verification before live swap

- Status: Accepted
- Date: 2026-08-27
- Decision owner: backup/restore/recovery

## Context

Destructive restore of the local portal database must avoid partially replacing the live SQLite store, restoring unsafe session state, or accepting a corrupted candidate. Recovery also needs a deterministic resume path after interruption.

## Decision

Restore is staged. A candidate is materialized and verified before the live database path changes. Destructive full restore runs offline under persistent maintenance, creates a separate recovery point, validates the candidate, and only then performs an atomic same-filesystem swap with receipt-driven recovery semantics.

Historical portal sessions are not restored as trusted active sessions. Secrets used by recovery are supplied through protected files rather than argv or persisted configuration.

## Consequences

- failed validation leaves the live database untouched;
- interrupted operations can resume from explicit receipt/state rather than filename heuristics;
- rollback has a known recovery point;
- recovery is operationally heavier than blind file replacement, but failures are bounded and auditable;
- maintenance mode is a required dependency of destructive restore.

## Canonical evidence / owners

- `docs/OFFLINE_FULL_RESTORE.md`;
- recovery CLI/scripts and receipt/state implementation;
- maintenance-mode owner and `docs/MAINTENANCE_MODE.md`;
- recovery/restore contract tests under `tests/`.

## Supersession

No earlier numbered ADR is superseded. A future restore architecture that changes atomic-swap or staged-validation ownership must explicitly supersede this ADR.