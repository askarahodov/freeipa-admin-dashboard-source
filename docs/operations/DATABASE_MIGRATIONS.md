# Миграции локальной базы портала

## Назначение

Портал использует локальную D1/SQLite-совместимую базу. До запуска обычных HTTP-запросов и scheduled-задач внешний schema boundary проверяет migration journal и canonical schema.

Текущий lifecycle поддерживает два режима migration:

- `automatic` — безопасные additive migrations, которые runtime может применить при startup;
- `controlled` — migrations, которые не применяются автоматически и требуют отдельного maintenance-gated apply workflow.

Request/scheduled domain handlers не являются владельцами DDL. Production schema changes принадлежат canonical migration modules в `db/`.

## Источники истины

Canonical schema и inventory:

```text
db/portal-schema.ts
```

Versioned migration definitions:

```text
db/portal-migration-v1.ts
...
db/portal-migration-v4.ts
```

Migration registry и режимы:

```text
db/portal-migration-registry.ts
db/portal-migrations-v4.ts
db/portal-controlled-migrations.ts
```

Основной lifecycle/inspection:

```text
db/portal-migrations.ts
worker/schema-migrations-entry.ts
worker/schema-migrations-boundary.ts
```

Controlled apply:

```text
storage-migration-apply-contract.ts
storage-migration-apply.ts
storage-migration-apply-executor.ts
storage-migration-locked-preflight.ts
worker/storage-migration-apply-entry.ts
```

Canonical inventory перечисляет обязательные таблицы, столбцы, named indexes и append-only audit triggers. Выпущенная migration хранит immutable SQL snapshot/checksum; добавление следующей migration не переписывает предыдущую версию.

## Registry invariants

Migration registry обязан быть строгим ordered sequence версий `1..N`.

Каждая migration имеет:

- `version`;
- стабильное `name`;
- immutable statements/snapshot;
- checksum;
- `mode: automatic | controlled`.

После появления первой `controlled` migration registry не может снова содержать `automatic` migration. Controlled migrations образуют suffix registry, чтобы startup никогда не перепрыгивал через migration, требующую явного операторского решения.

Текущая v4 `controlled-migration-foundation` является `automatic`: она добавляет infrastructure для будущих controlled operations. Сам факт наличия controlled framework не означает, что существует production controlled migration, которую обязательно нужно применить сейчас.

## Migration journal

Таблица `portal_schema_migrations` хранит:

- номер версии;
- стабильное имя migration;
- SHA-256 checksum immutable migration definition;
- время применения;
- длительность выполнения.

Applied versions обязаны образовывать точный ordered prefix registry. Journal `[2]` при registry `[1,2]` считается повреждённым.

Нельзя вручную изменять, удалять или добавлять строки journal. При checksum mismatch runtime блокирует нормальную работу; оператор должен восстановить корректный release/database state, а не «исправлять» checksum вручную.

## Startup flow

1. Runtime открывает D1 binding и migration infrastructure.
2. Проверяет registry, journal prefix, names и checksums.
3. Получает owner-scoped migration lock для изменяющей фазы.
4. Применяет только pending migrations с `mode=automatic` строго по порядку.
5. DDL и journal commit выполняются атомарно там, где migration contract это предусматривает.
6. После automatic suffix выполняется повторная inspection.
7. Если остаётся pending `controlled` suffix, schema projection становится `pending` с кодом `schema_migration_pending`.
8. Controlled migration не применяется startup-кодом.
9. После полного применения доступного registry проверяется canonical structural inventory.
10. Lock освобождается только owner-ом; потеря ownership работает fail-closed.

Обычный API не должен работать как будто schema полностью ready, если outer boundary вернул blocking schema state.

## Automatic migrations

Automatic migration допустима только когда её можно безопасно применять без отдельной операторской транзакции/maintenance decision.

Canonical automatic migrations не должны использовать lifecycle как скрытый способ выполнять произвольный destructive SQL из request path. Runtime source contracts отдельно контролируют отсутствие schema-changing DDL в domain handlers.

Baseline/adoption может использовать idempotent table phase, после чего обязательные columns/constraints/indexes/triggers проверяются до final journal commit.

## Controlled migrations

Controlled migration применяется только explicit admin/storage workflow после безопасного preflight и maintenance checks.

Основные endpoints текущего controlled apply contract:

```text
POST /api/admin/storage/migrations/preflight
POST /api/admin/storage/migrations/apply
GET  /api/admin/storage/migrations/apply/status
POST /api/admin/storage/migrations/apply/reconcile
```

`preflight` — read-only. Он проверяет schema/journal/integrity, актуальный full encrypted backup и migration lock. Он не применяет DDL/DML и не создаёт maintenance bypass.

Apply contract требует привязку к текущей maintenance operation:

```text
maintenanceOperationId
controllerSecret
confirmation
```

Перед mutating phase runtime повторно проверяет safety conditions под owner-scoped lock. Успешный старый preflight сам по себе не является разрешением на применение migration позже.

Controlled apply не предоставляет arbitrary SQL, target selection, force/bypass flags или возможность пропустить версию registry.

## Crash recovery и reconciliation

Обычная migration должна оставлять journal и schema в согласованном состоянии согласно её transaction contract.

