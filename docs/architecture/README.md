# Architecture documentation

This directory is the canonical landing area for architecture and repository-boundary documentation tracked by #268.

The normalization is intentionally incremental: active documents remain at their current paths until each coherent family is moved together with every inbound link and the documentation-consistency contract. This index must not be treated as a second source of technical truth.

## Current canonical owners

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — current runtime topology, trust/data boundaries and major ownership.
- [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) — repository/module ownership and where-to-change routing.
- [`MODULE_COVERAGE.md`](MODULE_COVERAGE.md) — module documentation/test coverage and dependency direction.
- [`../SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md) — authoritative owner registry and precedence.
- [`../DEPLOYMENT_MATRIX.md`](../DEPLOYMENT_MATRIX.md) — supported and unsupported deployment models.
- [`../adr/README.md`](../adr/README.md) — architecture decision records and decision-history policy.

## Migration rule

For every subsequent #268 move:

1. inventory README, AGENTS, code comments, workflows, templates and tests for inbound path references;
2. move one coherent documentation family only;
3. update all inbound links and relative links in the moved documents in the same change;
4. preserve technical content unless a separately evidenced documentation defect requires correction;
5. update `docs/README.md`, `docs/DOCUMENTATION_INVENTORY.md` and documentation consistency contracts as applicable;
6. run `npm run docs:check`, relevant documentation tests and `git diff --check` before merge.

Until a document is actually moved, its existing path above remains canonical.
