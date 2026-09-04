# Documentation inventory and audit status

Этот документ фиксирует current baseline инженерной документации для задачи #85 и Epic #82: назначение, owner/source of truth и результат проверки против актуального `main`/целевого ref.

Последний focused re-audit выполнен в #207 / PR #211. Production persistence reconciled в #209 / PR #220. ADR registry добавлен в #230 / PR #232. Module-level coverage завершён в #235 / PR #236. Machine-readable stable error ownership завершён в #124 / PR #239. Финальная reconciliation Epic #82 выполняется в #240 / PR #242.

> Каноническое product/display name — **Admin Dashboard Softrust**. Technical compatibility identifiers не переименовываются branding-only изменениями.

Статусы:

- `verified-active` — проверен против записанного baseline/целевого ref и canonical owners; требует повторной проверки после изменения соответствующего runtime/config/security/deployment/API/UI owner;
- `plan` — roadmap/task planning, не доказательство runtime;
- `superseded` — заменён другим source of truth;
- `design/historical` — исторический design/implementation artifact, не active runbook.

## Foundation и navigation

| Path | Owner / source of truth | Status | Notes |
| --- | --- | --- | --- |
| `README.md` | runtime + Compose + package/config | `verified-active` | Product overview / quick start |
| `docs/README.md` | documentation policy + inventory | `verified-active` | Main engineering-doc index |
| `docs/architecture/ARCHITECTURE.md` | current runtime, Compose/startup, canonical owners/tests | `verified-active` | Production runtime and persistence resynced |
| `docs/architecture/PROJECT_STRUCTURE.md` | repository paths + `SOURCE_OF_TRUTH.md` | `verified-active` | Module ownership map |
| `docs/architecture/MODULE_COVERAGE.md` | module boundaries + local READMEs + scoped tests | `verified-active` | Central-vs-local documentation coverage |
| `runtime/README.md` | canonical Node runtime + runtime tests | `verified-active` | Runtime lifecycle/persistence/gateway/scheduler |
| `worker/README.md` | Worker/API/security contracts/tests | `verified-active` | Request/scheduled orchestration boundary |
| `db/README.md` | schema/migration registry/tests | `verified-active` | Canonical schema/migration ownership |
| `docs/DOCUMENTATION_POLICY.md` | docs-as-code policy + `scripts/documentation-consistency.mjs` | `verified-active` | Human/AI rules and required `npm run docs:check` |
| `docs/SOURCE_OF_TRUTH.md` | canonical runtime owners | `verified-active` | Precedence/source registry |
| `docs/adr/README.md` | ADR policy + implementation evidence | `verified-active` | Why-level decisions; code/tests remain what-level authority |
| `docs/GLOSSARY.md` | active runtime/domain semantics | `verified-active` | Common terminology |
| `docs/ai/README.md` | documentation policy + source registry | `verified-active` | Mandatory AI-agent entrypoint |
| `.github/pull_request_template.md` | documentation policy | `verified-active` | Documentation/security/source-of-truth checklist |

## Normalized reference layer

| Path | Owner / source of truth | Status | Notes |
| --- | --- | --- | --- |
| `docs/reference/API.md` | `src/auth/portal-route-contract.ts` + handlers/tests | `verified-active` | Route families/auth/owners |
| `docs/reference/PERMISSIONS.md` | `src/auth/portal-permissions.ts` + enforcement/tests | `verified-active` | Built-in roles and canonical permissions |
| `docs/reference/CONFIGURATION.md` | `.env.example`, Compose, `scripts/start-production.mjs`, validators/settings/recovery owners | `verified-active` | Current configuration classes and ownership |
| `docs/reference/ERROR_CODES.md` | `src/auth/stable-error-contract.ts` + domain handlers/contracts/tests | `verified-active` | Verified stable machine codes; human strings/audit actions excluded |
| `docs/ERROR_CODE_OWNERSHIP.md` | `src/auth/stable-error-contract.ts` + `tests/stable-error-contract.test.mjs` | `verified-active` | Machine-readable ownership/verification policy |

Normalized references orient humans and agents; they do not replace runtime/domain behavior owners. When they conflict, canonical code/tests win.

## Runtime, security, operations

