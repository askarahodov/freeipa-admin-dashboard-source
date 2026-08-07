# Agent PR Coordination Design

## Status

Approved for implementation by the user on 2026-08-07.

## Problem

Multiple agents work on the repository concurrently. The current pull request template verifies source-of-truth and documentation impact, but it does not require authors to state the active owner, high-conflict files, dependencies, or explicitly excluded scope. This makes otherwise valid pull requests harder to coordinate before a mechanical collision guard runs.

## Design

Extend the existing pull request template with one `Coordination` section. It records the owning Issue, canonical domain or contract, high-conflict paths, dependencies or ordering, parallel-safe work, and explicit exclusions. A short checklist confirms that active pull requests were inspected and that overlaps are either absent or documented.

Extend `docs/ai/README.md` in its existing parallel-agent section. The document will define the same fields and explain that `none` must be explicit. It will not introduce a second ownership registry: GitHub Issues and pull requests remain coordination records, while runtime ownership remains defined by canonical code and `SOURCE_OF_TRUTH.md`.

## Boundaries

- No product, runtime, API, RBAC, schema, recovery, deployment, or CI behavior changes.
- No collision-guard implementation; that work is already owned by the `agent/pr-collision-guard-main` branch for #134.
- No branch cleanup implementation; that work is already owned by `agent/branch-hygiene-main` for #135.
- No new Markdown owner is created; existing contribution and AI-agent documents are extended.

## Verification

A behavior-oriented Node test parses the PR template as a contributor-facing form and verifies that each required coordination field and checklist decision is present. Documentation consistency is verified by the existing documentation architecture test and link checks.
