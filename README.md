# FreeIPA Admin Dashboard

Локальный административный портал для управления FreeIPA и запуска процессов XYOps.

Проект собирается и запускается на собственной машине или сервере через Docker Compose. Облачные сервисы, внешние SSO-провайдеры и облачные базы данных для работы портала не требуются.

## Возможности

- управление пользователями и группами FreeIPA;
- включение, отключение, редактирование и удаление пользователей;
- сброс пароля и управление членством в группах;
- каталог Events и Workflows из XYOps;
- генерация форм по метаданным XYOps;
- запуск, отмена и повтор операций;
- согласование опасных процессов;
- журнал операций, уведомления и append-only аудит;
- собственная локальная база пользователей портала;
- управление ролями `viewer`, `operator` и `admin` через UI;
- sanitized и полные зашифрованные логические резервные копии;
- read-only preview и изолированная проверка восстановления без изменения рабочей базы;
- staged selective production restore с обязательным recovery point и optimistic concurrency;
- persistent maintenance mode перед будущими destructive/offline recovery операциями.

## Требования

- Docker Engine с Docker Compose;
- свободный порт `3001`;
- доступ с хоста портала до тестового или рабочего FreeIPA;
- доступ до XYOps, когда используется модуль автоматизации.

Для разработки без Docker требуется Node.js `>=22.13.0`.

## Быстрый запуск

```bash
cp .env.example .env
```

Перед запуском обязательно измените:

```env
PORTAL_BOOTSTRAP_ADMIN_PASSWORD=надежный-пароль-не-короче-12-символов
ADMIN_TOKEN=длинный-случайный-токен
CONFIG_ENCRYPTION_KEY=64-символьный-hex-ключ
```

Затем настройте FreeIPA и XYOps в `.env` и запустите портал:

```bash
docker compose up -d --build
docker compose ps
```

Портал доступен по адресу:

```text
http://localhost:3001
```

Остановка:

```bash
docker compose down
```

Данные сохраняются в именованном томе `dashboard-data`.

При запуске Worker сначала проверяет canonical schema локальной D1/SQLite-базы, применяет только additive migrations и сверяет migration journal. Обычный API и scheduled-задачи не запускаются, пока база не перейдёт в состояние `ready`. После schema readiness внешний maintenance gate проверяет persistent state до service-admin authorization. Подробности: [docs/DATABASE_MIGRATIONS.md](docs/DATABASE_MIGRATIONS.md) и [docs/MAINTENANCE_MODE.md](docs/MAINTENANCE_MODE.md).

Docker проверяет только `/health/live`; readiness обязательного локального runtime доступна через `/health/ready`. Диагностический `/health/dependencies` выполняет cached read-only probes FreeIPA и XYOps, но никогда не используется как restart signal. Сбои внешних систем не должны вызывать restart loop. Полный контракт и примеры probe’ов: [docs/HEALTH_CONTRACTS.md](docs/HEALTH_CONTRACTS.md).

## Локальная аутентификация

Основной режим:

```env
PORTAL_IDENTITY_MODE=local
PORTAL_BOOTSTRAP_ADMIN_USERNAME=admin
PORTAL_BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-password-at-least-12-characters
PORTAL_BOOTSTRAP_ADMIN_NAME=Локальный администратор
PORTAL_SESSION_TTL_HOURS=12
PORTAL_DEFAULT_ROLE=viewer
```

Первый администратор создаётся только при пустой таблице `portal_users`. После этого bootstrap-переменные не изменяют его пароль или роль.

Вход выполняется на странице `/login`. Управление пользователями и ролями доступно администратору на странице `/access`.

Пользователи портала и пользователи FreeIPA — независимые сущности:

- FreeIPA хранит доменные учётные записи и группы;
- локальная SQLite-база хранит пользователей административного портала;
- совпадение логина не связывает учётные записи;
- группы FreeIPA не назначают роли портала;
- удаление пользователя в одной системе не удаляет его из другой.

## Роли и права

