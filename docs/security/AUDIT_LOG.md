# Расширенный аудит портала

Расширенный аудит формирует неизменяемую серверную историю административных действий.
Журнал хранится в D1 и связывает approval-заявки, решения, запуск XYOps, Job ID,
изменения статуса, FreeIPA-операции и административные настройки через единый
`correlation_id`.

## Основные гарантии

- Correlation ID создаётся сервером. Клиентский HTTP-заголовок не используется.
- Внутренние вызовы портала получают correlation-контекст напрямую, а не через
  доверие к входящим заголовкам.
- Для последующих запросов correlation ID восстанавливается по `approval_id` или
  `run_id` из уже сохранённой audit-цепочки.
- Таблица `portal_audit_events` доступна приложению только для INSERT и SELECT.
- SQLite-триггеры запрещают UPDATE и DELETE записей.
- Audit API не имеет POST, PUT, PATCH или DELETE операций.

## Схема хранения

Таблица:

```text
portal_audit_events
```

Основные поля:

```text
id
created_at
correlation_id
actor_identity
actor_role
actor_groups_json
action
resource_type
resource_id
event_id
schema_version
approval_id
run_id
job_id
outcome
error_code
metadata_json
```

`outcome` принимает значения:

```text
success
failure
pending
denied
unknown
info
```

## Correlation-цепочка

Опасная операция формирует одну логическую цепочку:

```text
cor_xxx
  ├── approval.requested
  ├── approval.approve
  ├── approval.execute
  ├── xyops.run
  └── xyops.run.status_changed
```

Approve и execute могут выполняться отдельными HTTP-запросами и разными
пользователями. Сервер находит исходный correlation ID по `approval_id`. Изменения
статуса Job восстанавливают его по `run_id`.

Safe re-run получает новый correlation ID, потому что является новой операцией.
Если процесс опасный, внутри новой цепочки создаётся новая approval-заявка.

## Записываемые действия

### XYOps

- `approval.requested`;
- `approval.approve`;
- `approval.reject`;
- `approval.cancel`;
- `approval.execute`;
- `xyops.run`;
- `xyops.run.cancel`;
- `xyops.run.rerun_requested`;
- `xyops.run.status_changed`.

### FreeIPA

Используется формат:

```text
freeipa.<operation>
```

Например:

```text
freeipa.user_add
freeipa.user_password
freeipa.user_disable
freeipa.group_add_member
```

### Администрирование портала

- `settings.updated`;
- `settings.connection_test`;
- `routes.updated`;
- `catalog.policy.updated`;
- `approval.policy.updated`;
- `catalog.sync`.

## Защита секретов

Audit metadata проходит централизованную очистку. Ключи с названиями, похожими на
следующие, полностью удаляются:

```text
password
secret
token
apiKey
authorization
cookie
credential
privateKey
session
encrypted
cipher
```

В аудит не попадают:

- значения password-полей;
- `XYOPS_API_KEY`;
- `ADMIN_TOKEN`;
- FreeIPA-пароль;
- cookies и authorization headers;
- зашифрованные payload;
- полный request body;
- сырые ответы XYOps и FreeIPA.

В metadata сохраняются только безопасные сведения: список ключей полей, targets,
режим, тип процесса, количество правил, HTTP-статус и другие ограниченные
технические признаки.

## API

Доступ разрешён пользователям с `settings.manage`.

```text
GET /api/integrations/audit
```

Поддерживаемые параметры:

```text
limit
actor
action
outcome
eventId
approvalId
runId
correlationId
dateFrom
dateTo
```

Пример:

```text
GET /api/integrations/audit?action=approval.approve&outcome=success&limit=100
```

`dateFrom` и `dateTo` передаются в Unix milliseconds.

## Интерфейс

В административной навигации появляется раздел **«Аудит»**. Он показывает:

- время;
- identity и роль;
- действие и outcome;
- correlation ID;
- Event ID и schemaVersion;
- approval ID;
- run ID и Job ID;
- санитизированные технические metadata.

Раздел скрыт от viewer и operator.

## Развёртывание

Для persistent audit требуется D1 или совместимое SQLite-хранилище. Отдельный ключ
шифрования для audit metadata не нужен, потому что секретные значения в таблицу
не допускаются. При этом approval/replay/settings по-прежнему требуют корректный
`CONFIG_ENCRYPTION_KEY`.

Рекомендуется:

- включить резервное копирование D1;
- ограничить доступ к `/audit` администраторами;
- не добавлять административные SQL endpoints для audit-таблицы;
- контролировать рост таблицы внешней retention-политикой только после
  юридического и эксплуатационного согласования;
- не удалять audit-записи из кода портала.

## Проверки

Тесты подтверждают:

- correlation ID создаётся сервером и не берётся из клиентского заголовка;
- audit API недоступен operator;
- audit API не предоставляет операции записи и удаления;
- approval request, approve, execute и XYOps run используют одну correlation-цепочку;
- пароли, API keys и другие секреты отсутствуют в audit JSON;
- FreeIPA-операция сохраняет identity, роль, run ID и безопасные metadata.
