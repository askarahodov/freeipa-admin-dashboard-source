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
| 4 | `b6370cf552347d4e27b848968bdba95e9ce5e31c` | [34462924906](https://github.com/askarahodov/freeipa-admin-dashboard-source/actions/runs/34462924906) | success | 145 s | about 3 s | 153 s | 31–43 s | `ubuntu-latest` |
| 2 | `2846ad3a56cef1a10e62005b4d9c2b528ab5218c` | [34463393347](https://github.com/askarahodov/freeipa-admin-dashboard-source/actions/runs/34463393347) | success | 168 s | about 25 s | 97 s | 47–50 s | `ubuntu-latest` |
| 2 | `95af6400b3d0d24fc731016916f7651fdc457e73` | [34463685757](https://github.com/askarahodov/freeipa-admin-dashboard-source/actions/runs/34463685757) | success | 132 s | about 3 s | 89 s | 44–45 s | `ubuntu-latest` |

The first 8-shard control had shard windows of 30, 31, 34, 30, 34, 31, 33, and 34 seconds. The second control had 31, 28, 37, 29, 32, 32, 31, and 31 seconds. In both controls the actual `Run shard` work was much smaller than the whole job window, confirming repeated setup and `npm ci` as the dominant shard cost.

The two 4-shard samples used 144 s and 153 s of shard-job time, for a 148.5 s mean: about 41.5% below the 254 s 8-shard mean. Their workflow walls were 169 s and 145 s, averaging 157 s, about 5.7% above the 148.5 s 8-shard wall mean and therefore comfortably inside the 15% adoption ceiling.

The two 2-shard samples used 97 s and 89 s of shard-job time, for a 93 s mean: about 63.4% below the 254 s 8-shard mean and about 37.4% below the 148.5 s 4-shard mean. Their workflow walls were 168 s and 132 s, averaging 150 s, about 1.0% above the 148.5 s 8-shard wall mean and well inside the 15% adoption ceiling. The first 2-shard sample carried about 25 s of queue delay; the second had about 3 s, explaining much of the wall-time variance without changing the shard workload.

## Decision

Adopt 2 shards. It has two successful comparable measurements, the lowest measured runner cost, and no material wall-time regression versus the 8-shard control. The current workflow therefore keeps `--max-shards 2` while preserving deterministic exact-once coverage, non-empty shards, `strategy.fail-fast: false`, `--test-concurrency=1`, and all existing security/recovery/Required CI gates.

Weighted balancing is not justified: the 2-shard job windows were 47–50 s and 44–45 s, so the observed partition is already balanced while repeated setup remains a significant fraction of each job.
