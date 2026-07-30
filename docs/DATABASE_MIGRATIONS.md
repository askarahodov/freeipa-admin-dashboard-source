# Миграции локальной базы портала

## Назначение

Портал использует локальную D1/SQLite-совместимую базу. До запуска обычных HTTP-запросов и scheduled-задач внешний Worker boundary проверяет canonical schema, применяет только разрешённые additive migrations и сверяет migration journal.

Текущая реализация — первый этап задачи #57. Она создаёт migration foundation и принимает существующую runtime-схему. Удаление дублирующего DDL из доменных request handlers выполняется следующим отдельным PR задачи #57.

## Источники истины

Текущее итоговое состояние схемы описано в:

```text
db/portal-schema.ts
```

Неизменяемые SQL statements первой migration находятся отдельно:

```text
db/portal-migration-v1.ts
```

Migration lifecycle находится в:

```text
db/portal-migrations.ts
worker/schema-migrations-entry.ts
```

Canonical inventory перечисляет обязательные таблицы, столбцы, named indexes и append-only audit triggers. Каждая выпущенная migration хранит собственный immutable snapshot SQL. Добавление новой таблицы в итоговый inventory не меняет statements или checksum уже применённой версии.

Автоматические migrations не содержат `DROP`, destructive `ALTER`, `DELETE`, `UPDATE` или data-rewriting `INSERT`.

## Migration journal

Таблица `portal_schema_migrations` хранит:

- номер версии;
- стабильное имя migration;
- SHA-256 checksum immutable migration definition;
- время применения;
- длительность выполнения.

Нельзя вручную изменять, удалять или добавлять строки journal. Несовпадение checksum означает, что уже применённая версия была изменена после выпуска. Портал блокирует readiness с кодом `schema_checksum_mismatch`.

Применённые версии обязаны образовывать точный ordered prefix migration registry. Например, journal `[2]` при registry `[1, 2]` считается повреждённым: портал возвращает `schema_journal_gap` и не пытается автоматически применить пропущенную v1 после v2.

## Startup flow

1. Создаются только infrastructure-таблицы journal и lock.
2. Worker получает migration lock `main`.
3. Проверяются ordered prefix применённых версий, имена и checksum.
4. Pending migrations выполняются строго по порядку registry.
5. Для baseline idempotent table phase выполняется отдельно, затем проверяются обязательные столбцы и constraints.
6. Secondary DDL baseline и запись journal выполняются одним transactional D1 `batch`.
7. Для обычной будущей migration весь DDL и запись journal выполняются одним transactional D1 `batch`.
8. Только после применения всех pending versions выполняется полная проверка итогового canonical inventory.
9. Lock lease обновляется и ownership проверяется перед каждой изменяющей фазой.
10. Lock освобождается best-effort с проверкой owner.

Параллельные запросы одного Worker instance используют общий in-flight promise. Они ждут один результат проверки вместо получения кратковременного `schema_migration_busy`.

Обычный API не вызывается, пока schema state не станет `ready`.

## Crash recovery

DDL и journal одной обычной migration коммитятся атомарно. Завершение процесса между этими действиями не может оставить применённую migration без journal record.

Baseline использует две фазы, потому что перед созданием indexes необходимо диагностировать несовместимые существующие столбцы:

- первая фаза содержит только idempotent `CREATE TABLE IF NOT EXISTS`;
- вторая фаза атомарно применяет indexes/triggers и записывает journal.

Если процесс остановится между фазами baseline, следующий startup безопасно повторит первую idempotent фазу и продолжит вторую.

## Принятие существующей базы

Для существующей базы, где таблицы ранее создавались runtime-кодом, baseline выполняет idempotent `CREATE ... IF NOT EXISTS` и затем проверяет фактическую структуру.

- существующие строки не обновляются и не удаляются;
- недостающие таблицы, indexes и triggers создаются;
- существующая таблица с отсутствующим или несовместимым столбцом не исправляется молча;
- required `UNIQUE`, index columns/order/uniqueness и audit trigger definitions проверяются полностью;
- дополнительные `CHECK`, `FOREIGN KEY` или column-level `REFERENCES`, отсутствующие в canonical definition, блокируют adoption;
- дополнительный trigger на canonical table блокирует adoption, потому что может запрещать или изменять application writes;
- journal version записывается только вместе с успешной изменяющей фазой.

Такой процесс называется adoption. Он не является data migration и не расшифровывает настройки.

## Drift

### Несовместимый drift

Блокирует readiness:

