# Storage Integrity Diagnostics

`POST /api/admin/storage/integrity/check` выполняет явную bounded read-only проверку локального D1/SQLite-хранилища. Endpoint предназначен для администратора и service-admin диагностики, когда UI недоступен или canonical schema/maintenance gate блокирует обычный API.

Проверка **не исправляет** базу, не применяет migrations и не должна использоваться как liveness, readiness, Docker HEALTHCHECK или автоматический restart signal.

## Что проверяется

Один запрос запускает не более двух фиксированных SQL statements:

1. `PRAGMA quick_check(1)`;
2. один inventory query по `sqlite_schema` для явно созданных индексов.

Index inventory сравнивается только с compile-time реестром `portalSchemaIndexes` из `db/portal-schema.ts`. Request body, query parameters и headers не могут задавать SQL, pragma, table/index names или фильтры.

Endpoint не выполняет:

- DDL или DML;
- migration apply или lock acquisition;
- `REINDEX`, `VACUUM`, `ANALYZE`, `PRAGMA optimize`;
- integrity repair;
- cleanup;
- backup/restore commit;
- arbitrary SQL.

## Авторизация

### Локальный режим

Пользователь должен иметь роль `admin`. Запрос проходит существующую local session boundary и same-origin mutation check до обращения к D1.

Viewer и operator получают `403` до запуска integrity evaluator.

### Service-admin

Для восстановления без браузерной сессии используется только exact endpoint с заголовком:

```text
x-admin-token: <ADMIN_TOKEN>
```

Token сравнивается существующей constant-time проверкой. Наличие recovery allowlist не обходит authentication или role enforcement.

## HTTP contract

```text
POST /api/admin/storage/integrity/check
Content-Type: application/json
Cache-Control: no-store
```

Успешно выполненная диагностика возвращает versioned contract `1`:

```json
{
  "contractVersion": "1",
  "generatedAt": 1754400000000,
  "durationMs": 42,
  "state": "healthy",
  "quickCheck": {
    "state": "healthy",
    "code": "storage_quick_check_ok"
  },
  "indexes": {
    "expected": 19,
    "present": 19,
    "missing": 0,
    "mismatched": 0,
    "unexpected": 0,
    "code": "storage_indexes_ready"
  },
  "correlationId": "cor_..."
}
```

HTTP status:

| Status | Значение |
|---|---|
| `200` | проверка выполнена; `state` равен `healthy` или `degraded` |
| `401` | отсутствует допустимая local session или service-admin token |
| `403` | роль недостаточна или local same-origin policy отклонила mutation |
| `405` | метод не `POST`; response содержит `Allow: POST` |
| `503` | D1 или bounded evaluation недоступны; `state` равен `unavailable` |

## Состояния quick check

| State | Code | Значение |
|---|---|---|
| `healthy` | `storage_quick_check_ok` | SQLite вернул единственный нормализованный результат `ok` |
| `failed` | `storage_quick_check_failed` | quick check завершён, но результат не `ok` |
| `unsupported` | `storage_quick_check_unsupported` | runtime не поддерживает pragma |
| `unavailable` | `storage_quick_check_unavailable` | проверку выполнить невозможно |

Raw quick-check text наружу не возвращается.

## Состояния индексов

| Code | Значение |
|---|---|
| `storage_indexes_ready` | все canonical indexes присутствуют и definitions совместимы; portal-owned extras отсутствуют |
| `storage_indexes_degraded` | есть missing, mismatched или unexpected portal-owned indexes |
| `storage_indexes_unavailable` | inventory query выполнить невозможно |

Ответ содержит только bounded counts. Он не содержит index/table names, SQL definitions или database paths.

## Общий state

- `healthy`: quick check healthy и indexes ready;
- `degraded`: evaluation завершена, но quick check failed/unsupported либо indexes degraded;
- `unavailable`: quick check или index inventory недоступны.

`degraded` сам по себе не является командой на restart или repair. Сначала сопоставьте correlation ID с bounded audit и проверьте текущий schema status/storage status.

## CLI

CLI использует тот же HTTP contract, а не отдельный доступ к файлу базы:

```bash
PORTAL_URL=https://portal.example \
ADMIN_TOKEN='read-from-a-secret-provider' \
npm run inspect:storage-integrity
```

Опциональный timeout:

```bash
PORTAL_URL=https://portal.example \
ADMIN_TOKEN='read-from-a-secret-provider' \
npm run inspect:storage-integrity -- --timeout-ms 10000
```

Ограничения CLI:

- `PORTAL_URL` должен быть только HTTP(S) origin без credentials, path, query или fragment;
- `ADMIN_TOKEN` принимается только из environment;
- token/header/password/cookie/auth arguments запрещены;
- timeout ограничен диапазоном `500..30000` ms;
- redirects запрещены;
- печатается только полностью валидированный contract;
- raw response body, redirect location, URL, token и exception message не печатаются.

Exit codes:

| Code | Значение |
|---|---|
| `0` | валидный `healthy` или `degraded` report |
| `2` | валидный `unavailable` report или server failure |
| `3` | authentication/authorization failure |
| `4` | timeout или network failure |
| `5` | invalid arguments/URL, redirect, protocol, content type или response contract |

## Audit

Авторизованная проверка best-effort записывает action:

```text
storage.integrity.check
```

В metadata сохраняются только:

- overall state;
- bounded duration;
- fixed quick-check/index codes;
- expected/present/missing/mismatched/unexpected counts.

Audit не содержит quick-check output, SQL, object names, rows, token или raw errors. Ошибка записи audit не заменяет диагностический response.

## Нагрузка и конкурентность

- одна проверка выполняет не более одного quick check и одного index inventory query;
- overlapping requests в одном Worker process используют одну in-flight evaluation;
- завершённый report не кэшируется;
- public/audit duration ограничен `60000` ms;
- каждый count ограничен `10000`.

## Recovery и rollback

Endpoint доступен через schema и maintenance recovery gates, но остаётся внутри admin authorization boundary.

Этот checkpoint не создаёт schema objects и не изменяет application data, кроме существующей append-only audit записи. Rollback состоит в удалении route/service/CLI/tests/docs; database rollback не требуется.
