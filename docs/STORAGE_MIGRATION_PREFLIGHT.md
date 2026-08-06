# Storage Migration Preflight

`POST /api/admin/storage/migrations/preflight` выполняет явную bounded read-only проверку готовности локального D1/SQLite-хранилища к будущему controlled migration apply.

Checkpoint **не применяет migrations**, не захватывает migration lock, не изменяет schema/data и не включает maintenance mode. Результат предназначен только для решения оператора: можно ли переходить к отдельной процедуре controlled apply или необходимо сначала устранить блокирующее условие.

## Что проверяется

Проверки выполняются в fail-closed порядке:

1. migration journal является точным ordered prefix compile-time registry;
2. `name` и `checksum` каждой применённой migration совпадают с registry;
3. schema соответствует snapshot применённого prefix;
4. объекты следующей migration отсутствуют полностью, а не созданы частично;
5. один фиксированный `PRAGMA quick_check(1)` завершён успешно;
6. существует свежий успешный полный encrypted backup текущей применённой версии schema;
7. migration lock свободен либо stale по фиксированному TTL.

При отсутствии pending migrations expensive checks не выполняются: ответ имеет состояние `not_required`.

## Read-only boundary

Endpoint не выполняет:

- `INSERT`, `UPDATE`, `DELETE` или `REPLACE`;
- `CREATE`, `ALTER`, `DROP`;
- migration apply или journal write;
- lock acquisition, renewal, release или stale-lock deletion;
- `REINDEX`, `VACUUM`, `ANALYZE`, `PRAGMA optimize`;
- repair/cleanup/restore commit;
- maintenance transition;
- arbitrary SQL или request-controlled identifiers.

Используются только compile-time migration registry/snapshots и фиксированные bounded queries.

## Авторизация

### Локальный режим

Требуется локальная session с ролью `admin`. Поскольку endpoint использует `POST`, существующая same-origin mutation policy выполняется до body parsing и обращения к D1.

Viewer и operator получают `403` до чтения body, создания audit context или запуска evaluator.

### Service-admin

Для browser-independent проверки используется exact endpoint и заголовок:

```text
x-admin-token: <ADMIN_TOKEN>
```

Token проверяется существующим constant-time boundary. Recovery allowlist позволяет вызвать endpoint при schema/maintenance проблемах, но не обходит authentication/RBAC.

## Request contract

```text
POST /api/admin/storage/migrations/preflight
Content-Type: application/json
Cache-Control: no-store

{}
```

Body должен быть ровно пустым JSON object и не превышать `1024` bytes. Target version, migration ID, SQL, table names, force/bypass flags и filters не принимаются.

## Response contract

Contract version: `1`.

```json
{
  "contractVersion": "1",
  "generatedAt": 1754400000000,
  "durationMs": 42,
  "state": "ready",
  "decision": "allow",
  "code": "migration_preflight_ready",
  "pendingMigrationCount": 1,
  "schema": {
    "state": "ready",
    "currentVersion": 3,
    "latestVersion": 4,
    "code": "migration_schema_ready"
  },
  "journal": {
    "state": "valid",
    "appliedCount": 3,
    "pendingCount": 1,
    "code": "migration_journal_valid"
  },
  "integrity": {
    "state": "healthy",
    "code": "migration_quick_check_ok"
  },
  "backup": {
    "state": "ready",
    "ageMs": 60000,
    "maxAgeMs": 86400000,
    "code": "migration_backup_ready"
  },
  "lock": {
    "state": "available",
    "blocking": false,
    "ageMs": null,
    "ttlMs": 60000,
    "code": "migration_lock_available"
  },
  "correlationId": "cor_..."
}
```

Ответ содержит только fixed states/codes, bounded counts, versions, ages и duration. Он не содержит migration SQL, checksums, object/table/index names, backup payload, actor/lock owner, database path или raw exception text.

## HTTP status

| Status | Значение |
|---|---|
| `200` | evaluation завершена: `ready`, `not_required` или operational `blocked` |
| `400` | body не является ровно `{}` |
| `401` | отсутствует допустимая local session или service-admin token |
| `403` | роль недостаточна либо local same-origin policy отклонила запрос |
| `405` | метод не `POST`; response содержит `Allow: POST` |
| `413` | body больше `1024` bytes |
| `503` | D1/evaluator недоступен; возвращён полный `unavailable` contract |

Operational block не является transport failure, поэтому возвращается через HTTP `200` и явно выражается `state=blocked`, `decision=deny`.

## Overall states

| State | Decision | Значение |
|---|---|---|
| `ready` | `allow` | есть pending migration и все safety checks разрешают будущий controlled apply |
| `not_required` | `deny` | pending migrations отсутствуют; apply не требуется |
| `blocked` | `deny` | evaluation выполнена, но обнаружено конкретное безопасно классифицированное препятствие |
| `unavailable` | `deny` | evaluation выполнить полностью невозможно |

Overall `code` выбирается в фактическом fail-closed порядке: journal → schema → integrity → backup → lock. Для unexpected handler failure используется `migration_preflight_unavailable`; отсутствие D1 классифицируется как `migration_preflight_database_unavailable`.

## Schema и journal codes

