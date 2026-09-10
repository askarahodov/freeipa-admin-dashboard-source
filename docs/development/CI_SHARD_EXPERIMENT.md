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
| 8 | `11487104ebb8c2630a6dff1007dc9620f9d9d119` | [34461961812](https://github.com/askarahodov/freeipa-admin-dashboard-source/actions/runs/34461961812) | success | 147 s | about 3 s | 251 s | 28–37 s | `ubuntu-latest` |
| 4 | `a9f27ee0023c3bce88919a2fa099a59cecf086ee` | [34462566157](https://github.com/askarahodov/freeipa-admin-dashboard-source/actions/runs/34462566157) | success | 169 s | about 12 s | 144 s | 33–41 s | `ubuntu-latest` |

The first 8-shard control had shard windows of 30, 31, 34, 30, 34, 31, 33, and 34 seconds. The second control had 31, 28, 37, 29, 32, 32, 31, and 31 seconds. In both controls the actual `Run shard` work was much smaller than the whole job window, confirming repeated setup and `npm ci` as the dominant shard cost.

The first 4-shard sample reduced the shard-job sum from the 8-shard mean of 254 s to 144 s (about 43% less). Its 169 s workflow wall time was about 13.8% above the 148.5 s two-control mean, still inside the 15% adoption ceiling but close enough that the second 4-shard measurement is required before any decision.

## Decision

Pending the second 4-shard measurement and two measurements for 2 shards. Weighted balancing is not justified unless those measurements show a material runtime imbalance.
