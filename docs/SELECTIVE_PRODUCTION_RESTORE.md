# Selective Production Restore

## Назначение

Selective production restore восстанавливает только явно выбранные portal-owned домены из полной зашифрованной резервной копии. Workflow рассчитан на управляемое восстановление конфигурации и данных портала без destructive full-database replacement и без maintenance mode.

Workflow доступен только роли `admin` и состоит из отдельных этапов `preview` → `test-restore` → `prepare-commit` → `commit` либо `cancel`.

## Перед началом

Оператору необходимы:

- исходный encrypted full backup;
- пароль исходного backup;
- отдельно сохранённый `CONFIG_ENCRYPTION_KEY`, если восстанавливаются encrypted settings или encrypted operation specifications;
- актуальный `approvalToken`, полученный из encrypted preview;
- отдельный новый пароль для pre-restore recovery point;
- локальная сессия администратора или разрешённый service-admin boundary;
- рабочая схема портала в состоянии `ready`.

Пароль backup и пароль recovery point не сохраняются сервером и не записываются в audit.

## Поддерживаемые домены

| Домен | Selective commit | Условия |
|---|---:|---|
| `settings` | да | encrypted values остаются opaque; нужен соответствующий отдельно сохранённый `CONFIG_ENCRYPTION_KEY` |
| `local-auth` | да | backup обязан содержать активного администратора; все рабочие browser sessions отзываются |
| `rbac` | только вместе с `local-auth` | логическая проекция `portal_users`, отдельный DML не выполняется |
| `policies` | да | заменяются visibility, approval и presentation policies |
| `catalog` | да | transient catalog locks не восстанавливаются |
| `operations` | только вместе с `approvals` | dependency bundle |
| `approvals` | только вместе с `operations` | dependency bundle |
| `audit` | нет | append-only audit можно затрагивать только в будущем maintenance-mode full restore |

Пустой выбор, дубликаты, неизвестные домены и неполные dependency bundles отклоняются до production mutation.

## Этап 1. Preview

```text
POST /api/admin/backups/import/encrypted/preview
```

Preview проверяет manifest, checksums, payload paths, schema compatibility и conflicts. В запросе передаётся явное поле `domains`.

Ответ содержит `restorePlan.approvalToken`. Token связан с:

- выбранными manifest entries;
- checksums, byte/record counts и paths;
- source/current schema version;
- выбранными доменами;
- полным текущим состоянием выбранных данных.

Token не является авторизацией и не заменяет admin RBAC.

## Этап 2. Isolated test restore

```text
POST /api/admin/backups/import/encrypted/test-restore
```

Test restore повторно вычисляет approval token и отклоняет устаревший preview с `409 backup_restore_stale`. Затем payloads расшифровываются и проверяются только в request-scoped memory store.

Обязательное условие для следующего этапа:

```json
{
  "tested": true,
  "productionMutated": false,
  "canCommit": true
}
```

`canCommit` является advisory результатом и сам по себе ничего не изменяет.

## Этап 3. Prepare commit

```text
POST /api/admin/backups/import/encrypted/prepare-commit
```

Prepare выполняет повторную isolated verification, проверяет domain policy и активного администратора, затем создаёт encrypted recovery point текущего production state выбранных физических доменов.

Упрощённый запрос:

```json
{
  "operation": "restore",
  "document": {},
  "password": "source-backup-password",
  "domains": ["policies"],
  "approvalToken": "64-character-lowercase-sha256",
  "recoveryPassword": "new-independent-recovery-password"
}
```

Ответ содержит:

- encrypted recovery document;
- `stage.id`;
- одноразовый `stage.secret`;
- `stage.expiresAt`;
- safe aggregate isolated/recovery summaries;
- `productionMutated: false`.

### Обязательное действие оператора

Перед commit необходимо сохранить recovery document во внешнем защищённом месте и проверить, что файл реально доступен для чтения. Сервер не хранит recovery document и не сможет восстановить его после закрытия ответа.

Stage действует 15 минут. Сервер сохраняет только metadata и SHA-256 hash stage secret. Исходный backup, recovery backup, пароли, approval token и full fingerprints в stage table не записываются.

## Этап 4. Commit

```text
POST /api/admin/backups/import/encrypted/commit
```

