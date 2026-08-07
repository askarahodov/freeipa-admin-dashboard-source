# Documentation inventory and audit status

Этот документ фиксирует baseline инженерной документации для задачи #85 и Epic #82: назначение, owner/source of truth и результат проверки против актуального `main`/целевого stacked ref.

> Каноническое product/display name — **Admin Dashboard Softrust**. Технические compatibility identifiers не переименовываются в рамках branding-only изменений.

Статусы:

- `verified-active` — проверен против текущего `main`/целевого ref; подтверждённого drift не найдено;
- `plan` — roadmap/task planning, не доказательство runtime;
- `superseded` — заменён другим source of truth;
- `design/historical` — исторический design/implementation artifact, не active runbook.

## Foundation и навигация

| Path | Тип | Owner / source of truth | Status | Примечание |
| --- | --- | --- | --- | --- |
| `README.md` | product overview / quick start | runtime + Compose + package/config | `verified-active` | Стабильная входная точка; offline restore и controlled migrations отражают current state |
| `docs/README.md` | documentation index | documentation policy + inventory | `verified-active` | Основной навигатор active docs |
| `docs/ARCHITECTURE.md` | architecture/current-state overview | current runtime entries, Compose/startup, canonical domain owners and tests | `verified-active` | Проверены system context, request chain, trust/data/failure boundaries, current runtime/network/frontend limitations |
| `docs/PROJECT_STRUCTURE.md` | repository/module ownership map | current repository paths + `SOURCE_OF_TRUTH.md` + representative tests | `verified-active` | Куда относить UI/auth/FreeIPA/XYOps/storage/recovery/docs/tests; не является target refactor plan |
| `docs/DOCUMENTATION_POLICY.md` | policy | Epic #82 documentation contract | `verified-active` | Docs-as-code и правила нескольких ИИ-агентов |
| `docs/SOURCE_OF_TRUTH.md` | reference registry | canonical runtime owners | `verified-active` | Не заменяет code registries |
| `docs/GLOSSARY.md` | terminology | active runtime/domain semantics | `verified-active` | Общая терминология |
| `docs/ai/README.md` | AI entrypoint | documentation policy + source registry | `verified-active` | Обязательный порядок чтения для ИИ-агентов |
| `.github/pull_request_template.md` | contribution process | documentation policy | `verified-active` | Documentation/security/source-of-truth checklist |

## Runtime, security и operations

| Path | Тип | Owner / source of truth | Status | Примечание |
| --- | --- | --- | --- | --- |
| `docs/SECURITY_MODEL.md` | security/current-state overview | current auth/session/service-admin/integration/recovery owners + active security runbooks/tests | `verified-active` | Trust/identity/secret/authorization/recovery/fail-closed model; не заменяет exact security/runbook owners |
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
| `docs/superpowers/specs/**` | design artifacts | implementation + active docs | `design/historical` | Не являются current runbook после реализации |
| `docs/superpowers/plans/**` | implementation/review plans | implementation + active docs | `design/historical` | Не являются current contract после merge |

## Исправленные расхождения baseline

- **DOC-001:** README больше не описывает destructive offline recovery как будущую работу.
- **DOC-002:** `DATABASE_MIGRATIONS.md` больше не содержит завершённый #57 transition как future work и отражает automatic/controlled migration lifecycle.
- **DOC-003:** `OPEN_TASKS.md` переведён в `superseded`; backlog source of truth — GitHub Issues.
- **DOC-004:** `HEALTH_METRICS.md` добавлен в основной docs index.
- **DOC-005:** `LOCAL_ACCEPTANCE_TESTS.md` больше не вычисляет Docker volume из имени repository/project directory.
- **DOC-006:** `CONFIG_ENCRYPTION_KEY.md` и external-only production key contract добавлены в inventory/index.
- **DOC-007:** добавлены `ARCHITECTURE.md` и `PROJECT_STRUCTURE.md`; docs index/AI entrypoint больше не утверждают, что эти current-state документы отсутствуют.
- **DOC-008:** добавлен `SECURITY_MODEL.md`; security reviewer/AI flow теперь имеет единый current-state trust/identity/secret/recovery overview без создания второго runtime owner.

## Проверенные группы

- Architecture/topology — Compose, Dockerfile, startup scripts, Worker entry chain, merged UI foundation and current constraints.
- Repository/module boundaries — `app/`, `app/styles/`, `app/ui/`, `worker/`, `db/`, root domain modules, scripts, tests/e2e, docs, CI/deployment files.
- Security model — `local-auth.ts`, `admin-session-authorization.ts`, `scripts/freeipa-gateway.mjs`, active auth/audit/encryption/maintenance/recovery/schema/health docs and representative security tests/log evidence.
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

## Ограничения inventory

Этот baseline перечисляет active/current инженерные документы и отдельно классифицирует `docs/superpowers/specs/**` / `plans/**` как historical implementation artifacts. Historical plans не перечисляются по одному, потому что они не являются current contracts и их authoritative owner — соответствующий merged implementation + active documentation.

`verified-active` для architecture/project/security overview означает проверку current-state утверждений против целевого ref и canonical owners. Если параллельный runtime/UI/security PR меняет описанный boundary до merge соответствующей документационной ветки, документы должны быть синхронизированы и повторно проверены на exact merge candidate.

## Следующие gaps Epic #82

Baseline актуализирован, architecture/module ownership map и security model добавлены. Остаются отдельные current-state задачи:

- normalized API / permissions / error codes / configuration reference;
- supported/unsupported deployment matrix;
- ADR registry;
- module-level documentation coverage;
- automated documentation consistency CI.
