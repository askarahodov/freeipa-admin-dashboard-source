# Engineering documentation

Этот каталог — главный индекс инженерной документации проекта. Он предназначен для разработчиков, операторов, security reviewers и ИИ-агентов.

> Каноническое product/display name — **Admin Dashboard Softrust**. Historical artifacts могут сохранять прежнее название; active current-state documentation должна использовать каноническое имя.

Корневой [`README.md`](../README.md) остаётся краткой входной точкой. Подробные contracts, runbook и reference находятся в `docs/`.

Текущий результат проверки документации против `main`: [`DOCUMENTATION_INVENTORY.md`](DOCUMENTATION_INVENTORY.md).

## С чего начать

### Новый разработчик

1. [`../README.md`](../README.md) — назначение, quick start и основные boundaries.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — current runtime topology, trust/data boundaries и major ownership.
3. [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) — карта repository/module boundaries и куда вносить изменение.
4. [`DEPLOYMENT_MATRIX.md`](DEPLOYMENT_MATRIX.md) — какие способы запуска поддерживаются в production, development и какие остаются unsupported/constrained.
5. [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) — authoritative owners контрактов.
6. [`DOCUMENTATION_INVENTORY.md`](DOCUMENTATION_INVENTORY.md) — какие документы проверены против текущего `main`.
7. При изменении внешнего/операционного контракта свериться с [`reference/API.md`](reference/API.md), [`reference/PERMISSIONS.md`](reference/PERMISSIONS.md), [`reference/CONFIGURATION.md`](reference/CONFIGURATION.md) и [`reference/ERROR_CODES.md`](reference/ERROR_CODES.md).
8. Профильный документ затрагиваемого домена и фактический code/tests текущего ref.

Правила ведения документации: [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md).

### ИИ-агент

Обязательная точка входа: [`ai/README.md`](ai/README.md).

ИИ-агент не должен считать GitHub Issue, implementation plan, старый PR или historical design доказательством текущего поведения. При конфликте приоритет у текущего runtime/canonical source и verified active-document.

### Оператор

Начните с:

- [`DEPLOYMENT_MATRIX.md`](DEPLOYMENT_MATRIX.md)
- [`HEALTH_CONTRACTS.md`](HEALTH_CONTRACTS.md)
- [`HEALTH_METRICS.md`](HEALTH_METRICS.md)
- [`STORAGE_STATUS.md`](STORAGE_STATUS.md)
- [`STORAGE_INTEGRITY.md`](STORAGE_INTEGRITY.md)
- [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md)
- [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md)
- [`OFFLINE_FULL_RESTORE.md`](OFFLINE_FULL_RESTORE.md)
- [`CONFIG_ENCRYPTION_KEY.md`](CONFIG_ENCRYPTION_KEY.md)
- [`reference/CONFIGURATION.md`](reference/CONFIGURATION.md)
- [`reference/ERROR_CODES.md`](reference/ERROR_CODES.md)

Для destructive/recovery операций используйте только профильный active runbook, а не команды из старого Issue/PR.

### Security reviewer

Основной набор:

- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`DEPLOYMENT_MATRIX.md`](DEPLOYMENT_MATRIX.md)
- [`SECURITY_MODEL.md`](SECURITY_MODEL.md)
- [`LOCAL_AUTH_RBAC.md`](LOCAL_AUTH_RBAC.md)
- [`reference/PERMISSIONS.md`](reference/PERMISSIONS.md)
- [`reference/API.md`](reference/API.md)
- [`reference/CONFIGURATION.md`](reference/CONFIGURATION.md)
- [`AUDIT_LOG.md`](AUDIT_LOG.md)
- [`CONFIG_ENCRYPTION_KEY.md`](CONFIG_ENCRYPTION_KEY.md)
- [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md)
- [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md)
- [`OFFLINE_FULL_RESTORE.md`](OFFLINE_FULL_RESTORE.md)
- [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md)

`SECURITY_MODEL.md` связывает current trust/identity/secret/recovery boundaries, а точные permissions, routes, configuration classes, machine codes, поля, команды и state transitions остаются в профильных active documents/runbooks и canonical runtime owners.

## Foundation / governance

| Документ | Назначение |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Current runtime topology, request chain, trust/data/failure boundaries и подтверждённые ограничения |
| [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) | Repository ownership map, module boundaries и practical where-to-change routing |
| [`DEPLOYMENT_MATRIX.md`](DEPLOYMENT_MATRIX.md) | Current supported/development/constrained/unsupported deployment modes и их canonical evidence |
| [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md) | Docs-as-code, current-state vs plan, statuses, review и правила нескольких ИИ-агентов |
| [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) | Authoritative source registry |
| [`DOCUMENTATION_INVENTORY.md`](DOCUMENTATION_INVENTORY.md) | Audit status документов против текущего `main` |
| [`GLOSSARY.md`](GLOSSARY.md) | Единая терминология |
| [`ai/README.md`](ai/README.md) | Обязательный AI-agent entrypoint |

## Normalized reference layer

Эти документы дают единый человекочитаемый вход в распределённые runtime contracts. Они **не создают второй runtime registry**: при изменении поведения canonical code owner и его tests остаются authoritative.

