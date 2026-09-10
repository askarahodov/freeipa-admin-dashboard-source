# Backlog execution matrix

Current-state coordination reference for issue #548.

Verified: 2026-09-10 against `main` `ba51d1f120e9e542bcd6b356cd678d3de748a9db` and current GitHub issue/PR state. GitHub issues remain the source of truth; this document is a routing snapshot for AI-agent coordination and must be revalidated before implementation. Historical audit appendices inside issues remain history and are not treated as scheduler state.

## Status vocabulary

- `READY`: a bounded slice can be assigned after the normal fresh-main/collision check.
- `IN_PROGRESS`: an active owner/PR or audit owns the next slice.
- `NEEDS_REVALIDATION`: reproduce or inspect remaining behavior on current main before implementation.
- `BLOCKED`: a concrete dependency or external action prevents the next implementation/completion step.
- `DEFERRED`: valid expansion, but not before foundation work/value revalidation.
- `DUPLICATE/OBSOLETE`: current main or another owner already closes the remaining scope.

## Confirmed coordination state

- #550 is completed through PR #620; its first complete snapshot covered all 47 issues that were open at that time.
- #293 is completed through PR #619. #95, #117 and #118 are also closed/completed and are not current blockers.
- #51 production runtime, #59 anti-abuse and #162 explicit same-origin protection are all closed/completed. Old issue appendices that still list them as open are stale.
- Active runtime owner: PR #613 for #56 owns `worker/secure-entry.ts` and `tests/auth/secure-entry-request-context-integration.test.mjs`; no second agent should edit those paths.
- #566 implementation is on main, but no `workflow_dispatch` run exists on main yet. #560 remains blocked on that acceptance signal only.
- #391 requires repository-administration configuration. The connected GitHub App has no repository administration capability, so it is an external/admin blocker rather than a code task.

## Complete current open-issue matrix

