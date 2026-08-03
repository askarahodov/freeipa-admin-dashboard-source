# Persistent maintenance mode

## Назначение

Persistent maintenance mode — внешний safety boundary портала перед service-admin authorization и обычным Worker API. Он нужен для будущих offline/destructive recovery операций, которым требуется гарантированно остановить пользовательские запросы и scheduled-задачи до изменения файлов базы.

Этот этап создаёт только устойчивый режим обслуживания и его state machine. Он не выполняет destructive full restore, не расшифровывает backup и не заменяет SQLite-файл.

## Доступ и permission

Управление доступно только роли `admin` с permission `maintenance.manage`. Все изменяющие запросы требуют same-origin. `ADMIN_TOKEN` не обходит maintenance gate: обычные service-admin endpoint блокируются так же, как пользовательский API.

Публичный безопасный статус:

```text
GET /api/maintenance/status
```

Административные endpoint:

```text
GET  /api/admin/maintenance/status
POST /api/admin/maintenance/prepare
POST /api/admin/maintenance/enter
POST /api/admin/maintenance/verification/start
POST /api/admin/maintenance/exit
POST /api/admin/maintenance/complete
POST /api/admin/maintenance/cancel
```

Все ответы control API используют `cache-control: no-store`. Публичная и административная проекции не содержат actor identity, групп, controller secret или его hash.

## Состояния

| Состояние | Значение |
|---|---|
| `inactive` | портал работает обычно |
| `entering` | операция подготовлена, ожидается точное подтверждение входа |
| `active` | обычный API и scheduled-задачи заблокированы |
| `verifying` | выполняется внешняя проверка восстановленного состояния |
| `exiting` | проверки приняты, ожидается точное подтверждение завершения |
| `failed` | состояние нельзя считать безопасным; gate остаётся fail-closed |

Состояние хранится в singleton-строке `portal_maintenance_state` и сохраняется после перезапуска Worker или контейнера. Отсутствующая строка трактуется как `inactive`; повреждённая строка или ошибка чтения переводит внешний gate в безопасное fail-closed поведение.

## Controller secret

`prepare` создаёт одноразовый 32-байтный base64url `controllerSecret`. Он возвращается клиенту только один раз. Сервер хранит только SHA-256 hash и сравнивает секрет фиксированным byte loop.

`controllerSecret` не восстанавливается сервером. Его нельзя получить из status API, audit или базы в исходном виде. Потеря секрета требует следовать recovery-процедуре следующего offline этапа, а не отключать gate вручную.

## Порядок штатной операции

### 1. Проверить текущий статус

```text
GET /api/admin/maintenance/status
```

Продолжать можно только из `inactive`.

### 2. Подготовить операцию

```text
POST /api/admin/maintenance/prepare
```

Сохраните полученные `operationId`, `controllerSecret` и confirmation challenge в защищённом оперативном контексте. Не помещайте их в логи, tickets или постоянное хранилище.

### 3. Войти в maintenance

```text
POST /api/admin/maintenance/enter
```

Запрос передаёт `operationId`, `controllerSecret` и точное confirmation значение. Guarded D1 batch переводит состояние в `active` и отзывает все активные сессии портала. После этого операторы и администраторы должны будут войти заново после штатного выхода.

### 4. Выполнить внешнюю recovery-операцию

В PR #71 такой операции нет. Будущий offline workflow будет отвечать за full recovery point, остановку процесса, проверку SQLite и атомарную замену файла.

### 5. Начать verification

```text
POST /api/admin/maintenance/verification/start
```

Переход фиксирует начало проверок. Пока состояние не вернулось в `inactive`, обычные API остаются закрыты.

### 6. Передать агрегированные проверки

```text
POST /api/admin/maintenance/exit
```

Принимается только точный bounded verification object: integrity, schema, administrator access, settings decryption и audit write. Raw SQL, строки таблиц, секреты и exception bodies не принимаются и не записываются в audit.

### 7. Завершить операцию

```text
POST /api/admin/maintenance/complete
```

После точного confirmation состояние возвращается в `inactive`; operation credentials и actor metadata очищаются.

### Отмена до входа

```text
POST /api/admin/maintenance/cancel
```

Отмена разрешена только для действующей операции в `entering`. Уже активный или failed maintenance нельзя снять этим endpoint.

## Поведение gate

В состояниях `entering`, `active`, `verifying`, `exiting` и `failed`:

- обычный `/api/*` получает безопасный `503` и `Retry-After: 60`;
- `ADMIN_TOKEN` не создаёт обход;
- scheduled-задачи не запускаются;
- static assets и страницы остаются доступны;
- `/api/maintenance/status` остаётся доступен публично;
- `/api/integrations/health` остаётся доступен и получает `x-portal-maintenance-state`;
- `/api/schema/status` и административные maintenance controls остаются доступны для recovery.

Ошибка чтения maintenance state блокирует обычный API и scheduled-задачи fail-closed. Она не раскрывает D1 exception или внутреннюю строку состояния.

## Аудит и секреты

Audit содержит только разрешённые агрегаты: transition, state, duration, verification outcomes и normalized error code. В audit, ответах и логах запрещены:

- `controllerSecret` и его hash;
- actor groups и внутренний token material;
- backup password;
- backup plaintext/ciphertext;
- current-state fingerprints;
- SQL и raw D1 errors.

## Что не входит в этот этап

PR #71:

- не выполняет destructive full restore;
- не заменяет SQLite-файл;
- не ищет Wrangler/D1 файлы на volume;
- не выполняет filesystem rename/fsync;
- не создаёт offline CLI;
- не читает `CONFIG_ENCRYPTION_KEY`;
- не расшифровывает backup;
- не создаёт автоматический выход из maintenance.

Следующий изолированный этап issue #37 должен реализовать mandatory full recovery point, offline file-level restore, SQLite integrity/schema smoke и процедуру возврата из failed maintenance.
