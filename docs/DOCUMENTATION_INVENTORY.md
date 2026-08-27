# Documentation inventory and audit status

Этот документ фиксирует baseline инженерной документации для задачи #85 и Epic #82: назначение, owner/source of truth и результат проверки против актуального `main`/целевого stacked ref.

Последний focused re-audit выполнен в #207 против `main` после merge #210 (`f4514e2224b2e5091f6856d1513b2c4ced6c9fda`) с исправлениями и повторной CI-проверкой в PR #211. Post-audit persistence reconciliation выполнен после #209 / PR #220 (`415de033a66620312cd2febc88226ac5adf4d2ce`). ADR registry добавлен в #230 / PR #232. Module-level coverage добавляется в #235. Подробный audit trail: [`DOCUMENTATION_REAUDIT_2026-08-27.md`](DOCUMENTATION_REAUDIT_2026-08-27.md).

> Каноническое product/display name — **Admin Dashboard Softrust**. Технические compatibility identifiers не переименовываются в рамках branding-only изменений.

Статусы:

- `verified-active` — проверен против записанного baseline/целевого ref и canonical owners; статус требует повторной проверки после изменения соответствующего runtime/config/security/deployment/API/UI owner;
- `plan` — roadmap/task planning, не доказательство runtime;
- `superseded` — заменён другим source of truth;
- `design/historical` — исторический design/implementation artifact, не active runbook.

## Foundation и навигация

| Path | Тип | Owner / source of truth | Status | Примечание |
| --- | --- | --- | --- | --- |
| `README.md` | product overview / quick start | runtime + Compose + package/config | `verified-active` | Стабильная входная точка; offline restore и controlled migrations отражают current state |
| `docs/README.md` | documentation index | documentation policy + inventory | `verified-active` | Основной навигатор active docs |
| `docs/ARCHITECTURE.md` | architecture/current-state overview | current runtime entries, Compose/startup, canonical domain owners and tests | `verified-active` | Production runtime resynced in #210; Compose persistence aligned to `/data` by #209/#220 |
| `docs/PROJECT_STRUCTURE.md` | repository/module ownership map | current repository paths + `SOURCE_OF_TRUTH.md` + representative tests | `verified-active` | Startup/module ownership resynced in #210; не является target refactor plan |
| `docs/MODULE_COVERAGE.md` | module-level ownership coverage | current module boundaries + local module READMEs + canonical owners/tests | `verified-active` | #235 defines local-vs-central coverage and scoped verification without duplicating volatile registries |
| `runtime/README.md` | local module guide | canonical Node runtime + runtime tests | `verified-active` | Lifecycle/persistence/gateway/scheduler ownership and forbidden dependencies |
| `worker/README.md` | local module guide | Worker boundary + API/security contracts/tests | `verified-active` | Request/scheduled orchestration boundary; domain owners remain outside Worker wrappers |
| `db/README.md` | local module guide | schema/migration registry/tests | `verified-active` | Canonical schema/migration ownership; request handlers must not own DDL |
| `docs/DOCUMENTATION_POLICY.md` | policy | Epic #82 documentation contract + `scripts/documentation-consistency.mjs` | `verified-active` | Docs-as-code, правила нескольких ИИ-агентов и обязательный `npm run docs:check` |
| `docs/SOURCE_OF_TRUTH.md` | reference registry | canonical runtime owners | `verified-active` | Re-audited in #207/#211; points to existing configuration/project-structure references |
| `docs/adr/README.md` | ADR registry / policy | accepted ADRs + canonical implementation evidence | `verified-active` | ADRs explain why; code/tests/current references remain authoritative for what |
| `docs/GLOSSARY.md` | terminology | active runtime/domain semantics | `verified-active` | Общая терминология |
| `docs/ai/README.md` | AI entrypoint | documentation policy + source registry | `verified-active` | Обязательный порядок чтения для ИИ-агентов |
| `.github/pull_request_template.md` | contribution process | documentation policy | `verified-active` | Documentation/security/source-of-truth checklist |