| Issue | Status | Owner / workstream | Hard blocker or active owner | Next executable slice | Validation | Knowledge Base impact |
| --- | --- | --- | --- | --- | --- | --- |
| #27 | NEEDS_REVALIDATION | UI / settings | #552 revalidation | Inspect current route/settings composition and define the smallest remaining route slice | focused UI contracts + routed Chromium | Admin KB update when workflow changes |
| #28 | BLOCKED | UI / product model | #27; compatibility boundary with #29 | After #27, define versioned shortcut/preset storage and migration preview | API + migration + E2E | Admin/operator KB update |
| #29 | BLOCKED | Integrations / UI | #27; consumes #41 backend capability contract | Revalidate shared diagnostics/read-model ownership before XYOps UI | API + failure injection + E2E | Admin/operator KB update |
| #30 | BLOCKED | UI / authorization UX | #27 | Build one visibility-policy slice over existing deny-wins server contract | API/unit + E2E bypass checks | Admin KB update |
| #31 | BLOCKED | UI / approvals | #27 | Build one approval-policy editor slice preserving one-shot/self-approval rules | API/concurrency + E2E | Admin KB update |
| #32 | BLOCKED | UI / catalog presentation | #27 | Implement one locale/presentation editor slice over current settings lifecycle | locale/API + E2E | Admin KB update |
| #33 | BLOCKED | QA / UI | #27-#32 and #98 | Add broad redesigned-admin flows only after product flows/gates stabilize | full Playwright + artifact redaction | None directly |
| #38 | READY | Runtime / identity security | Collision-check #613/#56 auth paths before code | Inventory effective account/session policy, define immutable platform bounds and behavior tests before adding revisioned knobs | security/API + E2E | Admin/security KB update |
| #39 | DEFERRED | Runtime / authorization platform | Stabilize #56/auth architecture first | Later define permission catalog/migration without privilege expansion | permission matrix + security E2E | Admin KB update |
| #40 | BLOCKED | FreeIPA / security | Settle #52 outbound network/proxy transport contract first | Then start custom-CA/TLS/capability settings as bounded backend contracts | Gateway/API + E2E | Admin/operator KB update |
| #41 | READY | XYOps / integrations | No hard blocker; #29 is downstream UI consumer | Typed advanced-settings bounds + read-only capability-discovery normalization | API/failure + E2E | Admin/operator KB update |
| #42 | BLOCKED | Storage lifecycle | Complete the next #62/#44 safety layers before destructive cleanup | After diagnostics + controlled storage controls, start dry-run retention/deletion graph | integration + failure injection | Admin/operator KB update |
| #43 | DEFERRED | Security operations | Storage/redaction/retention foundations first | Defer external SIEM/export platform until foundation work is proven | security + integration | Admin/operator KB update when implemented |
| #44 | READY | Storage / admin UI | Sequence after #62 for support/redaction safety; no hard prerequisite missing | Continue from existing status/integrity/preflight foundation with controlled migration apply/recovery, then UI | API/E2E + failure injection | Admin/operator KB update |
| #45 | NEEDS_REVALIDATION | Settings / platform | Current #27 route state | Verify remaining general settings/lifecycle pieces and choose one bounded domain | API + E2E | Admin KB update |
| #46 | DEFERRED | Platform / feature control | Prefer stabilized #56/settings foundation | Defer feature-flag expansion until foundation/value is reconfirmed | security/API + E2E | Admin KB update when implemented |
| #52 | READY | Runtime / deployment | No hard blocker; bridge/DNS foundation already merged | Audit actual FreeIPA/XYOps outbound proxy behavior; implement explicit HTTP(S)_PROXY/NO_PROXY only if a safe testable transport contract exists | Compose/runtime integration + TLS security | Operator/admin KB update |
| #53 | READY | Runtime / web security | Sequence after #52; avoid #613 owned paths | Inventory actual headers/cookie HTTPS detection, threat-model trusted proxy, then add centralized headers/proxy trust contract | security/browser + origin regression | Operator/security KB update |
| #56 | IN_PROGRESS | Runtime architecture | PR #613 owns secure-entry request-context integration | Finish #613; then revalidate one next middleware/domain extraction slice | auth/architecture contracts + routed E2E | Engineering docs unless operations change |
| #61 | BLOCKED | Release / runtime | Final gate depends on settled #52 and #53 deployment/security contracts | After #52/#53, build exact-image staging acceptance harness/report/redaction gate | staging acceptance + redaction | Operator/release KB update |
| #62 | READY | Diagnostics / security | Health/schema/backup prerequisites already complete | Define versioned allowlist archive manifest + centralized/second-pass redaction contract first | security/failure + CLI/API | Admin/operator KB update |
| #92 | IN_PROGRESS | UI epic / coordination | #552 owns current revalidation | Route work through validated child slices; do not start another mega-redesign | browser matrix per child | Per child |
| #96 | NEEDS_REVALIDATION | UI / forms | #118 is closed; current screens must be checked | Reproduce remaining form/dialog semantics on current screens | a11y/browser + CRUD E2E | User/admin KB only for changed workflows |
| #97 | NEEDS_REVALIDATION | UI / overview | Existing OperationalOverview must be inspected, not recreated | Verify current integration/parity then define one activation slice | dashboard contracts + E2E | Operator/user KB update |
| #98 | NEEDS_REVALIDATION | QA / UI | #117 is closed; current gates changed | Recompute missing deterministic a11y/visual gates on current main | Playwright visual/a11y + redaction | None directly |
| #276 | NEEDS_REVALIDATION | UI / error states (P0) | #552 browser reproduction | Reproduce integration-outage duplication/occlusion on current main | browser desktop/mobile | Operator/admin KB if semantics change |
| #277 | NEEDS_REVALIDATION | UI foundation (P0) | #552 browser/network reproduction | Check whether Geist URLs still expose workspace paths/404 | network/build + routed browser | None |
| #278 | NEEDS_REVALIDATION | UI shell (P0) | #552 responsive reproduction | Recheck 320/390/768 navigation and fixed/sticky occlusion | responsive Chromium | None |
| #279 | NEEDS_REVALIDATION | UI / design-system adoption | #293 now complete; #552 | Re-audit terminology/colors/icons/contrast against documented design-system contract | a11y/browser | User-facing terminology KB update |
| #280 | NEEDS_REVALIDATION | UI / local-admin shell | #552 | Verify Access/Sessions/Diagnostics shell/navigation state and remaining gap | browser + RBAC contracts | Admin KB update |
| #281 | NEEDS_REVALIDATION | UI / responsive lists/forms | #552 | Re-measure touch targets and overflow on supported viewports | responsive browser | None/minor usage docs |
| #282 | NEEDS_REVALIDATION | UI / state system | Revalidate after #276 current state | Inventory current empty/unavailable/degraded representations | browser + state contracts | Operator/admin KB update |
| #283 | DEFERRED | UI / product search | Shell/query/RBAC value contract not confirmed | Revisit after navigation/state foundations | API/RBAC + E2E | User KB when implemented |
| #284 | NEEDS_REVALIDATION | UI / action hierarchy | #279/#280 current state | Re-audit PageHeader/Toolbar usage after #293 completion | component + browser/a11y | None |
| #285 | DEFERRED | UI / first-run recovery | #282, #27, #29 | Defer guided flow until state/settings/diagnostics foundations are stable | E2E + security | Admin KB when implemented |
| #286 | NEEDS_REVALIDATION | UI / RBAC UX | Shell/state review first | Rebuild viewer/operator/admin route/action matrix | role-matrix E2E | Role/admin KB update |
| #287 | DEFERRED | UI / activity center | State/outage/data-source ownership first | Revalidate product need/data model after #276/#282 | privacy/data model + E2E | User/operator KB when implemented |
| #288 | NEEDS_REVALIDATION | UI / presentation resilience | #279/#281 current state | Re-audit extreme content/zoom/reduced-motion gaps | visual/a11y | Contextual-help KB links may update |
| #291 | DEFERRED | UI / branding | Product-value/concept decision after UI revalidation | Revisit brand work after core UI foundation defects | visual/a11y | None |
| #294 | DEFERRED | UI / bulk UX | list/forms/mobile/role/activity foundations | Defer broad bulk workflow until prerequisite patterns are stable | deterministic E2E | User/operator KB when implemented |
| #391 | BLOCKED | GitHub / repository policy | Repository-admin/settings capability required | Configure PR/Required CI/E2E protection, then prove with a protected merge | repository settings + real PR | None |
| #548 | IN_PROGRESS | Management / coordination | #551 current, #552 next/parallel | Finish runtime/security and UI revalidation waves | docs/current-state audit | None |
| #551 | IN_PROGRESS | Management / Runtime/Security audit | This branch/PR | Publish the revalidated critical path and issue handoffs | current-main/GitHub evidence + docs checks | None directly |
| #552 | READY | Management / UI audit | Safe after #550; coordinate browser harness ownership | Reproduce P0 findings and classify listed UI issues without product changes | browser evidence + docs checks | Audit records KB impact per issue |
| #560 | BLOCKED | CI epic | #566 manual acceptance only | Validate one manual security run, close #566, then final epic audit | Actions/run provenance | None |
| #566 | BLOCKED | CI / security | External/manual `workflow_dispatch` on trusted main | Launch Scheduled Security Scan manually; validate live audit, SBOM, Trivy DB/scanner provenance and artifacts | manual Actions run + artifact inspection | None |

