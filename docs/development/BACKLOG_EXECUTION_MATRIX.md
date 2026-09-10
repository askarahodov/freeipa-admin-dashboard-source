# Backlog execution matrix

Point-in-time coordination reference for issue #550 (parent #548).

Verified: 2026-09-10 against `main` `d58cce5b923d182f13c197a67f43e6fba0465a45` and GitHub issue/PR state. GitHub issue state remains the source of truth; this document is a routing snapshot for AI-agent coordination and must be revalidated before implementation. Historical audit appendices inside issues are retained as history and are not treated as current scheduler state.

## Status vocabulary

- `READY`: a bounded slice can be assigned after the normal fresh-main/collision check.
- `IN_PROGRESS`: an active owner/PR or this audit currently owns the next slice.
- `NEEDS_REVALIDATION`: reproduce or inspect the remaining scope on current main before implementation.
- `BLOCKED`: a concrete dependency or external action prevents completion.
- `DEFERRED`: valid expansion, but not before foundation work/value revalidation.
- `DUPLICATE/OBSOLETE`: current main or another owner already closes the scope; none of the 47 open issues is classified this way in this snapshot.

## Confirmed coordination state

- GitHub search returns 47 open issues and reports `incomplete_results=false`.
- Active runtime owner: PR #613 for #56 owns `worker/secure-entry.ts` and `tests/auth/secure-entry-request-context-integration.test.mjs`; no second agent should edit those paths.
- PR #619 has merged; #293 is closed and is no longer an open design-system dependency.
- #95, #117 and #118 are closed/completed and must not be used as open blockers by old August appendices.
- #566 implementation is on main, but no `workflow_dispatch` run exists on main yet. #560 therefore remains blocked on that acceptance signal only.
- #391 requires repository-administration configuration. The current connected GitHub App has no repository administration capability, so this is an external/admin blocker rather than a code task.

## Complete open-issue matrix

