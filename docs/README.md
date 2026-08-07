# Engineering documentation

Этот каталог — главный индекс инженерной документации проекта. Он предназначен для разработчиков, операторов, security reviewers и ИИ-агентов.

> Каноническое новое product/display name **Admin Dashboard Softrust** зафиксировано задачей #88. До завершения отдельного rename PR старое имя может встречаться в текущих файлах и historical artifacts.

Корневой [`README.md`](../README.md) остаётся краткой входной точкой. Подробные contracts, runbook и reference находятся в `docs/`.

Текущий результат проверки документации против `main`: [`DOCUMENTATION_INVENTORY.md`](DOCUMENTATION_INVENTORY.md).

## С чего начать

### Новый разработчик

1. [`../README.md`](../README.md) — назначение, quick start и основные boundaries.
2. [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) — authoritative owners контрактов.
3. [`DOCUMENTATION_INVENTORY.md`](DOCUMENTATION_INVENTORY.md) — какие документы проверены против текущего `main`.
4. Профильный документ затрагиваемого домена.
5. Фактический code/tests текущего ref.

Правила ведения документации: [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md).

### ИИ-агент

Обязательная точка входа: [`ai/README.md`](ai/README.md).

ИИ-агент не должен считать GitHub Issue, implementation plan, старый PR или historical design доказательством текущего поведения. При конфликте приоритет у текущего runtime/canonical source и verified active-document.

### Оператор

Начните с:

- [`HEALTH_CONTRACTS.md`](HEALTH_CONTRACTS.md)
- [`HEALTH_METRICS.md`](HEALTH_METRICS.md)
- [`STORAGE_STATUS.md`](STORAGE_STATUS.md)
- [`STORAGE_INTEGRITY.md`](STORAGE_INTEGRITY.md)
- [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md)
- [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md)
- [`OFFLINE_FULL_RESTORE.md`](OFFLINE_FULL_RESTORE.md)
- [`CONFIG_ENCRYPTION_KEY.md`](CONFIG_ENCRYPTION_KEY.md)

Для destructive/recovery операций используйте только профильный active runbook, а не команды из старого Issue/PR.

### Security reviewer

Основной набор:

- [`LOCAL_AUTH_RBAC.md`](LOCAL_AUTH_RBAC.md)
- [`AUDIT_LOG.md`](AUDIT_LOG.md)
- [`CONFIG_ENCRYPTION_KEY.md`](CONFIG_ENCRYPTION_KEY.md)
- [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md)
- [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md)
- [`OFFLINE_FULL_RESTORE.md`](OFFLINE_FULL_RESTORE.md)
- [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md)

Общий `SECURITY_MODEL.md` пока остаётся отдельным gap Epic #82.

## Foundation / governance

| Документ | Назначение |
| --- | --- |
| [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md) | Docs-as-code, current-state vs plan, statuses, review и правила нескольких ИИ-агентов |
| [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) | Authoritative source registry |
| [`DOCUMENTATION_INVENTORY.md`](DOCUMENTATION_INVENTORY.md) | Audit status документов против текущего `main` |
| [`GLOSSARY.md`](GLOSSARY.md) | Единая терминология |
| [`ai/README.md`](ai/README.md) | Обязательный AI-agent entrypoint |

## Authentication / access / audit

| Документ | Назначение |
| --- | --- |
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
4. overview/README;
5. ADR как объяснение решения;
6. roadmap, Issue, implementation plan, PR description и historical notes.

## Когда документация должна измениться

Documentation impact обязателен, если PR изменяет:

- route/method/auth/permission;
- DB schema/migration/data ownership;
- environment/configuration;
- FreeIPA/XYOps protocol;
- security/trust/redaction/secret handling;
- startup/deployment/network/health;
- backup/restore/maintenance/recovery;
- пользовательский workflow, уже описанный в документации;
- module boundary или source of truth.

Если код делает active-document неверным, PR не считается завершённым до исправления документации либо явной регистрации blocking documentation defect.

## Известные gaps Epic #82

После baseline audit остаются отдельные задачи на:

- `ARCHITECTURE.md`;
- `PROJECT_STRUCTURE.md` и module-boundary map;
- `SECURITY_MODEL.md`;
- normalized API/permissions/error-code/configuration reference;
- supported/unsupported deployment matrix;
- ADR registry;
- module-level documentation coverage;
- automated documentation consistency CI.

Эти файлы нельзя считать существующими до их реального появления в `main`.