## Runtime / Security / Platform critical path — #551

### Current-state findings

1. The old production-runtime blocker is gone: #51 is completed. Canonical Compose already uses an explicit `portal` bridge and loopback-default publication; #608/#611/#615 delivered bridge topology, documentation and guarded DNS/search-domain/host-alias customization. #52 is therefore not a host-network migration anymore. Its remaining meaningful scope is outbound FreeIPA/XYOps proxy transport behavior and the evidence-based decision on whether any legacy host-network compatibility profile is justified.
2. The auth baseline is further ahead than old appendices imply: #59 and #162 are completed. #38 can start a design/test-first configurable-policy slice, subject to collision checking against active #613/#56 auth architecture work.
3. #53 has no missing security prerequisite from #59; it is implementation-ready after normal collision check, but sequencing it after the remaining #52 outbound-network contract keeps proxy trust/topology decisions coherent.
4. #41 explicitly owns XYOps advanced-settings and capability-discovery backend contracts. #29 consumes those contracts and is not a blocker for the first #41 slice.
5. Storage already has substantial #44 foundation on main: read-only status, integrity/index diagnostics and migration preflight/backup/lock inspection were merged. #62 has all stated foundation prerequisites and should establish the bounded diagnostic archive/redaction layer before the next controlled storage/admin surface. Destructive #42 retention should follow those safety layers rather than run ahead of them.
6. #43 SIEM/export and #46 feature-flag platform remain deliberately deferred: neither is required to unblock the immediate production-readiness chain.
7. #61's historical prerequisites (#37/#49/#55/#57/#60) are complete. Its final release-gate value is highest after #52/#53 settle the remaining deployment/security contracts, so it is treated as blocked for final implementation rather than prematurely building around moving boundaries.

