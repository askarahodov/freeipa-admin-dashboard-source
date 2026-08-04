# Offline destructive full restore

## Назначение

Эта процедура восстанавливает все canonical domains портала из полного зашифрованного логического backup и атомарно заменяет локальный SQLite-файл. Она предназначена для аварийного восстановления локального Docker Compose deployment.

Процедура не резервирует и не восстанавливает FreeIPA, XYOps, remote D1 или object storage. Она не является retention-системой и не выполняется из браузера.

## Критические гарантии

- dashboard должен быть переведён в persistent maintenance mode;
- контейнер dashboard должен быть остановлен до file-level операций;
- все изменяющие offline-команды получают kernel `flock` на общем volume;
- перед restore обязательно создаётся отдельный зашифрованный raw-SQLite recovery point;
- backup password и recovery-point password должны быть разными;
- historical `portal_sessions` не восстанавливаются;
- live SQLite не изменяется до полной проверки candidate database;
- swap выполняется только rename/fsync на одном filesystem;
- receipt определяет единственную допустимую операцию после сбоя;
- maintenance не выключается автоматически после restart или по таймеру;
- секреты принимаются только через обычные файлы с mode `0600` внутри `/run/portal-recovery-secrets`.

Не копируйте работающий SQLite вместе с `-wal`/`-shm`, не удаляйте `portal_maintenance_state` вручную и не используйте произвольный найденный `.sqlite` файл.

## Threat model

Recovery workflow защищает от:

- случайного запуска рядом с работающим dashboard;
- неоднозначного выбора SQLite-файла;
- повреждённого или несовместимого backup;
- неверного backup password или `CONFIG_ENCRYPTION_KEY`;
- восстановления без действующего администратора;
- частичного candidate write;
- падения между filesystem rename/fsync;
- повторного запуска команды после сбоя;
- утечки секретов в argv, receipt, audit и stdout.

Полный доступ root к хосту и изменение recovery artifacts самим root находятся вне threat model.

## Подготовка каталогов

На хосте из каталога проекта:

```bash
install -d -m 0700 recovery recovery-secrets
install -m 0600 /dev/null recovery-secrets/backup-password
install -m 0600 /dev/null recovery-secrets/recovery-password
install -m 0600 /dev/null recovery-secrets/controller-secret
install -m 0600 /dev/null recovery-secrets/admin-password
install -m 0600 /dev/null recovery-secrets/config-key
install -m 0600 /dev/null recovery-secrets/service-token
install -m 0600 /dev/null recovery-secrets/confirmation
```

Заполните файлы через защищённый secret manager или редактор. Не передавайте значения в параметрах команд и не сохраняйте их в shell history.

Назначение:

| Файл | Содержимое |
|---|---|
| `backup-password` | пароль полного логического backup |
| `recovery-password` | отдельный пароль обязательного raw-SQLite recovery point |
| `controller-secret` | одноразовый secret текущей maintenance operation |
| `admin-password` | пароль активного локального администратора |
| `config-key` | действующий `CONFIG_ENCRYPTION_KEY`, 64 hex или 32-byte base64 |
| `service-token` | серверный `ADMIN_TOKEN` для post-restart verification |
| `confirmation` | точное confirmation из receipt или emergency challenge |

Полный зашифрованный backup поместите в `recovery/full-backup.json` и ограничьте доступ к каталогу.

## 1. Вход в maintenance

Проверьте статус:

```bash
curl --fail-with-body --silent --show-error \
  -H "x-admin-token: ${ADMIN_TOKEN}" \
  http://127.0.0.1:3001/api/admin/maintenance/status
```

Продолжать можно только из `inactive`.

Подготовьте операцию authenticated admin-запросом:

```bash
curl --fail-with-body --silent --show-error \
  -X POST \
  -H "x-admin-token: ${ADMIN_TOKEN}" \
  -H "Origin: http://127.0.0.1:3001" \
  -H "Content-Type: application/json" \
  --data '{}' \
  http://127.0.0.1:3001/api/admin/maintenance/prepare
```

Сохраните `operationId` и `controllerSecret`. Запишите controller secret в `recovery-secrets/controller-secret`, затем выполните `/api/admin/maintenance/enter` с точным значением `ENTER:<operationId>`.

После успешного перехода проверьте, что status равен `active` и обычный API получает maintenance response.

## 2. Остановка dashboard

```bash
docker compose stop dashboard
docker compose ps
```

