# Миграции локальной базы портала

## Назначение

Портал использует локальную D1/SQLite-совместимую базу. До запуска обычных HTTP-запросов и scheduled-задач внешний Worker boundary проверяет canonical schema, применяет только разрешённые additive migrations и сверяет migration journal.

Текущая реализация — первый этап задачи #57. Она создаёт migration foundation и принимает существующую runtime-схему. Удаление дублирующего DDL из доменных request handlers выполняется следующим отдельным PR задачи #57.

## Источник истины

Canonical inventory находится в:

```text
db/portal-schema.ts
```

Migration lifecycle находится в:

```text
db/portal-migrations.ts
worker/schema-migrations-entry.ts
```

В inventory перечислены обязательные таблицы, столбцы, named indexes и append-only audit triggers. Автоматическая baseline migration содержит только `CREATE ... IF NOT EXISTS`. В ней запрещены `DROP`, destructive `ALTER`, `DELETE`, `UPDATE` и data `INSERT`.

## Migration journal

Таблица `portal_schema_migrations` хранит:

- номер версии;
- стабильное имя migration;
- SHA-256 checksum migration definition;
- время применения;
- длительность выполнения.

Нельзя вручную изменять, удалять или добавлять строки journal. Несовпадение checksum означает, что уже применённая версия была изменена после выпуска. Портал блокирует readiness с кодом `schema_checksum_mismatch`.

## Startup flow

1. Создаются только infrastructure-таблицы journal и lock.
2. Worker получает migration lock `main`.
3. Проверяются применённые версии и checksum.
4. Pending additive migration выполняется D1 batch.
5. Проверяются обязательные таблицы, столбцы, indexes и triggers.
6. Journal обновляется только после успешной structural verification.
7. Выполняется финальная проверка readiness.
8. Lock освобождается best-effort с проверкой owner.

Обычный API не вызывается, пока schema state не станет `ready`.

## Принятие существующей базы

Для существующей базы, где таблицы ранее создавались runtime-кодом, baseline выполняет idempotent `CREATE ... IF NOT EXISTS` и затем проверяет фактическую структуру.

- существующие строки не обновляются и не удаляются;
- недостающие таблицы, indexes и triggers создаются;
- существующая таблица с отсутствующим или несовместимым столбцом не исправляется молча;
- journal version записывается только после полной проверки.

Такой процесс называется adoption. Он не является data migration и не расшифровывает настройки.

## Drift

### Несовместимый drift

Блокирует readiness:

- отсутствующая обязательная таблица;
- отсутствующий обязательный столбец;
- несовпадение типа, `NOT NULL` или primary-key semantics;
- отсутствующий либо привязанный не к той таблице index/trigger;
- неизвестная более новая migration version;
- несовпадение migration checksum.

### Совместимый drift

Не блокирует запуск, но отображается в diagnostics:

- дополнительная application table;
- дополнительный столбец;
- дополнительный index или trigger.

Портал никогда автоматически не удаляет совместимые дополнительные объекты.

## Состояния и коды

| State | Code | Значение |
|---|---|---|
| `ready` | пусто | Все применённые migrations и canonical objects корректны |
| `busy` | `schema_migration_busy` | Migration lock занят другим экземпляром |
| `unavailable` | `schema_database_unavailable` | D1 binding отсутствует |
| `incompatible` | `schema_incompatible_drift` | Обнаружен несовместимый structural drift |
| `failed` | `schema_migration_failed` | Migration или inspection завершились ошибкой |
| `failed` | `schema_checksum_mismatch` | Изменено содержимое применённой migration |
| `failed` | `schema_future_version` | База создана более новой версией приложения |

При state, отличном от `ready`, обычный HTTP API возвращает `503`, а scheduled-задачи не запускаются.

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
5. При incompatible drift сохраните копию Docker volume и сравните объект из `incompatibleDrift` с `db/portal-schema.ts`.
6. Не запускайте ручной destructive SQL без отдельного tested migration и recovery point.

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

- empty database;
- adoption существующей compatible runtime database;
- repeated startup;
- checksum mismatch;
- future version;
- missing column/index/trigger;
- compatible extra objects;
- failed DDL без journal commit;
- active и stale migration lock;
- redaction public status;
- соответствие runtime table inventory canonical schema.

Следующий PR #57 удалит schema-changing DDL из request handlers и усилит test так, чтобы schema changes были разрешены только canonical migration modules.