Commit требует повторно передать исходный backup, recovery point и оба пароля. Это намеренно: сервер не хранит документы между запросами.

Упрощённый запрос:

```json
{
  "operation": "restore",
  "document": {},
  "password": "source-backup-password",
  "domains": ["policies"],
  "approvalToken": "64-character-lowercase-sha256",
  "recoveryDocument": {},
  "recoveryPassword": "new-independent-recovery-password",
  "stageId": "restore_...",
  "stageSecret": "one-time-secret",
  "acknowledgeRecoverySaved": true,
  "confirmation": "RESTORE:restore_..."
}
```

Когда выбран `local-auth`, дополнительно обязательно:

```json
{
  "acknowledgeSessionRevocation": true
}
```

Commit выполняет gates в следующем порядке:

1. strict request и exact confirmation;
2. stage actor/status/expiry и constant-time secret check;
3. повторный isolated test restore;
4. fresh recovery-point verification против текущего full production state;
5. source/recovery binding verification;
6. повторная full source validation;
7. построение fixed allowlisted write plan;
8. один guarded D1 batch.

Первая команда batch атомарно переводит stage в `committing` только если все выбранные production tables по-прежнему совпадают с recovery snapshot. Guard использует bounded JSON chunks, точные row counts и set comparison. Если состояние изменилось, domain DML остаётся no-op и запрос завершается `backup_recovery_point_stale`.

В одном D1 batch выполняются:

- guarded stage claim;
- dependency-safe deletes;
- bounded parameterized inserts;
- append-only aggregate audit event;
- stage transition в `committed`.

Ошибка любого statement откатывает batch целиком.

## D1-ограничения selective commit

Чтобы не превышать platform limits и не терять атомарность:

- один JSON binding ограничен 1 750 000 UTF-8 bytes;
- один row, который не помещается в такой binding после canonical JSON encoding, отклоняется;
- claim использует не более 100 bound parameters;
- generated SQL ограничен 100 000 bytes;
- restore batch ограничен 48 statements.

Кандидат, который нельзя безопасно уложить в эти пределы, отклоняется до production mutation. Для очень больших данных следует использовать будущий maintenance-mode full/volume restore.

## Cancel

```text
POST /api/admin/backups/import/encrypted/cancel
```

```json
{
  "stageId": "restore_...",
  "stageSecret": "one-time-secret"
}
```

Cancel разрешён только для matching unexpired stage в статусе `prepared`. После `cancelled` stage нельзя применить. Cancel не читает и не сохраняет backup payload.

## Rollback

Rollback не выполняется автоматически. Сохранённая recovery point используется как новый source backup:

1. выполнить preview recovery point;
2. выполнить isolated test restore;
3. вызвать `prepare-commit` с `operation: "rollback"`;
4. сохранить новую pre-rollback recovery point;
5. вызвать commit с подтверждением `ROLLBACK:<stageId>`.

Rollback проходит те же RBAC, CAS, recovery и transaction gates. Старый recovery-файл никогда не применяется без нового preview и нового stage.

## Сессии local-auth

При selective restore `local-auth`:

- восстанавливаются пользователи, password hashes, salts, iterations, roles и lock state;
- backup должен содержать хотя бы одного активного пользователя с ролью `admin`;
- все текущие production sessions удаляются;
- исторические `portal_sessions` из backup не вставляются;
- после commit все пользователи должны войти заново.

## Audit и секреты

Success commit audit записывается внутри того же D1 batch. Prepare/cancel/failure audit пишется отдельными безопасными событиями.

Audit не содержит:

- source/recovery passwords;
- stage secret или его hash;
- approval token;
- source/recovery binding hashes;
- checksums, salt, IV и ciphertext;
- plaintext rows;
- password/session hashes;
- encrypted settings и `encrypted_spec`.

Разрешены только operation, allowlisted domains, schema versions, aggregate table/record/check/warning counts, stage status, duration и normalized error code.

## Не входит в текущий workflow

- maintenance mode;
- full database replacement;
- audit deletion/replacement;
- schema migration во время restore;
- автоматическое хранение backup на сервере;
- remote object storage;
- volume-level restore;
- CLI/offline recovery;
- автоматическая передача или восстановление `CONFIG_ENCRYPTION_KEY`.