### Ordered execution

**Primary production-readiness chain**

`#52 outbound proxy/transport residual → #53 centralized HTTP headers + trusted proxy → #61 reproducible production/staging acceptance`

**Parallel-safe foundation lanes**

- `#62 diagnostic archive/redaction → #44 controlled migration/recovery + Storage Center → #42 retention/cleanup`
- `#41 XYOps backend settings/capability discovery → #29 compatibility UI` (the UI remains separately gated by #27)
- `#38 account/session policy` is ready for design/tests, but code ownership must not overlap active PR #613/#56.
- `#40 FreeIPA advanced settings` starts after #52 settles outbound transport/proxy semantics; TLS/custom-CA behavior must not use network work as a reason to disable verification.

### Do not execute now

- #43 SIEM/export, #46 feature flags and #39 custom RBAC remain deferred expansion.
- Do not assign a second owner to #56 secure-entry while PR #613 is open.
- Do not treat #61 as a substitute for completing #52/#53; acceptance validates the production contract, it does not define it.

## Execution queues

### Execute now

1. **#551** — finish and merge this critical-path refresh.
2. **#52** — outbound proxy/transport audit is the next runtime deployment slice.
3. **#62** — manifest/redaction-first diagnostics slice is parallel-safe with #52.
4. **#41** — backend settings/capability-discovery first slice is parallel-safe if owned paths are disjoint.
5. **#38** — design/tests are ready; implementation waits for a clean auth collision check against #613.
6. **#552** — UI/UX browser revalidation remains parallel-safe because it changes no product behavior.
7. **#56 / PR #613** — continue only with its current owner.
8. **#566** — no implementation remains before acceptance; an actor with workflow-dispatch capability must run the merged security workflow.

### Revalidate first

`#27 #45 #96 #97 #98 #276 #277 #278 #279 #280 #281 #282 #284 #286 #288`.

### Blocked / sequenced

`#28 #29 #30 #31 #32 #33 #40 #42 #61 #391 #560 #566`.

### Defer

`#39 #43 #46 #283 #285 #287 #291 #294`.

## Parallel-safe waves

- **Wave 1:** #52 runtime-network residual + #62 diagnostic-redaction foundation + #41 XYOps backend contract + #552 UI revalidation, with disjoint owners. PR #613 continues independently. #38 remains design/test-only until auth-path collision clears.
- **Wave 2:** #53 after #52; #44 after #62; then #40 and #42 when their upstream contracts are fixed. UI implementation slices come from #552 evidence.
- **Wave 3:** #61 production/staging acceptance validates the settled deployment/security chain. Only after foundation results should deferred custom RBAC/SIEM/feature-flags/search/activity/branding/bulk expansion be reconsidered.

## Mandatory handoff before implementation

Every agent must still fetch fresh `main`, inspect open PRs and issue state, and state: `Owned paths`, `Depends on`, `Conflicts checked`, expected result, rollback, focused validation, and Knowledge Base impact. A row in this matrix never overrides newer GitHub state or an active owner.