- отсутствующая обязательная таблица;
- отсутствующий обязательный столбец;
- несовпадение типа, `NOT NULL` или primary-key semantics;
- потерянный required `UNIQUE` constraint;
- index с неправильной таблицей, columns, order, uniqueness или partial semantics;
- required trigger с неправильной таблицей, event или body;
- дополнительный trigger на canonical table;
- дополнительный `CHECK`, `FOREIGN KEY` или `REFERENCES` constraint на canonical table;
- дополнительный `NOT NULL` столбец без default, который ломает canonical inserts;
- неизвестная более новая migration version;
- gap или неправильный порядок migration journal;
- несовпадение migration checksum.

### Совместимый drift

Не блокирует запуск, но отображается в diagnostics:

- дополнительная application table;
- nullable дополнительный столбец либо дополнительный столбец с default;
- дополнительный index;
- дополнительный trigger, прикреплённый только к дополнительной application table.

Портал никогда автоматически не удаляет совместимые дополнительные объекты.

## Состояния и коды

| State | Code | Значение |
|---|---|---|
| `ready` | пусто | Все применённые migrations и canonical objects корректны |
| `busy` | `schema_migration_busy` | Migration lock занят другим экземпляром либо ownership потерян |
| `unavailable` | `schema_database_unavailable` | D1 binding отсутствует |
| `incompatible` | `schema_incompatible_drift` | Обнаружен несовместимый structural drift |
| `failed` | `schema_migration_failed` | Migration или inspection завершились ошибкой |
| `failed` | `schema_checksum_mismatch` | Изменено содержимое применённой migration |
| `failed` | `schema_future_version` | База создана более новой версией приложения |
| `failed` | `schema_journal_gap` | Applied versions не образуют ordered prefix registry |

При state, отличном от `ready`, обычный HTTP API возвращает `503`, а scheduled-задачи не запускаются.

## Test-only boundary

Production readiness нельзя отключить environment variable. Unit/API tests, которые намеренно запускают собранный Worker без D1, должны явно пометить in-process env через `markSchemaTestBypass()`.

Маркер хранится в non-enumerable process-local `Symbol` property. Его невозможно передать через `.env`, Docker environment, JSON или HTTP request.

## Recovery status

Service-admin endpoint:

```text
GET /api/schema/status
x-admin-token: <ADMIN_TOKEN>
```

Без корректного token возвращается `401 schema_authorization_required`. Endpoint использует constant-time проверку token.

Ответ содержит только:

- state;
- current/latest version;
- applied/pending versions;
- идентификаторы compatible/incompatible drift;
- безопасный error code;
- время проверки.

Ответ не содержит SQL, checksum, exception body, encrypted values, credentials, cookies или encryption material.

Тот же безопасный status доступен локальному администратору в `/api/auth/diagnostics` внутри `database.schema`.

## Диагностика

1. Получите `/api/schema/status` с service-admin token.
2. Не меняйте journal вручную.
3. При `schema_future_version` используйте версию приложения, которая поддерживает указанную базу.
4. При `schema_checksum_mismatch` восстановите неизменённый release artifact; не заменяйте checksum в базе.
5. При `schema_journal_gap` восстановите database volume из проверенной резервной копии или выполните отдельную audited recovery procedure; не запускайте пропущенные migrations вручную после более новых версий.
6. При incompatible drift сохраните копию Docker volume и сравните объект из `incompatibleDrift` с `db/portal-schema.ts`.
7. Не запускайте ручной destructive SQL без отдельного tested migration и recovery point.

## Rollback

Текущая baseline migration additive и forward-only:

- не изменяет существующие строки;
- не удаляет schema objects;
- не выполняет destructive `ALTER`;
- не требует database rollback при возврате предыдущей версии приложения.

Для отката приложения остановите контейнер, сохраните volume `dashboard-data` и запустите предыдущий release. Если предыдущий release не понимает новые additive objects, он их игнорирует.

Перед будущими destructive или data-rewriting migrations потребуется verified pre-migration backup из задачи #37. До реализации #37 такие migrations запрещены.

## Тестовая матрица foundation

Автоматические tests покрывают:

- empty database и adoption существующей compatible runtime database;
- immutable v1 checksum при расширении registry;
- upgrade через несколько pending versions;
- repeated и concurrent startup;
- checksum mismatch, future version и journal gaps;
- missing/invalid columns, UNIQUE, indexes и required triggers;
- extra triggers на canonical tables и restrictive CHECK/foreign-key constraints;
- compatible extra objects и required extra columns;
- failed DDL без journal commit;
- atomic DDL/journal rollback и retry;
- baseline recovery между idempotent и atomic phases;
- active, stale и потерянный migration lock;
- redaction public status;
- соответствие runtime table inventory canonical schema;
- production missing-DB block и explicit in-process test bypass;
- Chromium bootstrap на реальной локальной D1.

Следующий PR #57 удалит schema-changing DDL из request handlers и усилит test так, чтобы schema changes были разрешены только canonical migration modules.