| Документ | Назначение |
| --- | --- |
| [`reference/API.md`](reference/API.md) | Поддерживаемые route families, methods, authorization boundaries и current owners |
| [`reference/PERMISSIONS.md`](reference/PERMISSIONS.md) | Built-in roles и canonical permission codes из `portal-permissions.ts`, с явной маркировкой известного RBAC drift |
| [`reference/CONFIGURATION.md`](reference/CONFIGURATION.md) | Production/runtime/dynamic/recovery/test configuration classes, secret/lifecycle/source semantics |
| [`reference/ERROR_CODES.md`](reference/ERROR_CODES.md) | Подтверждённые stable machine-readable codes по доменам; human strings и audit action names исключены |

Текущие ограничения reference layer отслеживаются отдельно: #119 (RBAC owners), #121 (machine-readable route registry), #123 (machine-readable supported configuration contract), #124 (consolidated error-code registry).

## Authentication / access / audit

| Документ | Назначение |
| --- | --- |
| [`SECURITY_MODEL.md`](SECURITY_MODEL.md) | Current trust boundaries, identity classes, secret ownership, authorization/recovery invariants и fail-closed/degraded behavior |
| [`LOCAL_AUTH_RBAC.md`](LOCAL_AUTH_RBAC.md) | Local portal users, sessions, roles и separation от FreeIPA identities |
| [`AUDIT_LOG.md`](AUDIT_LOG.md) | Append-only audit, correlation, redaction и read API |

## Storage / schema / recovery

| Документ | Назначение |
| --- | --- |
| [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md) | Canonical schema, automatic/controlled migrations, journal, drift и recovery semantics |
| [`STORAGE_STATUS.md`](STORAGE_STATUS.md) | Bounded read-only storage status |
| [`STORAGE_INTEGRITY.md`](STORAGE_INTEGRITY.md) | Read-only SQLite/index integrity diagnostics |
| [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md) | Persistent maintenance state machine и recovery boundary |
| [`OFFLINE_FULL_RESTORE.md`](OFFLINE_FULL_RESTORE.md) | Destructive offline full restore, atomic swap, verify и rollback |
| [`CONFIG_ENCRYPTION_KEY.md`](CONFIG_ENCRYPTION_KEY.md) | Production encryption-key generation/startup requirements |

## Health / monitoring

| Документ | Назначение |
| --- | --- |
| [`HEALTH_CONTRACTS.md`](HEALTH_CONTRACTS.md) | Liveness, readiness, dependency health и diagnostics |
| [`HEALTH_METRICS.md`](HEALTH_METRICS.md) | Prometheus-compatible baseline health metrics |

## XYOps / process presentation

| Документ | Назначение |
| --- | --- |
| [`XYOPS_EXECUTION_OWNERSHIP.md`](XYOPS_EXECUTION_OWNERSHIP.md) | Разделение ответственности Portal/XYOps за execution, queue, concurrency и rate limits |
| [`XYOPS_INSPECTOR.md`](XYOPS_INSPECTOR.md) | Safe read-only contract inspector для установленной версии XYOps |
| [`PROCESS_PRESENTATION_METADATA.md`](PROCESS_PRESENTATION_METADATA.md) | Presentation overrides, locale/fallback и безопасные boundaries |

## Testing / acceptance

| Документ | Назначение |
| --- | --- |
| [`LOCAL_ACCEPTANCE_TESTS.md`](LOCAL_ACCEPTANCE_TESTS.md) | Ручная/интеграционная локальная acceptance-процедура |
| [`P0_OPERATIONAL_ACCEPTANCE.md`](P0_OPERATIONAL_ACCEPTANCE.md) | Автоматический P0 local-auth/persistence runner |

## Roadmap / historical material

| Документ | Статус |
| --- | --- |
| [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md) | Roadmap/snapshot; не является доказательством runtime |
| [`OPEN_TASKS.md`](OPEN_TASKS.md) | `superseded` historical task snapshot; текущий backlog — GitHub Issues |
| `superpowers/specs/**` | Design/historical artifacts |
| `superpowers/plans/**` | Implementation/review plans; после merge не заменяют active docs |

## Иерархия доверия

При противоречии информации:

1. фактический код, canonical registries/schema и tests текущего ref;
2. owner/source из [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md);
3. `verified-active` профильный contract/runbook;
4. normalized `reference/*` как current-state orientation, если он подтверждён canonical owners;
5. [`ARCHITECTURE.md`](ARCHITECTURE.md), [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md), [`DEPLOYMENT_MATRIX.md`](DEPLOYMENT_MATRIX.md), [`SECURITY_MODEL.md`](SECURITY_MODEL.md) и overview/README;
6. ADR как объяснение решения;
7. roadmap, Issue, implementation plan, PR description и historical notes.

## Когда документация должна измениться

Documentation impact обязателен, если PR изменяет:

- route/method/auth/permission;
- DB schema/migration/data ownership;
- environment/configuration;
- FreeIPA/XYOps protocol;
- stable machine-readable error code;
- security/trust/redaction/secret handling;
- startup/deployment/network/health;
- backup/restore/maintenance/recovery;
- пользовательский workflow, уже описанный в документации;
- module boundary или source of truth.

Если код делает active-document неверным, PR не считается завершённым до исправления документации либо явной регистрации blocking documentation defect.

## Известные gaps Epic #82

После baseline audit, current architecture/module-map, security model, deployment matrix, normalized reference layer и automated documentation consistency CI остаются отдельные задачи на:

- ADR registry;
- module-level documentation coverage;
- устранение распределённых runtime ownership gaps #119/#121/#123/#124.

Новые current-state файлы нельзя считать существующими до их реального появления в `main`.