Не продолжайте, если dashboard всё ещё запущен. Recovery CLI дополнительно проверяет общий lock и откажется при конфликте.

## Общие пути CLI

В примерах используются:

```text
--data-root /portal-data
--artifact-root /recovery
--secrets-root /run/portal-recovery-secrets
--lock-path /portal-data/.portal-exclusive.lock
--backup /recovery/full-backup.json
--backup-password-file /run/portal-recovery-secrets/backup-password
--controller-secret-file /run/portal-recovery-secrets/controller-secret
--admin-username admin
--admin-password-file /run/portal-recovery-secrets/admin-password
--config-key-file /run/portal-recovery-secrets/config-key
```

Все flags команды обязательны. CLI отклоняет неизвестные и повторяющиеся flags, secret values в argv и bypass options.

## 3. Preflight

```bash
docker compose --profile recovery run --rm recovery preflight \
  --data-root /portal-data \
  --artifact-root /recovery \
  --secrets-root /run/portal-recovery-secrets \
  --lock-path /portal-data/.portal-exclusive.lock \
  --backup /recovery/full-backup.json \
  --backup-password-file /run/portal-recovery-secrets/backup-password \
  --controller-secret-file /run/portal-recovery-secrets/controller-secret \
  --admin-username admin \
  --admin-password-file /run/portal-recovery-secrets/admin-password \
  --config-key-file /run/portal-recovery-secrets/config-key
```

Preflight должен подтвердить единственную canonical database, schema readiness, active maintenance operation, controller binding, backup manifest/checksums, administrator credentials, encrypted settings/replay/approval material и свободное место.

## 4. Обязательный recovery point

```bash
docker compose --profile recovery run --rm recovery backup-current \
  --data-root /portal-data \
  --artifact-root /recovery \
  --secrets-root /run/portal-recovery-secrets \
  --lock-path /portal-data/.portal-exclusive.lock \
  --backup /recovery/full-backup.json \
  --backup-password-file /run/portal-recovery-secrets/backup-password \
  --controller-secret-file /run/portal-recovery-secrets/controller-secret \
  --admin-username admin \
  --admin-password-file /run/portal-recovery-secrets/admin-password \
  --config-key-file /run/portal-recovery-secrets/config-key \
  --recovery-password-file /run/portal-recovery-secrets/recovery-password \
  --recovery-point /recovery/current.sqlite.enc \
  --receipt /recovery/restore-receipt.json
```

Команда выполняет checkpoint, SQLite backup, integrity check, шифрование и повторную проверку recovery point. Она возвращает `confirmation`. Запишите это точное значение в `recovery-secrets/confirmation` без завершающего перевода строки, если он не является частью значения.

Receipt и recovery point нельзя редактировать, перемещать или заменять между командами.

## 5. Candidate и atomic swap

Candidate и rollback-файл должны находиться на том же filesystem, что и live database:

```bash
docker compose --profile recovery run --rm recovery restore \
  --data-root /portal-data \
  --artifact-root /recovery \
  --secrets-root /run/portal-recovery-secrets \
  --lock-path /portal-data/.portal-exclusive.lock \
  --backup /recovery/full-backup.json \
  --backup-password-file /run/portal-recovery-secrets/backup-password \
  --controller-secret-file /run/portal-recovery-secrets/controller-secret \
  --admin-username admin \
  --admin-password-file /run/portal-recovery-secrets/admin-password \
  --config-key-file /run/portal-recovery-secrets/config-key \
  --receipt /recovery/restore-receipt.json \
  --confirmation-file /run/portal-recovery-secrets/confirmation \
  --candidate /portal-data/portal-restore-candidate.sqlite \
  --rollback /portal-data/portal-restore-original.sqlite
```

Команда клонирует остановленную текущую DB, заменяет только canonical logical domains, сохраняет migration journal и maintenance operation, очищает sessions и проверяет candidate. Только после этих проверок выполняется atomic swap.

При повторном запуске используйте те же receipt/candidate/rollback paths. CLI reconciles receipt и filesystem state; не удаляйте файлы вручную.

## 6. Проверка receipt

```bash
docker compose --profile recovery run --rm recovery status \
  --receipt /recovery/restore-receipt.json
```

Ожидаемая фаза перед restart — `swapped`. Фазы `swap_started`, `failed`, `post_complete_failed` или неизвестное сочетание файлов требуют остановиться и выполнить documented reconciliation/rollback, а не запускать новый restore с другими путями.

