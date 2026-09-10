# Operations / DevOps guide

## Для кого

Для инженера эксплуатации, который разворачивает, обновляет, диагностирует и восстанавливает Admin Dashboard Softrust.

Этот Guide объясняет порядок действий и точки входа. Точные команды destructive/recovery procedures остаются в профильных active runbooks.

## Поддерживаемый production path

Канонический production deployment — Docker image из repository `Dockerfile` / `compose.yaml` с Node production runtime `scripts/start-production.mjs` и persistent data directory `/data`.

`npm start`, Vite, Wrangler/Miniflare и `scripts/start-worker.mjs` не следует считать production container contract только потому, что они способны запустить приложение локально.

Текущая support matrix: [`../../architecture/DEPLOYMENT_MATRIX.md`](../../architecture/DEPLOYMENT_MATRIX.md).

## Перед развёртыванием

Проверьте:

- поддерживаемую версию Node/Docker environment;
- обязательные secrets/configuration;
- постоянное хранилище `/data`;
- доступ к FreeIPA и XYOps из выбранного network profile;
- TLS/CA/DNS requirements вашей среды;
- кто отвечает за backup/recovery keys;
- rollback image/version и recovery procedure.

Не помещайте production secrets в compose-файл, issue, CI log или screenshot.

Конфигурационный reference: [`../../reference/CONFIGURATION.md`](../../reference/CONFIGURATION.md).

## Запуск и остановка

Для production используйте repository-owned Docker/Compose path и его фактический image entrypoint. Не подменяйте его development launcher.

При остановке давайте runtime штатно обработать SIGTERM/SIGINT. Не завершайте процесс через повреждающую persistent SQLite операцию без необходимости.

Если вы меняете способ запуска, сначала проверьте current launcher contract и issue #541 — текущие package command names могут включать legacy/development paths.

## Обновление

Безопасный общий порядок:

1. определите exact target image/commit/version;
2. проверьте release/compatibility notes;
3. убедитесь, что recovery point/backup policy выполнена для рискованного изменения;
4. примените обновление по поддерживаемому deployment path;
5. проверьте liveness/readiness;
6. проверьте schema/migration state;
7. проверьте FreeIPA/XYOps dependency state;
8. выполните обязательный acceptance scope;
9. только затем объявляйте обновление завершённым.

Не используйте mutable tag как единственное доказательство того, какой build развернут.

## Rollback

Rollback зависит от того, менялись ли persisted data/schema/configuration.

- Если изменение stateless/runtime-only, используйте утверждённый previous image path.
- Если затронута schema или persisted data, сначала откройте migration/recovery documentation; простой downgrade image может быть небезопасен.
- Если выполнен destructive restore, следуйте recovery runbook, а не обычному image rollback.

Не обещайте rollback до проверки совместимости данных.

## Health: что проверять

Различайте:

### Liveness

Показывает, жив ли локальный process/runtime. Падение внешней интеграции не должно автоматически означать failure liveness.

### Readiness

Показывает, готов ли локальный runtime обслуживать запросы с учётом критичных local prerequisites.

### Dependency health

Отдельно отражает FreeIPA, XYOps и другие внешние зависимости. `degraded` dependency не означает автоматически, что необходимо перезапустить весь портал.

Канонический контракт: [`../../operations/HEALTH_CONTRACTS.md`](../../operations/HEALTH_CONTRACTS.md).

## Быстрый triage инцидента

1. Проверьте liveness.
2. Проверьте readiness.
3. Определите, локальная это проблема или конкретная external dependency.
4. Запишите безопасный correlation ID/error code и время.
5. Проверьте schema/storage state, если проблема локальная.
6. Проверьте DNS/TCP/TLS/auth/permission category, если проблема интеграционная.
7. Не изменяйте security policy только ради проверки гипотезы.
8. Используйте профильный runbook для восстановления.

Symptom-first список: [`../troubleshooting/README.md`](../troubleshooting/README.md).

## FreeIPA connectivity

При проблеме с FreeIPA различайте минимум:

- DNS resolution;
- route/connectivity;
- connection refused;
- timeout;
- TLS certificate/CA/name validation;
- authentication;
- permission/capability failure.

Не лечите TLS проблему глобальным отключением certificate verification. Browser не должен получать FreeIPA credentials/session cookie.

Текущий network topology может включать ограниченный host-network mode; его замена отслеживается #52. Не документируйте будущий bridge profile как уже supported, пока он не merged и accepted.

