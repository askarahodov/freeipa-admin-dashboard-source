# Server test shard-count experiment (#564)

This file records measured evidence for the #564 optimization under epic #560. It is a point-in-time experiment, not a permanent performance guarantee.

## Invariants and method

- Candidate counts: 8, 4, and 2 shards.
- The discovered server-test inventory must remain unchanged across the candidate measurement commits after the initial contract update.
- `scripts/ci-test-shards.mjs` remains the single deterministic partitioner and must preserve exact-once membership.
- `strategy.fail-fast: false` and `--test-concurrency=1` are preserved.
- Primary cost metric: sum of each completed `Test shard NN` job window (`started_at` → `completed_at`).
- CI wall time and queue delay are recorded separately.
- Adoption requires at least two successful comparable measurements for a candidate and no more than 15% wall-time regression versus the comparable 8-shard control.
- Cache state is not inferred when the Actions evidence does not prove it.

## Measurements

| Candidate | Head SHA | CI run | Result | Workflow wall | Queue to first job | Shard-job sum | Shard job range | Runner |
| ---: | --- | --- | --- | ---: | ---: | ---: | ---: | --- |
| 8 | `8b89f56961aa9b2ed0e9084eff4d57f86023dabc` | [34461645490](https://github.com/askarahodov/freeipa-admin-dashboard-source/actions/runs/34461645490) | success | 150 s | about 12 s | 257 s | 30–34 s | `ubuntu-latest` |

For the first 8-shard control, the shard job windows were 30, 31, 34, 30, 34, 31, 33, and 34 seconds (shards 01–08 respectively). The `Run shard` steps were only about 4–7 seconds; repeated runner setup and `npm ci` dominate the total.

## Decision

Pending the second 8-shard control and two measurements each for 4 and 2 shards. Weighted balancing is not justified unless those measurements show a material runtime imbalance.
