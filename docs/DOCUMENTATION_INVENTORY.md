# Documentation inventory and audit status

Этот документ — рабочий inventory инженерной документации проекта для задачи #85 и Epic #82. Он фиксирует назначение документа, owner/source of truth и результат проверки против актуального `main`.

> Каноническое новое имя продукта **Admin Dashboard Softrust** зафиксировано задачей #88. Repository-wide rename выполняется отдельным атомарным PR после стабилизации documentation baseline.

Статусы:

- `verified-active` — проверен против текущего `main`; подтверждённого drift не найдено;
- `needs-update` — найдено подтверждённое устаревшее/противоречивое утверждение;
- `verification-pending` — документ найден, но полный аудит ещё не завершён;
- `plan` — roadmap/task planning, не доказательство runtime;
- `design/historical` — исторический design artifact, не active runbook.

## Foundation и навигация

| Path | Тип | Owner / source of truth | Status | Примечание |
| --- | --- | --- | --- | --- |
| `README.md` | product overview / quick start | runtime + Compose + package/config | `needs-update` | Recovery section отстаёт от реализованного offline full restore |
| `docs/README.md` | documentation index | documentation policy + inventory | `verified-active` | Главный навигатор |
| `docs/DOCUMENTATION_POLICY.md` | policy | Epic #82 documentation contract | `verified-active` | Docs-as-code и правила нескольких ИИ-агентов |
| `docs/SOURCE_OF_TRUTH.md` | reference registry | canonical runtime owners | `verified-active` | Не заменяет code registries |
| `docs/GLOSSARY.md` | terminology | active runtime/domain semantics | `verified-active` | Общая терминология |
| `docs/ai/README.md` | AI entrypoint | documentation policy + source registry | `verified-active` | Обязательный порядок чтения для ИИ-агентов |
| `.github/pull_request_template.md` | contribution process | documentation policy | `verified-active` | Documentation/security/source-of-truth checklist |

## Runtime, security и operations

| Path | Тип | Owner / source of truth | Status | Примечание |
| --- | --- | --- | --- | --- |
| `docs/LOCAL_AUTH_RBAC.md` | security/reference | `local-auth.ts` + local session boundary + DB schema | `verified-active` | PBKDF2, 5 attempts, 15-minute lock, session revocation и Portal/FreeIPA identity separation подтверждены |
| `docs/DATABASE_MIGRATIONS.md` | operations/runbook | `db/portal-schema.ts`, migration runtime/tests | `needs-update` | Остались переходные фразы про «первый этап #57» / «следующий PR» |
| `docs/MAINTENANCE_MODE.md` | security/runbook | maintenance runtime + `portal_maintenance_state` | `verified-active` | Persistent maintenance boundary |
| `docs/OFFLINE_FULL_RESTORE.md` | destructive recovery runbook | recovery CLI/scripts + merged #72 | `verified-active` | Maintenance, stopped runtime, flock, encrypted recovery point, atomic swap, receipt, verify/rollback подтверждены |
| `docs/HEALTH_CONTRACTS.md` | operations/reference | health handlers/contracts + #74–#76 | `verified-active` | Liveness/readiness/dependency separation подтверждена |
| `docs/HEALTH_METRICS.md` | monitoring/reference | `/metrics/health` + monitoring rules + #77 | `verified-active` | Fixed low-cardinality metrics, без внешних probes |
| `docs/STORAGE_STATUS.md` | operations/reference | storage status contract + #78 | `verified-active` | Bounded read-only status |
| `docs/STORAGE_INTEGRITY.md` | operations/reference | integrity contract/index registry + #79 | `verified-active` | Read-only quick-check/index diagnostics |
| `docs/CONFIG_ENCRYPTION_KEY.md` | security/runbook | startup validator + Compose + #86 | `verified-active` | Новый production key contract после #86; production key только внешний |
| `docs/AUDIT_LOG.md` | security/reference | `audit-log.ts`, Worker route, append-only schema | `verified-active` | Correlation, redaction, GET-only API и `settings.manage` подтверждены |
| `docs/LOCAL_ACCEPTANCE_TESTS.md` | testing/runbook | local integration harness/scripts | `needs-update` | Hardcoded Compose-generated volume name хрупок и зависит от project directory/name |
| `docs/P0_OPERATIONAL_ACCEPTANCE.md` | testing/runbook | `scripts/p0-operational-acceptance.mjs` + package script | `verified-active` | `test:p0:acceptance` существует; restart service `dashboard` соответствует Compose |

