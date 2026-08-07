# PR Collision Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a read-only pull-request collision guard that blocks overlapping canonical/high-conflict ownership surfaces while allowing ordinary parallel work.

**Architecture:** Keep path policy, overlap analysis and formatting in a pure dependency-free Node.js module. Let a dedicated GitHub Actions workflow read open PR metadata/files through the official authenticated GitHub client and delegate decisions to the pure module.

**Tech Stack:** Node.js 22.13.0, `node:test`, GitHub Actions, `actions/github-script`.

## Constraints

- No runtime/UI/API/RBAC/database behavior changes.
- No persistent ownership registry or new npm dependency.
- Workflow permissions remain `contents: read` and `pull-requests: read`.
- No PR bodies, patches, source contents or credentials from other PRs in logs.
- Do not modify `docs/ai/README.md` while #156 owns that contribution-process surface.
- Final verification must use the post-#151 sharded/security-enabled CI topology.

## Tasks

### 1. Pure analyzer

- [x] Preserve RED evidence from superseded #136 where the module did not exist.
- [x] Replay `scripts/pr-collision-guard.mjs`.
- [x] Replay deterministic behavior/report tests.

### 2. Read-only workflow

- [x] Preserve workflow-boundary RED evidence from superseded #136.
- [x] Replay `.github/workflows/pr-collision-guard.yml` with read-only permissions.
- [ ] Observe a real PR run against current open-PR metadata.

### 3. Required-check documentation

- [ ] Add `PR Collision Guard / ownership-collision` to the current sharding/security required-check document without removing any #151 gate.
- [ ] Document BLOCKING vs INFO and ownership remediation.

### 4. Clean post-#151 verification

- [ ] Compare the branch against current `main`; require only intended collision-guard files.
- [ ] Run focused collision-guard tests in bounded sharded CI.
- [ ] Require `CI / Required CI`, `Auth E2E / auth-e2e`, and the real collision guard to succeed on exact head.
- [ ] If a blocking overlap is real, resolve merge order/replay rather than weakening policy.
- [ ] Merge with expected head SHA only after fresh review-thread and base checks.

## Evidence lineage

Superseded #136/#137 retain the original RED/GREEN/TDD and first real GitHub execution evidence. This replay exists solely because `main` materially changed through security work and #151 CI sharding; it must not reintroduce the old required-check document or old CI topology.