## XYOps connectivity

Для XYOps также различайте transport/TLS/auth и application-level errors.

Помните:

- XYOps владеет scheduler/queue/concurrency/rate limits;
- `429` следует обрабатывать с `Retry-After`;
- timeout не доказывает, что run не создан;
- blind retry non-idempotent run может создать duplicate execution;
- raw upstream body не должен попадать пользователю или в публичный support artifact.

Подробнее: [`../../integrations/XYOPS_EXECUTION_OWNERSHIP.md`](../../integrations/XYOPS_EXECUTION_OWNERSHIP.md).

## Storage и migrations

Для local SQLite используйте repository-owned diagnostics/migration procedures.

Не делайте:

- arbitrary SQL через незадокументированный web endpoint;
- ручное изменение migration journal;
- перенос production DB между `.wrangler` и `/data` «по имени команды»;
- удаление lock/state row для обхода safety gate.

Ссылки:

- [`../../operations/STORAGE_STATUS.md`](../../operations/STORAGE_STATUS.md);
- [`../../operations/STORAGE_INTEGRITY.md`](../../operations/STORAGE_INTEGRITY.md);
- [`../../operations/DATABASE_MIGRATIONS.md`](../../operations/DATABASE_MIGRATIONS.md).

## Backup

Backup считается полезным только если понятны:

- тип backup;
- encryption/recovery key boundary;
- срок хранения;
- доступность файла;
- процедура проверки восстановления;
- RPO/RTO вашей организации.

Не отправляйте full backup в issue или обычный chat. Sanitized backup также не следует считать автоматически безопасным для публичной передачи без политики организации.

## Maintenance mode

Maintenance — persistent safety state для операций, где обычные mutations/scheduled work должны быть остановлены.

Maintenance не следует выключать ручным удалением DB state и не следует ожидать, что он автоматически исчезнет после restart.

Точный state machine и operator procedure: [`../../operations/MAINTENANCE_MODE.md`](../../operations/MAINTENANCE_MODE.md).

## Full restore / disaster recovery

Offline full restore — destructive operation. Этот Guide намеренно не повторяет команды, controller secret, exact confirmations и atomic swap sequence.

Используйте только: [`../../operations/OFFLINE_FULL_RESTORE.md`](../../operations/OFFLINE_FULL_RESTORE.md).

После restore обязательно завершите verification procedure до возврата normal traffic.

## Monitoring

При построении monitoring используйте low-cardinality health/metrics contracts и не включайте secret values, raw usernames или произвольные request fields как labels.

Reference: [`../../operations/HEALTH_METRICS.md`](../../operations/HEALTH_METRICS.md).

## Что сохранить при инциденте

Безопасная базовая evidence:

- timestamp/time window;
- build/commit/image metadata, если она уже доступна штатно;
- liveness/readiness/dependency categories;
- normalized error code;
- correlation ID;
- schema/migration status;
- агрегированное storage state.

Не собирайте «на всякий случай» `.env`, raw database, cookies, passwords, API keys или encryption keys.

Diagnostic support archive из #62 не следует считать доступным продуктовым инструментом, пока соответствующая реализация не находится в `main`.

## Когда эскалировать разработчику

Эскалируйте, если:

- воспроизводимый defect остаётся после проверки configuration/dependency state;
- нарушен documented API/security/storage contract;
- миграция/restore застряли в неподдерживаемом состоянии;
- повторяется crash/data-integrity failure;
- требуется изменение кода, а не операционная remediation.

Передайте минимальную безопасную evidence и точный reproduction path.

## Связанные материалы

- [`../../architecture/DEPLOYMENT_MATRIX.md`](../../architecture/DEPLOYMENT_MATRIX.md);
- [`../../reference/CONFIGURATION.md`](../../reference/CONFIGURATION.md);
- [`../../operations/HEALTH_CONTRACTS.md`](../../operations/HEALTH_CONTRACTS.md);
- [`../../operations/DATABASE_MIGRATIONS.md`](../../operations/DATABASE_MIGRATIONS.md);
- [`../../operations/MAINTENANCE_MODE.md`](../../operations/MAINTENANCE_MODE.md);
- [`../../operations/OFFLINE_FULL_RESTORE.md`](../../operations/OFFLINE_FULL_RESTORE.md);
- [`../support/README.md`](../support/README.md);
- [`../troubleshooting/README.md`](../troubleshooting/README.md).