| Issue | Status | Owner / workstream | Hard blocker or active owner | Next executable slice | Validation | Knowledge Base impact |
| --- | --- | --- | --- | --- | --- | --- |
| #27 | NEEDS_REVALIDATION | UI / settings | #552 revalidation; old owning PR #534 is no longer active | Inspect current route/settings composition and define the smallest remaining route slice | focused UI contracts + routed Chromium | Admin KB update when workflow changes |
| #28 | BLOCKED | UI / product model | #27; compatibility boundary with #29 | After #27, define versioned shortcut/preset storage and migration preview without copying XYOps schema | API + migration + E2E | Admin/operator KB update |
| #29 | BLOCKED | Integrations / UI | #27 plus current diagnostics projection revalidation under #551/#552 | Revalidate shared diagnostics/read-model ownership before XYOps-specific UI | API + failure injection + E2E | Admin/operator KB update |
| #30 | BLOCKED | UI / authorization UX | #27 | Build one visual visibility-policy slice over existing deny-wins server contract | API/unit + E2E bypass checks | Admin KB update |
| #31 | BLOCKED | UI / approvals | #27 | Build one approval-policy editor slice preserving one-shot execution/self-approval rules | API/concurrency + E2E | Admin KB update |
| #32 | BLOCKED | UI / catalog presentation | #27 | Implement one locale/presentation editor slice over current settings lifecycle | locale/API + E2E | Admin KB update |
| #33 | BLOCKED | QA / UI | #27-#32 and #98; #117 is already closed | Add broad redesigned-admin flows only after product flows/gates stabilize | full Playwright + artifact redaction | None directly |
| #38 | NEEDS_REVALIDATION | Runtime / identity security | #551 must verify current #59/#162 baseline | Map effective account/session baseline and remaining configurable policy surface | security/API + E2E | Admin/security KB update |
| #39 | DEFERRED | Runtime / authorization platform | Stabilize #56/auth baseline first | Later define permission catalog/migration without privilege expansion | permission matrix + security E2E | Admin KB update |
| #40 | NEEDS_REVALIDATION | FreeIPA / security | #551; relationship with #52 | Verify current TLS/settings/capability behavior before selecting one bounded FreeIPA-settings slice | Gateway/API + E2E | Admin/operator KB update |
| #41 | NEEDS_REVALIDATION | XYOps / integrations | #551 and compatibility ownership #29 | Verify current capability/settings gaps and idempotent retry boundaries | API/failure + E2E | Admin/operator KB update |
| #42 | NEEDS_REVALIDATION | Storage lifecycle | #551 current schema/backup/storage review | Map protected records/deletion graph and choose dry-run-first bounded slice | integration + failure injection | Admin/operator KB update |
| #43 | DEFERRED | Security operations | Foundation/redaction/retention before SIEM expansion | Defer external sink/export platform until storage/security foundations are reconfirmed | security + integration | Admin/operator KB update when implemented |
| #44 | NEEDS_REVALIDATION | Storage / admin UI | #551; significant backend foundation already exists | Inspect remaining Storage Center/read-only vs migration-apply scope before code | API/E2E + failure injection | Admin/operator KB update |
| #45 | NEEDS_REVALIDATION | Settings / platform | Current #27 route state | Verify which general settings/lifecycle pieces already exist and choose one bounded domain | API + E2E | Admin KB update |
| #46 | DEFERRED | Platform / feature control | Prefer stabilized #56/settings foundation | Defer centralized feature-flag expansion until foundation/value is reconfirmed | security/API + E2E | Admin KB update when implemented |
| #52 | NEEDS_REVALIDATION | Runtime / deployment | #551; old appendix incorrectly treats #51 as open | Reproduce current Compose networking/exposure and refresh network-model decision | Compose/integration + security | Operator/admin KB update |
| #53 | NEEDS_REVALIDATION | Runtime / web security | #551 must verify trusted-proxy/#59 state | Audit current headers/proxy trust/cookie behavior before implementation | security/browser + origin regression | Operator/security KB update |
| #56 | IN_PROGRESS | Runtime architecture | PR #613 owns secure-entry request-context integration | Finish #613; then revalidate the next single middleware/domain extraction slice | auth/architecture contracts + full routed E2E | Engineering docs only unless operations change |
| #61 | NEEDS_REVALIDATION | Release / runtime | #551 production-readiness audit | Inventory current acceptance harness and remaining safe staging gate gaps | staging acceptance + redaction | Operator/release KB update |
| #62 | NEEDS_REVALIDATION | Diagnostics / security | #551; verify current diagnostics/redaction foundation | Define current allowlisted archive manifest/redaction gap before endpoint work | security/failure + CLI/API | Admin/operator KB update |
| #92 | IN_PROGRESS | UI epic / coordination | #552 owns current revalidation | Route work through validated child slices; do not start another mega-redesign | browser matrix per child | Per child |
| #96 | NEEDS_REVALIDATION | UI / forms | #118 is closed; current screens must be checked | Reproduce remaining form/dialog semantics on extracted screens | a11y/browser + CRUD E2E | User/admin KB only for changed workflows |
| #97 | NEEDS_REVALIDATION | UI / overview | Existing OperationalOverview must be inspected, not recreated | Verify current integration/parity then define one activation slice | dashboard contracts + E2E | Operator/user KB update |
| #98 | NEEDS_REVALIDATION | QA / UI | #117 is closed; current gates/primitives changed since audit | Recompute missing deterministic a11y/visual gates on current main | Playwright visual/a11y + redaction | None directly |
| #276 | NEEDS_REVALIDATION | UI / error states (P0) | #552 browser reproduction | Reproduce persistent integration-outage duplication/occlusion on current main | browser desktop/mobile | Operator/admin KB if semantics change |
| #277 | NEEDS_REVALIDATION | UI foundation (P0) | #552 browser/network reproduction | Check whether Geist URLs still expose workspace paths/404 before patching | network/build + routed browser | None |
| #278 | NEEDS_REVALIDATION | UI shell (P0) | #552 responsive reproduction | Recheck 320/390/768 navigation and fixed/sticky occlusion | responsive Chromium | None |
| #279 | NEEDS_REVALIDATION | UI / design-system adoption | #293 now closed; #552 | Re-audit terminology/colors/icons/contrast against newly documented design-system contract | a11y/browser | User-facing terminology KB update |
| #280 | NEEDS_REVALIDATION | UI / local-admin shell | #552 | Verify Access/Sessions/Diagnostics shell/navigation state and remaining gap | browser + RBAC contracts | Admin KB update |
| #281 | NEEDS_REVALIDATION | UI / responsive lists/forms | #552 | Re-measure touch targets and page/table overflow on supported viewports | responsive browser | None/minor usage docs |
| #282 | NEEDS_REVALIDATION | UI / state system | Revalidate after #276 current state | Inventory current empty/unavailable/degraded representations and select shared-state slice | browser + state contracts | Operator/admin KB update |
| #283 | DEFERRED | UI / product search | Shell/query/RBAC value contract not yet confirmed | Revisit after navigation/state foundations; do not build speculative search backend | API/RBAC + E2E | User KB when implemented |
| #284 | NEEDS_REVALIDATION | UI / action hierarchy | #279/#280 current state | Re-audit PageHeader/Toolbar usage after design-system documentation merge | component + browser/a11y | None |
| #285 | DEFERRED | UI / first-run recovery | #282, #27, #29 | Defer guided flow until state/settings/diagnostics foundations are stable | E2E + security | Admin KB when implemented |
| #286 | NEEDS_REVALIDATION | UI / RBAC UX | Shell/state review first | Rebuild viewer/operator/admin route/action matrix from current product | role-matrix E2E | Role/admin KB update |
| #287 | DEFERRED | UI / activity center | State/outage and data-source ownership first | Revalidate product need/data model after #276/#282 | privacy/data model + E2E | User/operator KB when implemented |
| #288 | NEEDS_REVALIDATION | UI / presentation resilience | #279/#281 current state | Re-audit extreme content/zoom/reduced-motion gaps before shared formatter/help work | visual/a11y | Contextual-help KB links may update |
| #291 | DEFERRED | UI / branding | Product-value/concept decision after UI revalidation | Revisit brand work after core UI foundation defects are resolved | visual/a11y | None |
| #294 | DEFERRED | UI / bulk UX | list/forms/mobile/role/activity foundations | Defer broad bulk workflow until prerequisite interaction patterns are stable | deterministic E2E | User/operator KB when implemented |
| #391 | BLOCKED | GitHub / repository policy | Repository-admin/settings capability required | Configure PR/Required CI/E2E protection, then prove with a real protected merge | repository settings + real PR | None |
| #548 | IN_PROGRESS | Management / coordination | #550 current, then #551/#552 | Finish execution matrix, then runtime and UI revalidation waves | docs/current-state audit | None |
| #550 | IN_PROGRESS | Management / coordination | This branch/PR | Publish this 47-issue matrix and verify docs-only CI | docs checks + final diff | None |
| #551 | READY | Management / Runtime/Security audit | Run after #550 merge; no product-code owner | Revalidate #52/#53/#61/#56/#38/#40/#41/#42/#43/#44/#46/#62 and update this matrix | current-main/GitHub evidence + docs checks | None directly |
| #552 | READY | Management / UI audit | Safe after #550; coordinate any browser harness ownership | Reproduce P0 findings and classify all listed UI issues without product changes | browser evidence + docs checks | Audit records KB impact per issue |
| #560 | BLOCKED | CI epic | #566 manual acceptance only | Validate one manual security run, close #566, then final epic audit | Actions/run provenance | None |
| #566 | BLOCKED | CI / security | External/manual `workflow_dispatch` on trusted main | Launch Scheduled Security Scan manually; validate live audit, SBOM, Trivy DB/scanner provenance and artifacts | manual Actions run + artifact inspection | None |

