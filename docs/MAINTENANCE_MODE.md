# Persistent maintenance mode

## Назначение

Persistent maintenance mode — внешний safety boundary портала перед service-admin authorization и обычным Worker API. Он гарантирует остановку пользовательских запросов и scheduled-задач во время selective restore и destructive offline full restore.

Состояние хранится в `portal_maintenance_state`, сохраняется после перезапуска и работает fail-closed при повреждении или недоступности строки.

Полная file-level процедура: [OFFLINE_FULL_RESTORE.md](OFFLINE_FULL_RESTORE.md).

## Доступ и endpoints

Управление доступно только роли `admin` с permission `maintenance.manage`. Mutations требуют same-origin. В local identity mode service-admin запрос дополнительно требует корректный `x-admin-token`; сам `ADMIN_TOKEN` не отключает внешний gate.

```text
GET  /api/maintenance/status
GET  /api/admin/maintenance/status
POST /api/admin/maintenance/prepare
POST /api/admin/maintenance/enter
POST /api/admin/maintenance/verification/smoke
POST /api/admin/maintenance/verification/start
POST /api/admin/maintenance/exit
POST /api/admin/maintenance/complete
POST /api/admin/maintenance/cancel
```

Все ответы используют `cache-control: no-store`. Публичная и административная проекции не возвращают actor groups, controller secret или его hash.

`verification/smoke` доступен только через внутренний trusted service-admin marker, который создаётся после проверки `x-admin-token` и не принимается из HTTP-заголовка клиента.

## Состояния

| Состояние | Значение |
|---|---|
| `inactive` | портал работает обычно |
| `entering` | операция подготовлена, ожидается exact confirmation |
| `active` | обычный API и scheduled-задачи заблокированы |
| `verifying` | выполняется bounded проверка восстановленного состояния |
| `exiting` | проверки приняты, ожидается completion confirmation |
| `failed` | состояние нельзя считать безопасным; gate остаётся закрытым |

Отсутствующая singleton-строка трактуется как `inactive` только при корректной schema. Повреждённая строка или ошибка чтения дают fail-closed response.

## Controller secret

`prepare` создаёт одноразовый 32-byte base64url `controllerSecret` и возвращает его один раз. Сервер хранит только SHA-256 hash и сравнивает значения фиксированным byte loop.

Потерянный secret нельзя получить из status, audit или DB в исходном виде. Для доказанного случая потери используется offline failed maintenance recovery из runbook, а не ручное изменение таблицы.

## Штатная последовательность

1. `GET /api/admin/maintenance/status` — продолжать только из `inactive`.
2. `POST /api/admin/maintenance/prepare` — сохранить `operationId`, `controllerSecret` и challenge.
3. `POST /api/admin/maintenance/enter` — exact `ENTER:<operationId>`; guarded batch переводит state в `active` и отзывает локальные sessions.
4. Остановить `dashboard` и выполнить offline `preflight`, `backup-current`, `restore` по [OFFLINE_FULL_RESTORE.md](OFFLINE_FULL_RESTORE.md).
5. Запустить `dashboard`.
6. Recovery CLI вызывает `verification/smoke`, затем `verification/start`, `exit` и `complete`.
7. Только успешный online verifier возвращает state в `inactive`; startup и таймер этого не делают.

### Verification smoke

Bounded smoke выполняет:

- проверку matching operation/controller;
- read-only проверку password активного локального администратора без создания `portal_sessions` и без изменения lockout counters;
- расшифровку active settings действующим `CONFIG_ENCRYPTION_KEY`;
- append/readback aggregate audit event;
- подтверждение нулевого числа старых sessions.

Ответ содержит только `operationId` и агрегированные `ok` checks. Username, hashes, settings, audit row, SQL и exception bodies не возвращаются.

### Exit verification object

`POST /api/admin/maintenance/exit` принимает только bounded checks:

- `integrity`;
- `schema`;
- `administratorAccess`;
- `settingsDecryption`;
- `auditWrite`.

Raw SQL, строки таблиц, credentials, ciphertext и произвольные поля отклоняются.

### Cancel

`POST /api/admin/maintenance/cancel` разрешён только в `entering`. После перехода в `active` используется штатный verify/complete либо offline recovery.

## Gate behaviour

В `entering`, `active`, `verifying`, `exiting` и `failed`:

- обычный `/api/*` получает безопасный `503` и `Retry-After: 60`;
- scheduled-задачи не запускаются;
- static assets и страницы остаются доступны;
- `/api/maintenance/status`, health и schema status доступны;
- bounded maintenance controls и verification smoke доступны recovery workflow;
- `ADMIN_TOKEN` не создаёт общего обхода.

Ошибка чтения state не раскрывает D1 exception и блокирует обычный API fail-closed.

## Offline destructive restore

Recovery profile:

```bash
docker compose --profile recovery run --rm recovery <command> ...
```

Поддерживаемые команды:

```text
preflight
backup-current
restore
status
verify
rollback
maintenance-recover
```

Mutating offline commands используют общий kernel `flock`. Candidate строится из остановленной текущей DB, сохраняет migration journal и maintenance operation, не восстанавливает historical sessions и проходит integrity/schema/admin/encryption/audit checks до atomic swap.

Mandatory raw-SQLite recovery point хранится вне live volume path и шифруется отдельным password. Receipt связывает live hash/path, backup manifest, maintenance operation, recovery point, candidate и rollback paths.

## Offline failed maintenance recovery

`maintenance-recover` разрешён только при остановленном runtime, валидном receipt/recovery point, корректной integrity/schema, действующем admin password/config key и exact confirmation:

```text
RECOVER FAILED MAINTENANCE <operationId>
```

Maintenance reset, session purge и audit event выполняются одной SQLite transaction. Команда не обходит повреждённую DB и не заменяет rollback.

## Аудит и секреты

Audit содержит только transition, state, duration, aggregate verification outcomes и normalized error codes. Запрещены:

- `controllerSecret` и его hash;
- password, `ADMIN_TOKEN` и `CONFIG_ENCRYPTION_KEY`;
- backup plaintext/ciphertext;
- recovery-point password;
- raw fingerprints в HTTP output;
- SQL и raw D1/SQLite errors.

Secret values передаются recovery CLI только через mode-`0600` files. Bypass flags, interactive prompts и environment fallback для recovery secrets не поддерживаются.

## Эксплуатационные запреты

- не удалять `portal_maintenance_state` вручную;
- не копировать live SQLite вместе с `-wal`/`-shm`;
- не выбирать DB по имени или времени изменения;
- не переносить candidate на другой filesystem перед swap;
- не редактировать receipt;
- не удалять retained original/recovery point до успешного `verified` или подтверждённого rollback;
- не ожидать автоматического выхода из maintenance после restart.