| Роль | Права |
|---|---|
| `viewer` | просмотр каталога, FreeIPA, операций и собственных уведомлений |
| `operator` | права viewer, изменения FreeIPA и запуск XYOps |
| `admin` | все права, удаление объектов, согласования, настройки, аудит, RBAC, backup/restore и управление maintenance mode через `maintenance.manage` |

Сервер запрещает удалить, отключить или понизить последнего активного администратора.

## Безопасность локального входа

- пароли хешируются PBKDF2-SHA-256;
- для каждого пароля используется отдельная случайная salt;
- сырой пароль не сохраняется;
- после пяти неверных паролей вход блокируется на 15 минут;
- браузер получает `HttpOnly`, `SameSite=Strict` cookie;
- при HTTPS cookie получает флаг `Secure`;
- в базе хранится только SHA-256 hash session token;
- смена пароля и блокировка пользователя отзывают его сессии;
- selective restore local-auth и вход в active maintenance отзывают все локальные сессии;
- изменения RBAC и recovery transitions записываются в append-only аудит.

Подробности: [docs/LOCAL_AUTH_RBAC.md](docs/LOCAL_AUTH_RBAC.md).

## Архитектура

- **Frontend:** React и Vinext, каталог `app/`;
- **Backend:** Worker API в `worker/`;
- **Локальный runtime:** Wrangler/Workerd внутри контейнера;
- **Хранилище:** локальная D1/SQLite-совместимая база в Docker volume;
- **Migration boundary:** canonical schema, migration journal, startup lock и drift detection до запуска обычного API;
- **Maintenance boundary:** persistent state и fail-closed gate между schema readiness и service-admin authorization;
- **FreeIPA Gateway:** приватный Node.js-процесс `scripts/freeipa-gateway.mjs`;
- **Интеграция XYOps:** серверный API-клиент, ключи не передаются браузеру.

FreeIPA Gateway запускается автоматически вместе с Dashboard и доступен только локальному процессу портала.

## Основные таблицы

| Таблица | Назначение |
|---|---|
| `portal_users` | локальные пользователи, password hash, роль и блокировка |
| `portal_sessions` | hash сессии, время жизни и User-Agent |
| `app_settings` | зашифрованные настройки интеграций |
| `operation_runs` | история FreeIPA и XYOps операций |
| `xyops_catalog_snapshot` | текущий снимок каталога XYOps |
| `xyops_catalog_history` | ограниченная история изменений каталога |
| `process_presentation_sets` | названия, категории, значки, порядок и локализация |
| `portal_audit_events` | append-only аудит административных действий |
| `portal_schema_migrations` | versioned migration journal с checksum и временем применения |
| `portal_schema_lock` | сериализация concurrent startup migrations |
| `portal_maintenance_state` | singleton persistent maintenance state и hash controller secret |

Полный canonical inventory находится в `db/portal-schema.ts`.

## Основные API

### Аутентификация и RBAC

```text
POST   /api/auth/login
GET    /api/auth/session
POST   /api/auth/logout
GET    /api/auth/users
POST   /api/auth/users
PUT    /api/auth/users/:id
DELETE /api/auth/users/:id
POST   /api/auth/users/:id/password
DELETE /api/auth/users/:id/sessions
```

### FreeIPA

```text
GET  /api/integrations/users
GET  /api/integrations/groups
POST /api/integrations/freeipa/actions
```

### XYOps

```text
GET  /api/integrations/catalog
GET  /api/integrations/catalog/history
GET  /api/integrations/catalog/options
POST /api/integrations/catalog/run
GET  /api/integrations/runs
POST /api/integrations/runs/:id/cancel
POST /api/integrations/runs/:id/rerun
```

### Health, состояние и настройки

```text
GET  /health/live
GET  /health/ready
GET  /health/dependencies
GET  /api/integrations/health   # deprecated compatibility alias для /health/live
GET  /api/integrations/status
GET  /api/integrations/settings
PUT  /api/integrations/settings
POST /api/integrations/settings/test
```