## Normalized reference layer

| Path | Тип | Owner / source of truth | Status | Примечание |
| --- | --- | --- | --- | --- |
| `docs/reference/API.md` | normalized API/current-state reference | `portal-route-contract.ts` + route handlers/wrappers/tests | `verified-active` | Re-verified in #207; route families/auth/owner pointers remain aligned with current reference tests |
| `docs/reference/PERMISSIONS.md` | normalized RBAC/current-state reference | `portal-permissions.ts` + exact route enforcement/tests | `verified-active` | Re-verified in #207; 3 built-in roles и 13 canonical permissions checked by reference tests |
| `docs/reference/CONFIGURATION.md` | normalized configuration/current-state reference | `.env.example`, Compose, `scripts/start-production.mjs`, startup validators, settings lifecycle/source, recovery tooling | `verified-active` | Legacy `start-worker.mjs` production ownership corrected in #207/#211; machine-readable contract remains #123 |
| `docs/reference/ERROR_CODES.md` | normalized machine-code/current-state reference | domain handlers/contracts/tests | `verified-active` | Stable machine-readable codes по проверенным доменам; human strings/audit action names не включаются; consolidation #124 |

Эти четыре reference-документа являются current-state orientation и не создают второй runtime registry. При конфликте canonical code owner/tests имеют приоритет.

## Runtime, security и operations

| Path | Тип | Owner / source of truth | Status | Примечание |
| --- | --- | --- | --- | --- |
| `docs/SECURITY_MODEL.md` | security/current-state overview | current auth/session/service-admin/integration/recovery owners + active security runbooks/tests | `verified-active` | Obsolete Wrangler/#51 limitation removed in #207/#211; trust/identity/secret/recovery model remains current |
| `docs/LOCAL_AUTH_RBAC.md` | security/reference | `local-auth.ts` + local session boundary + DB schema | `verified-active` | PBKDF2, lockout и session semantics проверены |
| `docs/DATABASE_MIGRATIONS.md` | operations/runbook | canonical migration registry/runtime/tests | `verified-active` | Automatic/controlled lifecycle, preflight/apply/status/reconcile и v4 foundation |
| `docs/MAINTENANCE_MODE.md` | security/runbook | maintenance runtime + `portal_maintenance_state` | `verified-active` | Persistent maintenance boundary |
| `docs/OFFLINE_FULL_RESTORE.md` | destructive recovery runbook | recovery CLI/scripts + #72 | `verified-active` | Offline restore/atomic swap/receipt/verify/rollback подтверждены |
| `docs/HEALTH_CONTRACTS.md` | operations/reference | health handlers/contracts + #74–#76 | `verified-active` | Liveness/readiness/dependency separation |
| `docs/HEALTH_METRICS.md` | monitoring/reference | `/metrics/health` + monitoring rules + #77 | `verified-active` | Fixed low-cardinality metrics, без внешних probes |
| `docs/STORAGE_STATUS.md` | operations/reference | storage status contract + #78 | `verified-active` | Bounded read-only status |
| `docs/STORAGE_INTEGRITY.md` | operations/reference | integrity contract/index registry + #79 | `verified-active` | Read-only quick-check/index diagnostics |
| `docs/CONFIG_ENCRYPTION_KEY.md` | security/runbook | startup validator + Compose + #86 | `verified-active` | Production key external-only и fail-fast startup contract |
| `docs/AUDIT_LOG.md` | security/reference | `audit-log.ts`, Worker route, append-only schema | `verified-active` | Correlation, redaction, GET-only API и `settings.manage` подтверждены |
| `docs/LOCAL_ACCEPTANCE_TESTS.md` | testing/runbook | local integration harness/scripts | `verified-active` | Compose-aware disposable volume flow |
| `docs/P0_OPERATIONAL_ACCEPTANCE.md` | testing/runbook | `scripts/p0-operational-acceptance.mjs` + package script | `verified-active` | Script/package/Compose entrypoints подтверждены |

