# Agent Branch Hygiene Design

## Context

The repository is developed by several AI agents in parallel and currently retains many historical `agent/*` branches. Some are active PR heads or bases of stacked PRs, some are exact heads of already merged PRs, and some belong to closed/superseded work. Treating all old branches as disposable is unsafe because a closed unmerged branch may still contain unique commits.

Issue #135 requires a repository-owned lifecycle that removes proven-obsolete branches without losing active or unique work.

## Decision

Use **evidence-based branch classification** and automatically delete only one class: a repository-local `agent/*` branch whose current tip SHA exactly equals the recorded head SHA of a merged pull request and which is not referenced by any open pull request as either head or base.

All other branches remain untouched and are reported as active or requiring investigation.

## Classification

Each current `agent/*` branch receives one action:

- `KEEP_ACTIVE / referenced_by_open_pr` — branch is the head or base of an open PR;
- `DELETE_MERGED / exact_merged_pr_head` — no open PR references the branch and its current SHA exactly equals a merged PR head SHA;
- `INVESTIGATE / closed_unmerged_pr` — the exact branch tip belongs to a closed but unmerged PR;
- `INVESTIGATE / branch_tip_changed_after_closed_pr` — the branch has closed PR history but the current tip no longer equals any recorded closed PR head;
- `INVESTIGATE / no_pr_evidence` — no PR evidence proves safe deletion.

No branch is deleted because of age alone.

## Runtime architecture

A pure module `scripts/agent-branch-hygiene.mjs` owns classification and deterministic reporting. It performs no network requests and has no credentials.

A GitHub Actions workflow `Agent Branch Hygiene` gathers branch and PR metadata with the official GitHub client, delegates classification to the pure module, logs the complete plan, and deletes only `DELETE_MERGED` refs.

## Workflow security boundary

The cleanup workflow requires `contents: write` to delete refs and `pull-requests: read` to gather ownership evidence. Because this is a privileged workflow, it must never execute script content from a pull-request head.

The workflow therefore:

1. checks out the repository default branch (`main`) explicitly;
2. uses `persist-credentials: false`;
3. imports the classifier only from that trusted default-branch checkout;
4. never uses `pull_request_target`;
5. never evaluates PR-provided shell commands, bodies, labels or file contents;
6. deletes refs only from the plan returned by the tested classifier.

## Triggers

- `pull_request: types: [closed]` — after merge/closure, reevaluate branch lifecycle;
- weekly schedule — clean any merged branch missed because the workflow did not exist at merge time;
- `workflow_dispatch` — allow an operator to run the same deterministic cleanup manually.

A run scans repository branches and paginated open/closed PR metadata. It does not rely on the event PR alone, so historical merged agent branches can be retired once the workflow reaches `main`.

## Stacked PR safety

Any branch used as the base of an open stacked PR is `KEEP_ACTIVE` even if that branch was itself merged elsewhere. This prevents cleanup from breaking active stacks such as the production-runtime sequence.

## Superseded PR safety

Closed-unmerged/superseded branches are never automatically deleted. They remain `INVESTIGATE` until an operator or future evidence proves their commits are preserved by a clean replay or another reachable branch.

## Reporting

Every run prints deterministic counts and one line per `agent/*` branch. The report contains only branch names, action and fixed reason codes; it does not expose repository secrets or PR bodies.

## Testing

Behavior tests cover:

- exact merged head deletion;
- branch-tip advancement after merge;
- open PR head protection;
- open stacked base protection;
- closed-unmerged protection;
- untracked branch protection;
- deterministic report format.

Workflow source contracts cover trusted-main checkout, disabled credential persistence, read/write permission boundaries, absence of `pull_request_target`, delegation to the pure module and deletion only for `DELETE_MERGED` actions.

## Rollback

Revert the workflow and policy files. Deleted branches are only exact tips already recorded in merged PR metadata, so their merged code remains reachable from repository history. Ambiguous/unmerged branches are never automatically removed.