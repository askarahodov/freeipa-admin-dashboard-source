# Offline destructive full restore

## Назначение

Процедура восстанавливает все canonical domains портала из полного зашифрованного логического backup и атомарно заменяет локальный SQLite-файл в Docker volume.

Она не резервирует FreeIPA, XYOps, remote D1 или object storage и не выполняется из браузера.

## Обязательные гарантии

- persistent maintenance mode включён до остановки портала;
- контейнер `dashboard` остановлен до любых file-level изменений;
- mutating offline-команды выполняются под общим kernel `flock`;
- перед restore создаётся отдельный зашифрованный raw-SQLite recovery point;
- backup password и recovery-point password разделены;
- historical `portal_sessions` не восстанавливаются;
- candidate полностью проверяется до изменения live path;
- swap выполняется rename/fsync на одном filesystem;
- повторный запуск следует receipt, а не времени или имени файла;
- maintenance не выключается автоматически после restart или по таймеру;
- секреты читаются только из mode-`0600` файлов под `/run/portal-recovery-secrets`.

Не копируйте работающую SQLite вместе с `-wal`/`-shm`, не удаляйте `portal_maintenance_state` вручную и не выбирайте `.sqlite` по имени.

## Threat model

Workflow защищает от случайного запуска рядом с работающим runtime, неоднозначного database discovery, повреждённого backup, неверных ключей, частичного candidate write, падения между rename/fsync и повторного запуска после сбоя. Полный root compromise хоста находится вне threat model.

## Подготовка

```bash
install -d -m 0700 recovery recovery-secrets
for name in backup-password recovery-password controller-secret admin-password config-key service-token confirmation; do
  install -m 0600 /dev/null "recovery-secrets/$name"
done
```

Заполните файлы через защищённый secret manager или редактор. Не передавайте secret values в argv и shell history.

| Файл | Значение |
|---|---|
| `backup-password` | пароль полного логического backup |
| `recovery-password` | отдельный пароль raw-SQLite recovery point |
| `controller-secret` | secret текущей maintenance operation |
| `admin-password` | пароль активного локального администратора |
| `config-key` | действующий `CONFIG_ENCRYPTION_KEY` |
| `service-token` | серверный `ADMIN_TOKEN` для online verification |
| `confirmation` | exact confirmation из receipt или emergency challenge |

Поместите backup в `recovery/full-backup.json`.

## 1. Вход в maintenance

Проверьте административный status и продолжайте только из `inactive`:

```bash
curl --fail-with-body --silent --show-error \
  -H "x-admin-token: ${ADMIN_TOKEN}" \
  http://127.0.0.1:3001/api/admin/maintenance/status
```

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

Сохраните `operationId` и `controllerSecret`, запишите secret в `recovery-secrets/controller-secret` и выполните `/api/admin/maintenance/enter` с exact confirmation `ENTER:<operationId>`. Убедитесь, что state стал `active`.

## 2. Остановка runtime

```bash
docker compose stop dashboard
docker compose ps
```

Не продолжайте, пока `dashboard` работает. CLI дополнительно проверяет общий lock.

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

Preflight проверяет единственную canonical DB, schema readiness, maintenance/controller binding, backup manifest/checksums, администратора, encrypted settings/replay/approval material и свободное место.

## 4. Mandatory recovery point

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

Команда выполняет checkpoint, SQLite backup, integrity check, шифрование и повторную проверку. Скопируйте возвращённое exact `confirmation` в mode-`0600` файл `recovery-secrets/confirmation`. Не редактируйте receipt или recovery point.

## 5. Candidate и atomic swap

Candidate и retained original должны находиться на том же filesystem, что и live DB:

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

Candidate сохраняет migration journal и maintenance operation, не восстанавливает sessions и проходит integrity/schema/admin/encryption/audit checks. Повторный запуск выполняйте только с теми же receipt/candidate/rollback paths.

## 6. Receipt status

```bash
docker compose --profile recovery run --rm recovery status \
  --receipt /recovery/restore-receipt.json
```

Перед restart ожидается `swapped`. Для `swap_started` повторите `restore` с теми же аргументами, чтобы reconciliation выбрал единственное безопасное действие. Для `failed` или `post_complete_failed` остановитесь и выполняйте rollback/recovery.

## 7. Restart и online verification

```bash
docker compose up -d dashboard
docker compose ps
```

После health readiness:

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

`verify` выполняет bounded health/schema/status/smoke, проверяет администратора без persistent session, расшифровку settings, audit write/readback и отсутствие старых sessions. Затем выполняются штатные `verification/start`, `exit`, `complete`, реальный login/logout и финальный status. Успех переводит maintenance в `inactive` и receipt в `verified`.

## Rollback

При неуспешной post-swap проверке снова остановите dashboard:

```bash
docker compose stop dashboard
```

Используйте exact live relative path из receipt/status:

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

Rollback использует retained original либо проверенный mandatory recovery point. Maintenance не выключается автоматически.

## Failed maintenance recovery

Команда разрешена только при остановленном runtime, валидном receipt/recovery point и состоянии `failed` либо доказанной потере controller secret. Запишите в confirmation file:

```text
RECOVER FAILED MAINTENANCE <operationId>
```

Затем:

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

Integrity/schema/config/admin checks выполняются до одной offline transaction, которая сбрасывает maintenance, очищает sessions и добавляет audit event. Это не обход повреждённой DB и не заменяет rollback.

## Exact receipt phases

| Фаза | Действие |
|---|---|
| `recovery_point_ready` | разрешено строить candidate |
| `candidate_ready` | разрешён swap с теми же paths |
| `swap_started` | повторить `restore` для reconciliation |
| `swapped` | запустить dashboard и выполнить `verify` |
| `verified` | online verification и maintenance completion успешны |
| `rollback_started` | продолжить rollback с теми же paths |
| `rolled_back` | original DB восстановлена; выполнить эксплуатационные проверки |
| `failed` | остановить runtime и выполнить rollback/recovery |
| `post_complete_failed` | maintenance уже завершался, но финальная проверка не прошла; остановить runtime и выполнить recovery |

Иных receipt phases нет. При несовпадении hash/path/operation ID/filesystem state CLI завершается fail-closed.

## Cleanup

Удалять retained original, recovery point, receipt и secret files можно только после:

1. receipt phase `verified` или подтверждённого `rolled_back`;
2. проверки login/settings/audit;
3. создания нового эксплуатационного backup.

Не загружайте recovery artifacts или secret files в CI artifacts, issue comments и обычные логи.
