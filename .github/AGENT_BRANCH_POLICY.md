# AI Agent Branch Lifecycle

This repository uses short-lived `agent/*` branches because several AI agents may work in parallel. Branch names are coordination signals, not long-lived archives.

## Naming

Use:

```text
agent/<short-scope>
```

The scope should describe one independently reviewable change. Avoid generic names such as `agent/fixes`, `agent/work` or agent-number-only names.

## One issue, one active implementation PR

An issue should normally have one active implementation PR. Multiple active PRs are allowed only when the dependency is explicit, for example a documented runtime stack where one PR intentionally uses another `agent/*` branch as its base.

A branch referenced by an open PR as either head or base is active and must not be removed.

## Merge lifecycle

After a PR is merged into `main`, its agent branch is no longer an active implementation owner. The `Agent Branch Hygiene` workflow may delete it only when all of the following are true:

1. the branch still starts with `agent/`;
2. no open PR references it as head or base;
3. its current tip SHA is an **exact merged PR head** SHA;
4. a final ref read immediately before deletion still matches the planned SHA.

This makes squash-merge cleanup safe: even though the feature commits may not be ancestors of `main`, the exact merged PR head remains recorded in GitHub PR metadata.

## Clean replay and superseded branches

When concurrent work moves `main` or makes a branch carry unrelated history, prefer a **clean replay** from current `main` into a new narrow branch. The old PR must be closed and explicitly marked superseded by the replacement PR.

A closed-unmerged/superseded branch is **not** automatically deleted. It may contain unique commits even when its functionality was replayed elsewhere. Such a branch remains `INVESTIGATE` until its preservation is demonstrated separately.

## No age-based deletion

Branch hygiene must **never delete a branch by age alone**. A branch can be old and still be the base of an active stack, contain unique unmerged work, or serve a recovery/investigation purpose.

## Automatic classifications

The repository classifier uses these fixed actions:

- `KEEP_ACTIVE / referenced_by_open_pr` — preserve;
- `DELETE_MERGED / exact_merged_pr_head` — safe automatic deletion candidate;
- `INVESTIGATE / closed_unmerged_pr` — preserve pending review;
- `INVESTIGATE / branch_tip_changed_after_closed_pr` — preserve because the branch moved after recorded PR evidence;
- `INVESTIGATE / no_pr_evidence` — preserve because GitHub PR metadata does not prove safe deletion.

Only `DELETE_MERGED` is mutated automatically.

## Privileged workflow security

Branch deletion requires `contents: write`. Therefore the cleanup workflow never executes code from a pull-request head. It checks out trusted `main` explicitly with credential persistence disabled, reads branch/PR metadata, rechecks open PR references and branch SHA immediately before deletion, and then removes only a planned exact ref.

Do not change the workflow to `pull_request_target` plus PR-head checkout. Do not run PR-provided scripts, branch names as shell commands, PR bodies, labels or patches under the write-capable token.

## Manual investigation

For `INVESTIGATE` branches, determine whether unique commits are preserved before deleting anything. Acceptable evidence includes an exact clean replay mapping, a still-accessible replacement branch/PR, or an explicit operator decision after comparing the branch with its intended owner.

Do not force-push or rewrite history merely to make a branch appear deletable.