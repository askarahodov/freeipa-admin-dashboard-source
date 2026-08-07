# Engineering documentation

Этот каталог — главный индекс инженерной документации FreeIPA Admin Dashboard. Он предназначен одновременно для разработчиков, операторов, security reviewers и ИИ-агентов.

Корневой `README.md` остаётся краткой входной точкой проекта. Подробные архитектурные, эксплуатационные и reference-контракты должны находиться в `docs/`.

## Как пользоваться документацией

### Если вы впервые знакомитесь с проектом

1. Прочитайте корневой [`README.md`](../README.md).
2. Прочитайте этот индекс.
3. Для текущей реализации локальной аутентификации изучите [`LOCAL_AUTH_RBAC.md`](LOCAL_AUTH_RBAC.md).
4. Для базы и запуска runtime изучите [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md) и [`HEALTH_CONTRACTS.md`](HEALTH_CONTRACTS.md).
5. Перед recovery/restore операциями обязательно изучите профильные runbook, начиная с [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md).

### Для разработчика

Перед изменением кода:

1. определить затрагиваемый домен;
2. проверить [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md);
3. прочитать профильный документ домена;
4. проверить связанные tests и актуальный `main`;
5. обновить документацию в том же PR, если изменяется контракт, архитектура, конфигурация, безопасность или эксплуатационное поведение.

Правила ведения документации: [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md).

### Для оператора

Основные эксплуатационные документы:

- [`HEALTH_CONTRACTS.md`](HEALTH_CONTRACTS.md) — liveness, readiness и состояние внешних зависимостей;
- [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md) — canonical schema, migration journal, drift и startup gate;
- [`STORAGE_STATUS.md`](STORAGE_STATUS.md) — bounded read-only storage diagnostics;
- [`STORAGE_INTEGRITY.md`](STORAGE_INTEGRITY.md) — read-only integrity и canonical index diagnostics;
- [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md) — persistent maintenance boundary и recovery flow.

Перед выполнением destructive или recovery операций используйте только профильные runbook и команды, описанные для текущего release.

### Для security reviewer

Начните с:

- [`LOCAL_AUTH_RBAC.md`](LOCAL_AUTH_RBAC.md);
- [`HEALTH_CONTRACTS.md`](HEALTH_CONTRACTS.md);
- [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md);
- [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md);
- [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md).

Общий `SECURITY_MODEL.md` пока является документальным пробелом и будет создан отдельной задачей Epic #82. До его появления security-модель необходимо восстанавливать по актуальным профильным контрактам и runtime-коду, а не по roadmap.

### Для ИИ-агента

Обязательная точка входа: [`ai/README.md`](ai/README.md).

ИИ-агент не должен считать issue, implementation plan или старый PR доказательством текущего поведения. Фактический `main`, canonical code contracts и актуальные active-документы имеют приоритет.

## Текущие профильные документы

На момент создания этого индекса в `main` подтверждены следующие ключевые документы:

| Документ | Назначение |
| --- | --- |
| [`LOCAL_AUTH_RBAC.md`](LOCAL_AUTH_RBAC.md) | Локальные пользователи портала, sessions, роли и separation от FreeIPA identities |
| [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md) | Canonical D1/SQLite schema, migrations, journal, lock, adoption и drift |
| [`HEALTH_CONTRACTS.md`](HEALTH_CONTRACTS.md) | Liveness, readiness, dependency diagnostics и безопасные response contracts |
| [`STORAGE_STATUS.md`](STORAGE_STATUS.md) | Read-only storage status и browser-independent inspection |
| [`STORAGE_INTEGRITY.md`](STORAGE_INTEGRITY.md) | Bounded integrity/index diagnostics без repair |
| [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md) | Persistent maintenance state и online/offline recovery boundary |

Другие существующие runbook и feature documents продолжают использоваться; их полная инвентаризация и классификация выполняется в рамках Epic #82. Не переносите и не переименовывайте существующие документы массово без migration map и проверки ссылок.

## Известные пробелы

Следующие документы нужны проекту, но их наличие или полнота не должны предполагаться до выполнения соответствующих задач:

- общий `ARCHITECTURE.md`;
- `PROJECT_STRUCTURE.md` и module-boundary map;
- общий `SECURITY_MODEL.md`;
- versioned API route/permission/error-code reference;
- supported/unsupported deployment matrix;
- полный ADR registry;
- единая module documentation structure;
- automated documentation consistency checks.

План закрытия этих пробелов находится в Epic #82. План не является current-state документацией.

## Иерархия доверия

При противоречии информации используйте следующий порядок:

1. фактический код, schema/route/permission registry и tests текущего `main`;
2. явно указанный source of truth из [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md);
3. active профильный contract/runbook;
4. корневой README и обзорные документы;
5. ADR для объяснения принятого решения;
6. issue, implementation plan, PR description и historical notes.

Issue и plan могут описывать ещё не реализованное поведение и поэтому не могут переопределять runtime.

## Правило актуальности

Если изменение кода делает документ неверным, PR считается незавершённым до исправления документации. Если документ устарел и его нельзя исправить в текущем scope, это должно быть явно отмечено в PR и заведено как отдельная blocking/follow-up задача — без ложного утверждения, что старый текст остаётся актуальным.