## Интеграции и продуктовые контракты

| Path | Тип | Owner / source of truth | Status | Примечание |
| --- | --- | --- | --- | --- |
| `docs/XYOPS_EXECUTION_OWNERSHIP.md` | architecture/integration | XYOps client/catalog/run runtime | `verified-active` | XYOps остаётся owner scheduler/concurrency/rate limits |
| `docs/XYOPS_INSPECTOR.md` | integration/reference | `scripts/xyops-inspect.mjs` | `verified-active` | Inspector v3, GET-only probes, required Events, 0600 output, network classification подтверждены |
| `docs/PROCESS_PRESENTATION_METADATA.md` | feature/reference | `process-presentation.ts`, Worker route, DB schema | `verified-active` | D1→ENV→default precedence, BCP47, bounded overrides, admin boundary и audit action подтверждены |

## Roadmap, plans и historical design

| Path | Тип | Owner / source of truth | Status | Примечание |
| --- | --- | --- | --- | --- |
| `docs/PRODUCT_ROADMAP.md` | roadmap | GitHub Issues + merged work | `plan` | Не использовать вместо runtime contract |
| `docs/OPEN_TASKS.md` | task snapshot | GitHub Issues | `needs-update` | Датирован 30 июля и содержит уже завершённые/изменившиеся пункты |
| `docs/superpowers/**/` | design/plans | соответствующий implementation + active docs | `design/historical` | Не использовать как current operational contract после реализации |

## Подтверждённые расхождения

### DOC-001 — README отстаёт от offline recovery

README всё ещё описывает destructive full restore / CLI recovery как будущую работу, хотя `docs/OFFLINE_FULL_RESTORE.md` и merged #72 уже определяют рабочий offline workflow.

**Решение:** переписать recovery overview в current-state форме и ссылаться на active runbook.

### DOC-002 — DATABASE_MIGRATIONS содержит завершённый transition как будущую работу

Active migration document всё ещё содержит «первый этап #57» / «следующий PR #57», хотя canonical inventory, journal/lock, adoption/drift и удаление runtime DDL уже реализованы.

**Решение:** удалить временные future markers, не меняя технический contract.

### DOC-003 — OPEN_TASKS больше не является актуальным task registry

`docs/OPEN_TASKS.md` — dated snapshot, который расходится с текущими Issues и merged work.

**Решение:** перевести документ в historical/superseded snapshot и направить читателя в GitHub Issues/Epic.

### DOC-004 — HEALTH_METRICS не был включён в основной индекс

`docs/HEALTH_METRICS.md` — active contract после #77, но не был включён foundation index.

**Решение:** добавить в `docs/README.md`.

### DOC-005 — LOCAL_ACCEPTANCE_TESTS использует хрупкое имя Docker volume

Команда `docker volume rm freeipa-admin-dashboard-source_dashboard-data` зависит от Compose project name/имени каталога и может удалить не тот volume либо не удалить нужный после rename/другого checkout path.

**Решение:** использовать Compose-aware cleanup (`docker compose down -v`) только для явно disposable acceptance-контура либо документировать project name; не вычислять volume вручную из имени репозитория.

## Проверенные группы

- Auth/RBAC — verified против `local-auth.ts` и local session boundary.
- Health/storage — verified против #74–#79 и текущих contracts.
- Production encryption key — verified против #86, `compose.yaml` и startup validator.
- Offline recovery — verified против #72 и recovery runbook.
- Audit — verified против `audit-log.ts` и Worker route.
- XYOps ownership/inspector/presentation — verified против current runtime/scripts.
- P0 automated acceptance — script/package/Compose entrypoints подтверждены.

## Правила завершения #85

1. Исправить все `needs-update` active-документы.
2. Обновить `docs/README.md`, включая health metrics, encryption-key runbook, offline restore и acceptance docs.
3. Не использовать roadmap/Issues как доказательство runtime.
4. Не менять runtime в этом PR.
5. После параллельного merge другого агента сначала синхронизировать ветку с новым `main` и повторно проверить affected documentation.