| Path | Owner / source of truth | Status |
| --- | --- | --- |
| `docs/SECURITY_MODEL.md` | auth/session/service-admin/integration/recovery owners + security tests | `verified-active` |
| `docs/LOCAL_AUTH_RBAC.md` | local auth/session boundary + DB schema | `verified-active` |
| `docs/DATABASE_MIGRATIONS.md` | canonical migration registry/runtime/tests | `verified-active` |
| `docs/MAINTENANCE_MODE.md` | maintenance runtime + persistent state | `verified-active` |
| `docs/OFFLINE_FULL_RESTORE.md` | recovery CLI/scripts | `verified-active` |
| `docs/HEALTH_CONTRACTS.md` | health handlers/contracts | `verified-active` |
| `docs/HEALTH_METRICS.md` | health metrics owner/rules | `verified-active` |
| `docs/STORAGE_STATUS.md` | storage status contract | `verified-active` |
| `docs/STORAGE_INTEGRITY.md` | integrity contract/index registry | `verified-active` |
| `docs/CONFIG_ENCRYPTION_KEY.md` | startup validator + Compose | `verified-active` |
| `docs/security/AUDIT_LOG.md` | audit-log owner + route/schema | `verified-active` |
| `docs/LOCAL_ACCEPTANCE_TESTS.md` | local integration harness/scripts | `verified-active` |
| `docs/P0_OPERATIONAL_ACCEPTANCE.md` | P0 acceptance runner | `verified-active` |
| `docs/DEPLOYMENT_MATRIX.md` | Compose/Docker/runtime contracts | `verified-active` |

## Integrations/product contracts

| Path | Owner / source of truth | Status |
| --- | --- | --- |
| `docs/XYOPS_EXECUTION_OWNERSHIP.md` | XYOps client/catalog/run runtime | `verified-active` |
| `docs/XYOPS_INSPECTOR.md` | `scripts/xyops-inspect.mjs` | `verified-active` |
| `docs/PROCESS_PRESENTATION_METADATA.md` | process presentation runtime + Worker + DB | `verified-active` |

## Roadmap/historical material

| Path | Status | Rule |
| --- | --- | --- |
| `docs/PRODUCT_ROADMAP.md` | `plan` | Not runtime evidence |
| `docs/OPEN_TASKS.md` | `superseded` | Current backlog is GitHub Issues |
| `docs/superpowers/specs/**` | `design/historical` | Not active runbook/current contract |
| `docs/superpowers/plans/**` | `design/historical` | Not active contract after merge |

## Исправленные baseline drift items

- **DOC-001–009:** normalized existing runbooks/navigation and added architecture/project/security/reference foundations.
- **DOC-010:** #210 synchronized production architecture/project structure with canonical Node runtime.
- **DOC-011:** #207/#211 synchronized configuration/source-of-truth/security owner pointers and re-verified API/RBAC references.
- **DOC-012:** #208 added deterministic documentation consistency CI.
- **DOC-013:** #209/#220 aligned Compose persistence with canonical `/data` SQLite storage and added regression coverage.
- **DOC-014:** #230/#232 added ADR registry and initial decision records.
- **DOC-015:** #235/#236 added module-level coverage and focused local guides for `runtime/`, `worker/`, and `db/`.
- **DOC-016:** #124/#239 added `src/auth/stable-error-contract.ts` and registry contract tests; #240/#242 reconciles active documentation with that completed ownership model.

## Проверенные группы

- Architecture/topology and production startup/persistence.
- Repository/module boundaries and module-level scoped-test routing.
- API routes, permissions, configuration and stable machine-code references.
- Security/auth/session/service-admin/FreeIPA isolation/audit/recovery boundaries.
- Health/storage/migrations/maintenance/backup operational contracts.
- XYOps ownership/inspection/presentation contracts.
- P0/local acceptance entrypoints.
- ADR/navigation/AI-agent precedence rules.

Machine-readable ownership status:

- route registry #121 — completed;
- RBAC ownership #119 — completed;
- supported configuration contract #123 — completed;
- stable error-code ownership #124 — completed by PR #239.

## Automated consistency coverage

`scripts/documentation-consistency.mjs` is the machine-checkable owner for active-document structural consistency exposed as `npm run docs:check`. CI runs it as `Documentation consistency` and includes it in `Required CI`.

Current deterministic coverage includes internal Markdown links, documented npm commands, and known obsolete production-runtime markers. Semantic API/RBAC/configuration/error/runtime truth remains with canonical owners and their contract tests. Historical `docs/superpowers/**` material is intentionally outside the active-doc guard.

## Inventory limitations

`verified-active` is a baseline statement, not a permanent guarantee. Changes to runtime/UI/security/configuration/deployment/API owners require re-verification of affected docs on the exact merge candidate.

Production persistence defect #209 is closed. The old Wrangler production-runtime limitation is closed. Machine-readable route/permission/config/error ownership work tracked by #119/#121/#123/#124 is complete.

## Epic #82 disposition

The previously listed structural/documentation gaps are now implemented: index/policy/source-of-truth, architecture/project/module coverage, deployment matrix, security model, normalized references, ADR registry, AI entrypoint and coordination rules, docs consistency CI, and machine-readable route/permission/config/error ownership surfaces.

Final closure is gated only by #240 / PR #242: active-doc reconciliation plus a green exact-head Required CI and final human/AI onboarding check. If that candidate remains green with no newly discovered material documentation gap, Epic #82 can be closed as completed.