| Code | Значение |
|---|---|
| `migration_schema_ready` | applied prefix соответствует deterministic snapshot |
| `migration_schema_incompatible` | applied schema не соответствует canonical snapshot |
| `migration_registry_snapshot_required` | pending migration не имеет deterministic snapshot/preflight eligibility |
| `migration_schema_partial_apply` | обнаружен хотя бы один объект pending migration до journal commit |
| `migration_schema_unavailable` | schema inspection недоступна |
| `migration_journal_valid` | journal — точный ordered registry prefix |
| `migration_journal_malformed` | journal row имеет небезопасную/неполную форму |
| `migration_journal_duplicate` | обнаружена повторная version |
| `migration_journal_future_version` | journal содержит version вне compile-time registry |
| `migration_journal_gap` | journal не является непрерывным ordered prefix |
| `migration_journal_checksum_mismatch` | name/checksum не совпадает с immutable registry |
| `migration_journal_unavailable` | journal query недоступен |

При journal/schema block последующие integrity/backup/lock checks не выполняются и остаются в явном sanitized состоянии `unavailable`.

## Integrity codes

| Code | Значение |
|---|---|
| `migration_quick_check_ok` | fixed quick check вернул normalized `ok` |
| `migration_quick_check_failed` | quick check завершён с неуспешным sanitized result |
| `migration_quick_check_unsupported` | runtime не поддерживает pragma; apply блокируется |
| `migration_quick_check_not_required` | pending migrations отсутствуют |
| `migration_quick_check_unavailable` | quick check выполнить невозможно |

Raw quick-check output никогда не возвращается.

## Backup policy

Controlled apply разрешается только при наличии matching audit evidence успешного полного encrypted export:

- `action=backup.encrypted.export.completed`;
- `outcome=success`;
- `resource_type=portal-backup`;
- schema version равна текущей применённой migration version;
- `metadata_json.domains` точно соответствует canonical full backup domain set;
- возраст не больше `86400000` ms (24 часа).

| Code | Значение |
|---|---|
| `migration_backup_ready` | найден свежий полный encrypted backup |
| `migration_backup_missing` | matching backup отсутствует |
| `migration_backup_stale` | последний matching backup старше 24 часов |
| `migration_backup_incompatible` | audit metadata malformed либо относится к другой schema/domain selection |
| `migration_backup_not_required` | pending migrations отсутствуют |
| `migration_backup_unavailable` | bounded audit query недоступен |

Preflight читает только последние `20` matching successful audit rows и не читает backup payload.

## Lock policy

Lock inspection выполняет только fixed `SELECT acquired_at`. Owner наружу не читается и не возвращается.

| State | Blocking | Значение |
|---|---:|---|
| `available` | false | lock row отсутствует |
| `held` | true | lock моложе или равен TTL `60000` ms |
| `stale` | false | lock старше TTL; preflight только сообщает состояние и не удаляет row |
| `not_required` | false | pending migrations отсутствуют |
| `unavailable` | true | lock прочитать/классифицировать невозможно |

Stale lock сам по себе не блокирует read-only preflight, но будущий apply обязан использовать отдельную owner-scoped lock acquisition procedure.

## CLI

```bash
PORTAL_URL=https://portal.example \
ADMIN_TOKEN='read-from-a-secret-provider' \
npm run inspect:storage-migration-preflight
```

Timeout:

```bash
PORTAL_URL=https://portal.example \
ADMIN_TOKEN='read-from-a-secret-provider' \
npm run inspect:storage-migration-preflight -- --timeout-ms 10000
```

CLI:

- принимает `ADMIN_TOKEN` только из environment;
- запрещает token/header/password/cookie/auth arguments;
- принимает только HTTP(S) origin без credentials/path/query/fragment;
- ограничивает timeout диапазоном `500..30000` ms;
- выполняет exact `POST` с body `{}` и запрещает redirects;
- печатает только полностью валидированный contract;
- проверяет stage ordering и fail-closed remainder, а не только JSON shape;
- не печатает raw body, redirect location, target URL, token или exception message.

Exit codes:

| Code | Значение |
|---|---|
| `0` | валидный `ready` или `not_required` report |
| `2` | валидный `blocked`/`unavailable` report либо server failure |
| `3` | authentication/authorization failure |
| `4` | timeout или network failure |
| `5` | invalid arguments/URL, redirect, protocol/content type или response contract |

## Audit

Авторизованная проверка best-effort записывает:

```text
storage.migration.preflight
```

Audit metadata содержит только overall state/decision/code, bounded duration/pending count и fixed subcheck states/codes/counts/ages. Audit не содержит migration checksum/SQL/name, backup payload/domains, lock owner, actor identity, request body или raw errors.

Ошибка audit не заменяет preflight response.

## Нагрузка и конкурентность

- journal query ограничен `registry.length + 1` rows;
- backup query ограничен `20` rows;
- quick check выполняется не более одного раза;
- lock inspection выполняет один fixed select;
- overlapping requests в одном Worker process используют одну in-flight evaluation;
- завершённый report не кэшируется;
- public counts ограничены `10000`, duration — `60000` ms.

## Операторский runbook

1. Выполнить CLI и сохранить только sanitized JSON/correlation ID.
2. При `not_required` не запускать migration apply.
3. При `blocked` устранить первый blocking code:
   - journal/schema: остановить процедуру и проверить compatibility/registry;
   - integrity: не применять migration, перейти к incident diagnosis;
   - backup: создать новый полный encrypted backup и повторить preflight;
   - lock held/unavailable: не удалять lock вручную, проверить активный startup/apply process.
4. При `unavailable` не пытаться обходить endpoint force flags — их нет.
5. Перед будущим apply повторить preflight; report не является approval token и не кэшируется.

## Rollback

Этот checkpoint не создаёт schema objects и не изменяет application data, кроме существующей append-only audit записи. Rollback состоит в удалении route/service/CLI/tests/docs. Database rollback не требуется.

Controlled migration apply, lock acquisition, maintenance transition и UI Storage Center должны реализовываться отдельными checkpoint/PR.