## Execution queues

### Execute now

1. **#550** — finish and merge this current-state matrix.
2. **#551** — immediately revalidate the Runtime/Security/Platform critical path; this unlocks decisions for #52/#53/#61 and prevents stale security dependency assumptions.
3. **#552** — UI/UX browser revalidation can run in parallel with #551 after this matrix because it is read-only and owns no product code.
4. **#56 / PR #613** — continue only with its current owner; do not assign a second agent to secure-entry paths.
5. **#566** — no further implementation is needed before acceptance; an actor with workflow-dispatch capability must run the already-merged security workflow.

### Revalidate first

`#27 #38 #40 #41 #42 #44 #45 #52 #53 #61 #62 #96 #97 #98 #276 #277 #278 #279 #280 #281 #282 #284 #286 #288`.

These issues contain plausible work, but their old snapshots are not sufficient authorization to implement. #551 or #552 should turn each into a current bounded slice or another explicit status.

### Blocked

`#28 #29 #30 #31 #32 #33 #391 #560 #566`.

A blocked issue is not an invitation to work around the blocker. Resolve/revalidate the named dependency or external action first.

### Defer

`#39 #43 #46 #283 #285 #287 #291 #294`.

These remain legitimate product/platform ideas, but starting them now would expand surface area before the current foundation/critical-path work is proven.

## Parallel-safe waves

- **Wave 1:** #551 runtime/security audit + #552 UI browser audit in parallel. PR #613 continues independently with its existing owner. #566 manual dispatch can happen at any time because it does not edit repository files.
- **Wave 2:** after #551, select at most one runtime/security implementation owner for shared trust/runtime paths (likely from #52/#53/#61) plus independent UI slices proven by #552 with disjoint paths.
- **Wave 3:** only after foundation results, reconsider deferred expansion such as custom RBAC, SIEM, feature flags, search/activity/branding/bulk UX.

## Mandatory handoff before implementation

Every agent must still fetch fresh `main`, inspect open PRs and issue state, and state: `Owned paths`, `Depends on`, `Conflicts checked`, expected result, rollback, focused validation, and Knowledge Base impact. A row in this matrix never overrides a newer GitHub state or an active owner.