## 7. Restart и online verification

```bash
docker compose up -d dashboard
docker compose ps
```

После health readiness выполните:

```bash
docker compose --profile recovery run --rm recovery verify \
  --receipt /recovery/restore-receipt.json \
  --secrets-root /run/portal-recovery-secrets \
  --controller-secret-file /run/portal-recovery-secrets/controller-secret \
  --admin-username admin \
  --admin-password-file /run/portal-recovery-secrets/admin-password \
  --service-token-file /run/portal-recovery-secrets/service-token \
  --base-url http://127.0.0.1:3001
```

Verification выполняет bounded health/schema/status/smoke, проверяет пароль администратора без создания persistent session, расшифровку settings, audit write/readback и отсутствие старых sessions. Затем она выполняет штатные maintenance transitions `verification/start`, `exit`, `complete`, реальный login/logout и финальные status/audit checks.

Только успешная команда `verify` возвращает портал в `inactive`.

## Rollback

При неуспешной post-swap проверке снова остановите dashboard:

```bash
docker compose stop dashboard
```

Используйте exact paths из receipt:

```bash
docker compose --profile recovery run --rm recovery rollback \
  --receipt /recovery/restore-receipt.json \
  --data-root /portal-data \
  --artifact-root /recovery \
  --secrets-root /run/portal-recovery-secrets \
  --lock-path /portal-data/.portal-exclusive.lock \
  --recovery-point /recovery/current.sqlite.enc \
  --recovery-password-file /run/portal-recovery-secrets/recovery-password \
  --live /portal-data/state/v3/d1/CANONICAL.sqlite \
  --rollback /portal-data/portal-restore-original.sqlite \
  --failed /portal-data/portal-restore-failed.sqlite \
  --recovery-temp /portal-data/portal-recovery-temp.sqlite
```

Замените `CANONICAL.sqlite` точным live relative path из receipt/status. Rollback сначала использует retained original; если он недоступен, проверяет и расшифровывает mandatory recovery point. После rollback запустите dashboard и повторно проверьте health, schema и admin access. Maintenance остаётся активным, пока оператор явно не завершит recovery.

## Failed maintenance recovery

Эта команда предназначена только для состояния `failed` или доказанной потери controller secret. Dashboard должен быть остановлен, receipt и recovery point должны оставаться валидными.

Запишите точную строку:

```text
RECOVER FAILED MAINTENANCE <operationId>
```

в `recovery-secrets/confirmation`, затем выполните:

```bash
docker compose --profile recovery run --rm recovery maintenance-recover \
  --receipt /recovery/restore-receipt.json \
  --data-root /portal-data \
  --artifact-root /recovery \
  --secrets-root /run/portal-recovery-secrets \
  --lock-path /portal-data/.portal-exclusive.lock \
  --admin-username admin \
  --admin-password-file /run/portal-recovery-secrets/admin-password \
  --config-key-file /run/portal-recovery-secrets/config-key \
  --confirmation-file /run/portal-recovery-secrets/confirmation
```

Команда повторно проверяет receipt/recovery point, integrity, schema, config encryption и administrator credentials. Maintenance reset, session purge и audit event выполняются одной offline SQLite transaction. Это не обход повреждённой DB и не заменяет rollback.

## Receipt phases

| Фаза | Действие оператора |
|---|---|
| `recovery_point_ready` | recovery point готов; разрешено строить candidate |
| `candidate_ready` | candidate проверен; разрешён swap с теми же путями |
| `swap_started` | повторить `restore` с теми же аргументами для reconciliation |
| `swapped` | запустить dashboard и выполнить `verify` |
| `verified` | online checks выполнены |
| `completed` | maintenance завершён, операция успешна |
| `verification_failed` или `post_complete_failed` | остановить dashboard и выполнить rollback/recovery |
| rollback phases | следовать status output; не менять файлы вручную |

При несоответствии receipt hash, path, operation ID или filesystem state CLI завершается fail-closed.

## Cleanup

Удалять retained rollback file, recovery point, receipt и secret files можно только после:

1. успешной фазы `completed`;
2. проверки login/settings/audit;
3. подтверждения, что новый backup уже создан и сохранён по эксплуатационной политике.

Удаляйте секреты безопасным способом, учитывая особенности filesystem и backup хоста. Не загружайте recovery artifacts в CI artifacts, issue comments или обычные логи.
