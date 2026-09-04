# Architecture Decision Records

This directory is the canonical registry for Architecture Decision Records (ADRs) for the FreeIPA Admin Dashboard.

ADRs explain **why** a durable architecture choice exists. They do not replace current code, tests, active reference documentation, or runbooks as the source of truth for **what** the system does today.

## Precedence

When an ADR conflicts with current implementation evidence, use this order:

1. executable code and migrations;
2. automated tests and CI contracts;
3. active reference/runbook documentation;
4. accepted ADRs;
5. roadmap, issue, PR and historical planning material.

A conflict means the ADR must be reviewed and either updated or superseded. Historical material under `docs/superpowers/**` is planning evidence only and is never promoted to current authority merely by being linked from an ADR.

## Statuses

- **Proposed** — under review; not an architectural contract;
- **Accepted** — current durable decision supported by implementation evidence;
- **Superseded** — replaced by a newer ADR; retain the record and link both directions;
- **Rejected** — considered but intentionally not adopted.

Legacy decision-time records may retain their original metadata when rewriting it would destroy useful historical context. In that case the registry must state the current implementation disposition explicitly, and current code/tests remain authoritative.

## Required ADR structure

Every new ADR must contain Status, Context, Decision, Consequences, Canonical evidence/owners, and supersession links when applicable. ADR identifiers are stable and are never reused.

## Registry

| ADR | Current disposition | Decision |
|---|---|---|
| [ADR-0001](ADR-0001-production-runtime.md) | Accepted / implemented | Production uses the standalone canonical Node runtime rather than Wrangler development mode. The original record retains its decision-time `Proposed` metadata and detailed option analysis. |
| [ADR-0002](ADR-0002-persistence-runtime.md) | Accepted | Self-hosted production persistence uses the local SQLite-backed D1-compatible runtime with explicit `/data` ownership. |
| [ADR-0003](ADR-0003-private-freeipa-gateway.md) | Accepted | FreeIPA operations cross a private loopback Gateway boundary with ephemeral runtime credentials. |
| [ADR-0004](ADR-0004-identity-separation.md) | Accepted | Portal authentication identity and FreeIPA operation identity remain separate security concepts. |
| [ADR-0005](ADR-0005-forward-only-migrations.md) | Accepted | Schema evolution is forward-only and owned by the canonical migration lifecycle, not request handlers. |
| [ADR-0006](ADR-0006-persistent-maintenance-boundary.md) | Accepted | Persistent maintenance state is an external fail-closed safety boundary for recovery and ordinary runtime traffic. |
| [ADR-0007](ADR-0007-staged-restore.md) | Accepted | Destructive restore is staged and verified before atomic live-database replacement. |

The initial registry intentionally records only decisions with strong current implementation/reference evidence. Additional settled decisions should be added incrementally rather than inferred from historical plans.

## ADR-0001 reconciliation

ADR-0001 predates this registry and was authored before the runtime cutover. Its detailed alternatives, migration strategy and rationale remain valuable historical decision evidence, so the body is preserved instead of rewritten into a retrospective summary. The implementation subsequently selected its Option B and shipped the canonical Node runtime. Current implementation evidence is `Dockerfile`, `scripts/start-production.mjs`, `runtime/production-runtime.mjs`, `compose.yaml`, `docs/architecture/ARCHITECTURE.md`, `docs/DEPLOYMENT_MATRIX.md` and the runtime/persistence contract tests.

## Change policy

Create or update an ADR when a change alters a durable architecture boundary, persistence model, security/trust boundary, runtime topology, migration strategy, or cross-system ownership decision.

A PR changing an accepted decision must either update the ADR when the decision remains the same but its evidence/constraints changed, or add a new ADR and mark the previous one **Superseded** when the decision itself changed.

Keep implementation details in their canonical code/reference owners; ADRs capture rationale and consequences rather than duplicating full configuration or runbooks.