## Интеграции и продуктовые контракты

| Path | Тип | Owner / source of truth | Status | Примечание |
| --- | --- | --- | --- | --- |
| `docs/XYOPS_EXECUTION_OWNERSHIP.md` | architecture/integration | XYOps client/catalog/run runtime | `verified-active` | XYOps остаётся owner scheduler/concurrency/rate limits |
| `docs/XYOPS_INSPECTOR.md` | integration/reference | `scripts/xyops-inspect.mjs` | `verified-active` | Inspector v3, GET-only probes, required Events, 0600 output и network classification подтверждены |
| `docs/PROCESS_PRESENTATION_METADATA.md` | feature/reference | `process-presentation.ts`, Worker route, DB schema | `verified-active` | D1→ENV→default precedence, BCP47, bounded overrides и admin boundary подтверждены |

## Roadmap и historical material

| Path | Тип | Owner / source of truth | Status | Примечание |
| --- | --- | --- | --- | --- |
| `docs/PRODUCT_ROADMAP.md` | roadmap | GitHub Issues + merged work | `plan` | Не использовать вместо runtime contract |
| `docs/OPEN_TASKS.md` | historical task snapshot | GitHub Issues | `superseded` | Текущий backlog только в GitHub Issues; старый snapshot сохранён в Git history |
| `docs/superpowers/specs/**` | design artifacts | implementation + active docs | `design/historical` | Не являются current runbook после реализации; исключены из automated active-doc guard |
| `docs/superpowers/plans/**` | implementation/review plans | implementation + active docs | `design/historical` | Не являются current contract после merge; исключены из automated active-doc guard |

## Исправленные расхождения baseline

- **DOC-001:** README больше не описывает destructive offline recovery как будущую работу.
- **DOC-002:** `DATABASE_MIGRATIONS.md` больше не содержит завершённый #57 transition как future work и отражает automatic/controlled migration lifecycle.
- **DOC-003:** `OPEN_TASKS.md` переведён в `superseded`; backlog source of truth — GitHub Issues.
- **DOC-004:** `HEALTH_METRICS.md` добавлен в основной docs index.
- **DOC-005:** `LOCAL_ACCEPTANCE_TESTS.md` больше не вычисляет Docker volume из имени repository/project directory.
- **DOC-006:** `CONFIG_ENCRYPTION_KEY.md` и external-only production key contract добавлены в inventory/index.
- **DOC-007:** добавлены `ARCHITECTURE.md` и `PROJECT_STRUCTURE.md`; docs index/AI entrypoint больше не утверждают, что эти current-state документы отсутствуют.
- **DOC-008:** добавлен `SECURITY_MODEL.md`; security reviewer/AI flow теперь имеет единый current-state trust/identity/secret/recovery overview без создания второго runtime owner.
- **DOC-009:** добавлен normalized reference layer для API, permissions, configuration и stable machine error codes без создания дублирующих runtime registries.
- **DOC-010:** #210 синхронизировал production architecture/project structure с canonical Node runtime после #194.
- **DOC-011:** #207/#211 синхронизировал configuration/source-of-truth/security current-state owner pointers и повторно проверил API/RBAC references.
- **DOC-012:** #208 добавил deterministic documentation consistency guard для внутренних ссылок, npm command references и известных obsolete runtime markers.
- **DOC-013:** #209/#220 выровнял Compose named-volume mount с canonical `/data` SQLite store и добавил regression contract test.
- **DOC-014:** #230/#232 добавил ADR registry и initial accepted decision records without promoting historical plans to current authority.
- **DOC-015:** #235 добавляет module-level coverage map и focused local guides для `runtime/`, `worker/`, `db/`.

## Проверенные группы