`/health/live` публичен и не обращается к D1 или сети. `/health/ready` проверяет D1/schema, локальный crypto self-test и loopback FreeIPA Gateway. `/health/dependencies` выполняет bounded read-only probes внешних систем, кэширует только sanitized status metadata на 30 секунд и предназначен для внутренней диагностики/alerting, а не для liveness или readiness. Подробности и безопасные response codes: [docs/HEALTH_CONTRACTS.md](docs/HEALTH_CONTRACTS.md).

### Резервные копии и selective restore

```text
POST /api/admin/backups/export
POST /api/admin/backups/import/preview
POST /api/admin/backups/export/encrypted
POST /api/admin/backups/import/encrypted/preview
POST /api/admin/backups/import/encrypted/test-restore
POST /api/admin/backups/import/encrypted/prepare-commit
POST /api/admin/backups/import/encrypted/commit
POST /api/admin/backups/import/encrypted/cancel
```

Все endpoint доступны только администратору и используют `cache-control: no-store`. Export создаёт логический документ в ответе и не сохраняет его на сервере.

Encrypted preview может проверять все домены backup или явное непустое подмножество `domains`. Он проверяет manifest, paths, checksums, schema compatibility и conflicts, а затем возвращает opaque `approvalToken`, связанный с выбранным backup, доменами, текущей схемой и текущим состоянием выбранных данных.

`test-restore` повторно вычисляет token и отклоняет устаревший preview с `409 backup_restore_stale`. После этого данные расшифровываются только в памяти, копируются в новое request-scoped хранилище и проходят проверки table contract, primary keys, JSON-полей и внутренних ссылок. Endpoint всегда возвращает `productionMutated: false`; рабочая D1-база используется только для read-only fingerprint и comparison.

`prepare-commit` повторно проверяет encrypted candidate, создаёт обязательный зашифрованный recovery point выбранных physical domains и сохраняет только metadata stage. `commit` требует одноразовый stage secret, точное confirmation, свежие source/recovery bindings и выполняет один guarded D1 batch. `cancel` разрешён только до claim stage. Audit содержит агрегаты и normalized outcomes, но не backup password, stage secret, approval token или строки backup.

### Persistent maintenance mode

```text
GET  /api/maintenance/status
GET  /api/admin/maintenance/status
POST /api/admin/maintenance/prepare
POST /api/admin/maintenance/enter
POST /api/admin/maintenance/verification/start
POST /api/admin/maintenance/exit
POST /api/admin/maintenance/complete
POST /api/admin/maintenance/cancel
```

Управление требует admin permission `maintenance.manage`; mutations дополнительно требуют same-origin. `prepare` возвращает client-held `controllerSecret` один раз, а сервер хранит только SHA-256 hash. Переход в `active` одним guarded D1 batch отзывает все локальные сессии.

В `entering`, `active`, `verifying`, `exiting` и `failed` внешний gate блокирует обычный API и scheduled-задачи до service-admin authorization. Static assets, публичный status, health, schema status и bounded maintenance controls остаются доступны. Ошибка чтения persistent state работает fail-closed. Полный порядок действий: [docs/MAINTENANCE_MODE.md](docs/MAINTENANCE_MODE.md).

### Recovery-диагностика схемы

```text
GET /api/schema/status
x-admin-token: <ADMIN_TOKEN>
```

Endpoint доступен даже при заблокированном обычном API, но только с корректным service-admin token. Он возвращает безопасные version/drift/error metadata без SQL, credentials, encrypted values и exception bodies.

Часть критичных endpoint дополнительно использует `ADMIN_TOKEN`. Он остаётся серверным секретом и не заменяет пользовательскую RBAC-проверку. В active maintenance `ADMIN_TOKEN` не обходит внешний gate.

## Локальная разработка

```bash
cp .dev.vars.example .dev.vars
npm ci
npm run dev
```

Полезные команды:

```bash
npm run lint
npm run build
npm test
npm run inspect:xyops
npm run test:local
```

## Реальное локальное тестирование

Отдельный тестовый профиль не использует рабочую базу портала:

```bash
cp .env.test.example .env.test
npm run test:local
```

По умолчанию выполняются безопасные read-only проверки. Реальные мутации FreeIPA и запуск тестового процесса XYOps включаются только явными флагами в `.env.test`.