Controlled apply дополнительно сохраняет bounded migration operation state. После ambiguous/crash state оператор использует status/reconcile contract, а не повторяет DDL вручную.

Reconcile разрешён только для известной operation/registry state и не является общим repair endpoint.

## Adoption существующей базы

Для существующей compatible базы baseline использует idempotent creation и затем проверяет фактическую структуру.

- существующие business rows не переписываются ради adoption;
- missing allowed schema objects могут быть созданы canonical migration;
- несовместимый existing column/constraint/trigger не исправляется молча;
- journal version записывается только после успешной соответствующей migration phase.

Adoption не является data restore и не расшифровывает application secrets.

## Drift

### Incompatible drift

Примеры blocking drift:

- отсутствующая обязательная таблица/колонка;
- несовпадение type/NOT NULL/primary-key semantics;
- потерянный required UNIQUE;
- неправильный required index;
- required trigger с неправильной semantics;
- дополнительный trigger на canonical table, способный влиять на writes;
- restrictive extra CHECK/FOREIGN KEY/REFERENCES;
- неизвестная future migration;
- journal gap/order mismatch;
- checksum mismatch.

### Compatible drift

Может быть report-only:

- дополнительная application table;
- безопасный nullable/defaulted extra column;
- дополнительный index;
- дополнительный trigger только на non-canonical extra table.

Runtime не удаляет compatible extra objects автоматически.

## Состояния и ключевые коды

В зависимости от boundary/contract могут встречаться:

| State/code | Значение |
| --- | --- |
| `ready` | применённый prefix и canonical schema допустимы |
| `pending` / `schema_migration_pending` | automatic migrations завершены, остаётся controlled suffix |
| `schema_migration_busy` | lock занят/ownership потерян |
| `schema_database_unavailable` | обязательная DB binding недоступна |
| `schema_incompatible_drift` | structural drift блокирует нормальную работу |
| `schema_migration_failed` | migration/inspection не завершилась безопасно |
| `schema_checksum_mismatch` | immutable applied migration не совпадает с journal checksum |
| `schema_future_version` | database содержит migration, неизвестную текущему release |
| `schema_journal_gap` | applied versions не являются ordered prefix |
| `migration_registry_invalid` | registry нарушает version/mode/snapshot invariants |

Конкретный public contract endpoint может нормализовать внутреннее состояние в свой bounded response code; наружу не должны утекать SQL/raw D1 exceptions/secrets.

## Recovery status

Service-admin schema status:

```text
GET /api/schema/status
x-admin-token: <ADMIN_TOKEN>
```

Endpoint возвращает sanitized schema/version/pending/drift/error metadata и не возвращает SQL, checksums, credentials, cookies или encryption material.

Локальный административный diagnostics path может отображать ту же bounded информацию через локальную session boundary.

## Migration preflight

Read-only preflight:

```text
POST /api/admin/storage/migrations/preflight
```

Contract version `1` возвращает bounded состояние:

- pending migration count;
- schema state/version;
- journal validity;
- integrity result;
- full encrypted backup readiness/age;
- lock availability.

Decision `allow` означает только, что проверенные условия preflight выполнены на момент генерации report. Apply повторно валидирует safety под lock.

## Диагностика оператора

1. Сначала прочитайте `/api/schema/status` и storage migration preflight/status.
2. Не меняйте journal вручную.
3. При `schema_future_version` используйте release, который понимает эту DB version, либо утверждённый recovery path.
4. При checksum mismatch восстановите правильный immutable release/database state; не заменяйте checksum вручную.
5. При journal gap используйте tested recovery procedure/backup, а не ручной запуск пропущенной migration после более новой.
6. При incompatible drift создайте recovery point/копию данных и сравните состояние с canonical schema.
7. При controlled pending migration сначала выполните required backup + maintenance + preflight workflow.
8. При ambiguous apply state используйте apply status/reconcile, не запускайте произвольный SQL.

## Backup и rollback policy

Перед controlled/destructive migration обязателен поддерживаемый recovery path согласно конкретному migration contract. Текущий migration preflight проверяет наличие подходящего full encrypted backup, а destructive file-level recovery описан отдельно в [`OFFLINE_FULL_RESTORE.md`](OFFLINE_FULL_RESTORE.md).

Forward-only migration registry не обещает автоматический downgrade schema при откате application image. Перед rollback release оператор обязан проверить, поддерживает ли предыдущий release текущую schema version.

## Test-only boundary

Production schema readiness нельзя отключить обычной environment variable. Tests, которые намеренно запускают Worker без D1, используют explicit in-process test boundary; это не является production configuration feature.

## Автоматическая проверка

Test suite покрывает, в частности:

- empty DB/adoption;
- immutable migration checksums;
- ordered upgrades и journal gaps;
- repeated/concurrent startup;
- lock ownership/stale lock;
- incompatible/compatible drift;
- отсутствие runtime DDL ownership вне canonical migration modules;
- automatic/controlled migration mode invariants;
- v4 foundation migration;
- pending controlled projection;
- read-only preflight;
- maintenance-gated apply/status/reconcile;
- under-lock safety revalidation;
- sanitized public contracts.

Не фиксируйте в этом документе долгоживущее точное количество tests: оно меняется вместе с repository suite.
