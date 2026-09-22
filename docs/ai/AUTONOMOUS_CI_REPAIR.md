# Autonomous CI repair loop

The executable policy owner for Autonomous Development V1 CI repair is `scripts/autonomous-ci-repair.mjs`.

This contract begins only after a valid PR checkpoint from [`AUTONOMOUS_EXECUTION_CONTRACT.md`](AUTONOMOUS_EXECUTION_CONTRACT.md). It does not replace Required CI, Scoped E2E, the risk planner, review, or the later merge gate.

## Core rule

A red GitHub check is **evidence to classify**, not permission to edit code or rerun indefinitely.

Every repair decision is bound to the exact PR head SHA and to concrete GitHub workflow/job evidence. A failure from an older head cannot authorize a retry or code change on the current head.

## Evidence boundary

The orchestrator reads actual GitHub run/job/step state and sanitized relevant log evidence, then provides a normalized snapshot to the deterministic policy engine.

Required identity evidence includes:

- bounded autonomous repair-run ID;

- expected PR head SHA;
- workflow run ID/name/head SHA/status/conclusion;
- failed job ID/run ID/name/status/conclusion;
- failed step name when available;
- a **sanitized concise log signature**.

The policy hashes workflow/job/step plus sanitized signature into a failure fingerprint. Raw logs, tokens, credentials, cookies and sensitive payloads are not stored in the audit record.

## Failure classes

### REGRESSION

Evidence: focused reproduction fails on the exact PR head, equivalent base/main reproduction passes, and the assertion is still valid.

Action: return to implementation. Valid assertions must not be weakened. A new code head requires focused validation and final diff review before push/CI.

### EXPOSED_DEFECT

Evidence: focused reproduction fails on the PR head and the same failure reproduces on the base/main state.

Action: `BLOCKED` for coordinator scope decision. V1 does not silently expand the current PR to fix an unrelated pre-existing defect.

### INVALID_TEST

Evidence: the test expectation is proven inconsistent with a canonical current contract/acceptance decision, and that canonical reference is recorded.

Action: return to implementation with explicit permission to correct the test, while canonical contract review remains mandatory. This is not generic permission to weaken assertions.

### FLAKY

Strong evidence is required, for example the same exact-head failure has both success and failure outcomes, or a recognized transient signal exists without deterministic focused failure/product assertion.

Action: at most one no-code retry of failed jobs on the **same exact head**.

### INFRASTRUCTURE

Strong normalized signal such as runner/GitHub artifact/registry/network/rate-limit/platform cancellation, without a product assertion.

Action: at most one no-code retry of failed jobs on the same exact head.

An infrastructure failure remains infrastructure failure until a real retry succeeds; it is never converted into a synthetic green result.

## Ambiguity is blocking

If evidence simultaneously satisfies multiple classes, classification is `AMBIGUOUS` and the loop stops. If evidence is insufficient, classification is `UNKNOWN` and the loop stops.

The system prefers a useful blocker over guessing the cause. A successful job inside a failed workflow is not itself classified as the failure target; orchestration must select the actual failed/cancelled/timed-out job evidence.

## Retry and repair limits

- transient/no-code retries: maximum `1` per exact-head failure fingerprint;
- code/test repair attempts: maximum `3` total per bounded autonomous repair run, even if the failure text/fingerprint changes between candidate heads.

Repeated identical failure beyond the transient limit becomes `BLOCKED`; code/test repair also has a hard run-wide cap so changing failure text cannot reset the budget. History from a different repair run does not consume the current run's budget. There is no unlimited `rerun until green` behavior.

## Repair candidate

A code/test repair may be pushed only when:

- candidate head SHA is new;
- failure fingerprint is recorded;
- focused validation is green and bound to the candidate SHA;
- final combined diff review is clean and bound to the candidate SHA;
- repair summary explains the root-cause correction.

The next state is `READY_FOR_CI`, not merge. After push, all decisions use the new exact head. Evidence from the previous head is stale.

## Return to merge evaluation

After repair, this contract consumes only the stable aggregate outcomes:

- `CI / Required CI`;
- Scoped E2E.

It deliberately does not duplicate the repository's CI planner/gate allowlists.

Both checks must be terminal success on the same expected head before the loop returns `READY_FOR_MERGE_EVALUATION`. Red results return to failure analysis; pending results wait; head mismatch blocks.

The actual merge authorization belongs to #685.

## Audit evidence

Each decision produces compact machine-readable evidence:

- bounded repair-run ID;
- exact head SHA;
- workflow run ID;
- job ID;
- hashed failure fingerprint;
- classification;
- action;
- bounded attempt number;
- decision reason.

No raw secret-bearing log content belongs in this record.

## Prohibited behavior

The repair loop never authorizes:

- deleting/disabling a valid test merely to obtain green CI;
- weakening security/RBAC/validation/recovery gates;
- ignoring or fabricating a required check;
- treating infrastructure cancellation as success;
- force merge;
- automatic production incident remediation.

Historical incident #117 is an example of why broad retries are not accepted: timing/restart instability must be classified and fixed at root cause, not hidden with sleeps or unbounded reruns.