Результаты сохраняются в:

```text
artifacts/local-integration/latest.json
artifacts/local-integration/<run-id>/report.json
artifacts/local-integration/<run-id>/report.html
artifacts/local-integration/compose.log
```

Пошаговая эксплуатационная проверка: [docs/LOCAL_ACCEPTANCE_TESTS.md](docs/LOCAL_ACCEPTANCE_TESTS.md).

## Документация

- [Локальная аутентификация и RBAC](docs/LOCAL_AUTH_RBAC.md)
- [Локальные acceptance-тесты](docs/LOCAL_ACCEPTANCE_TESTS.md)
- [Canonical schema и migration lifecycle](docs/DATABASE_MIGRATIONS.md)
- [Persistent maintenance mode](docs/MAINTENANCE_MODE.md)
- [Health contracts и probe policy](docs/HEALTH_CONTRACTS.md)
- [Дорожная карта](docs/PRODUCT_ROADMAP.md)
- [Контракт XYOps](docs/XYOPS_EXECUTION_OWNERSHIP.md)
- [Инспектор XYOps](docs/XYOPS_INSPECTOR.md)
- [Презентационные метаданные](docs/PROCESS_PRESENTATION_METADATA.md)
- [Аудит](docs/AUDIT_LOG.md)
- [Дизайн isolated test restore](docs/superpowers/specs/2026-07-31-isolated-test-restore-design.md)

## Резервное копирование

Портал поддерживает два логических формата:

1. **Sanitized export** — явные безопасные проекции без password hashes, session tokens, encrypted settings blobs и `encrypted_spec`.
2. **Encrypted full backup** — полные portal-owned recovery-поля, зашифрованные отдельным пользовательским паролем.

Encrypted full backup использует PBKDF2-SHA-256 и AES-256-GCM. Для каждого домена создаётся отдельный случайный IV, а format/version/schema/domain/path входят в authenticated additional data. Неверный пароль и изменение salt, IV, AAD или ciphertext возвращают одинаковую безопасную ошибку.

Пароль backup существует только в текущем HTTP-запросе: он не сохраняется, не возвращается, не записывается в audit и не заменяет `CONFIG_ENCRYPTION_KEY`. Сам `CONFIG_ENCRYPTION_KEY` никогда не включается в backup; его необходимо хранить отдельно.

Текущий managed recovery workflow поддерживает:

- read-only preview всех или выбранных доменов;
- optimistic concurrency token без раскрытия full current-state fingerprints;
- constant-time token verification перед test restore и production prepare;
- изолированное request-scoped memory staging;
- структурные и реляционные проверки settings, local-auth, RBAC, operations и approvals;
- обязательный encrypted recovery point для selective production restore;
- metadata-only staged commit с одноразовым secret и cancellation до claim;
- dependency-safe guarded D1 batch и отзыв сессий при local-auth restore;
- безопасные aggregate results и fixed warning codes без row identifiers;
- persistent maintenance foundation для будущего destructive/offline restore.

Ограничения текущего этапа:

- export request — не более 16 KiB;
- encrypted preview, test-restore и selective restore request — bounded до JSON parsing;
- сумма canonical encrypted envelopes — не более 18 MiB;
- PBKDF2 work factor — от 210000 до 1000000 iterations;
- backup, approval token и controller secret не сохраняются сервером;
- test restore не расшифровывает portal secret blobs через `CONFIG_ENCRYPTION_KEY`;
- selective restore не выполняет destructive full-database replacement;
- maintenance foundation не читает backup и не обращается к filesystem;
- destructive full restore, SQLite file swap и CLI/offline recovery будут реализованы отдельным этапом #37.

До появления destructive restore workflow продолжайте хранить отдельную volume-level копию `dashboard-data` и отдельно защищённый `CONFIG_ENCRYPTION_KEY`. `canCommit` из test restore является advisory результатом; production mutation запускается только отдельным staged selective restore flow. Persistent maintenance mode сам по себе не восстанавливает данные и не заменяет offline recovery procedure.