- Architecture/topology — Compose, Dockerfile, canonical Node startup/runtime, Worker entry chain, merged UI foundation and current constraints.
- Repository/module boundaries — `app/`, `app/styles/`, `app/ui/`, `worker/`, `runtime/`, `db/`, root domain modules, scripts, tests/e2e, docs, CI/deployment files.
- Module-level coverage — centralized coverage for lower-volatility modules; focused local guides for runtime/Worker/schema boundaries with dependency direction, scoped tests and documentation-impact triggers.
- Normalized API reference — health/auth/settings/FreeIPA/XYOps/approvals/runs/backup/storage/schema/maintenance families и exact owner pointers.
- Canonical permissions — `portal-permissions.ts`: `viewer`, `operator`, `admin` и 13 permission codes; distributed/orphan checks остаются tracked drift #119.
- Configuration reference — `.env.example`, Compose, `scripts/start-production.mjs`, startup validators, settings source/lifecycle, recovery tooling и internal ephemeral Gateway values.
- Machine error codes — health/dependency/storage/migration/maintenance/backup/settings code owners; human messages и audit actions отделены.
- Security model — local auth/session/service-admin, private FreeIPA Gateway, active auth/audit/encryption/maintenance/recovery/schema/health docs and representative security tests/log evidence.
- Auth/RBAC — local auth/session boundary, password/session hashing, lockout, cookie semantics and last-active-admin protection.
- Service-admin/mutation boundary — exact admin integration path set, constant-time token comparison and same-origin mutation guard.
- FreeIPA isolation — server-side Gateway method allowlist, loopback token authorization, upstream cookie confinement and bounded request/error handling.
- Health/storage — #74–#79 and current contracts.
- Production encryption key — #86, `compose.yaml`, startup validator.
- Offline recovery — #72 and active runbook.
- Audit — `audit-log.ts` and Worker route.
- XYOps ownership/inspector/presentation — current runtime/scripts.
- P0 automated acceptance — script/package/Compose entrypoints.
- Schema/migrations — canonical registry, v4 automatic foundation, controlled-suffix semantics and storage migration contracts.
- Production persistence — `PORTAL_DATA_DIR=/data`, Compose `dashboard-data:/data`, recovery access to the same named volume, and `tests/compose-persistence-contract.test.mjs`.

## Automated consistency coverage

`scripts/documentation-consistency.mjs` is the machine-checkable owner for repository-wide active-document consistency checks exposed as `npm run docs:check`. CI runs it in a dedicated dependency-free `Documentation consistency` job and includes that result in `Required CI`.

Current deterministic coverage intentionally includes:

- internal Markdown links resolving to existing repository paths;
- documented `npm run ...` commands resolving to scripts in `package.json`;
- known obsolete production-runtime statements that would reintroduce pre-#194 Wrangler current-state drift.

Semantic API/RBAC/configuration/runtime truth continues to belong to canonical owners and their contract tests. Historical `docs/superpowers/**` material is intentionally outside this guard.

## Ограничения inventory

Этот baseline перечисляет active/current инженерные документы и отдельно классифицирует `docs/superpowers/specs/**` / `plans/**` как historical implementation artifacts. Historical plans не перечисляются по одному, потому что они не являются current contracts и их authoritative owner — соответствующий merged implementation + active documentation.

`verified-active` означает проверку против записанного baseline/целевого ref и canonical owners, а не бессрочную гарантию. Изменение runtime/UI/security/configuration/deployment/API owner автоматически требует повторной проверки затронутых документов на exact merge candidate.

Production persistence defect #209 закрыт PR #220: canonical runtime `/data` и Compose named-volume mount теперь совпадают и защищены regression contract test. Эта проблема больше не является known limitation active documentation.

## Следующие gaps Epic #82

Baseline повторно актуализирован в #207; architecture/module ownership map, security model, deployment matrix, ADR registry, module-level coverage и normalized reference layer существуют и проверяются против canonical owners. Automated consistency guard из #208 и production persistence fix #209 также закрыты.

Остаются распределённые runtime ownership gaps #119/#121/#123/#124; они требуют изменений canonical registries/owners, а не расширения overview documentation.