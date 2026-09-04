# Admin Dashboard Softrust

Локальный административный портал для управления FreeIPA, запуска и контроля процессов XYOps и эксплуатации самого портала.

Проект рассчитан на self-hosted запуск через Docker Compose. Портал имеет собственную локальную аутентификацию/RBAC, D1/SQLite-совместимое хранилище, audit, approvals, backup/restore, maintenance, health и storage diagnostics.

> Каноническое product/display name — **Admin Dashboard Softrust**. Технические compatibility identifiers `freeipa-admin-dashboard*` не являются пользовательским брендом и не переименовываются автоматически.

## Возможности

- FreeIPA users/groups CRUD, password reset и membership;
- каталог Events/Workflows XYOps и генерация форм по upstream metadata;
- запуск, cancel/rerun, результаты и notifications;
- approval gates для опасных процессов;
- локальные portal users, роли `viewer` / `operator` / `admin` и sessions;
- append-only audit с server-generated correlation IDs;
- encrypted settings lifecycle;
- sanitized и full encrypted logical backups;
- read-only restore preview и isolated test restore;
- selective production restore с recovery point;
- persistent maintenance mode;
- destructive offline full restore с atomic SQLite swap/rollback;
- liveness/readiness/dependency health, diagnostics и Prometheus baseline;
- storage status/integrity/migration preflight и controlled migration apply foundation.

## Требования

- Docker Engine и Docker Compose;
- свободный порт `3001`;
- доступ с хоста до FreeIPA;
- доступ до XYOps, если используется automation module.

Для разработки без Docker требуется Node.js `>=22.13.0`.

## Быстрый запуск

Создайте локальную конфигурацию:

```bash
cp .env.example .env
```

Обязательно задайте собственные production secrets. Не используйте example/fixture keys.

Минимально:

```env
PORTAL_IDENTITY_MODE=local
PORTAL_BOOTSTRAP_ADMIN_USERNAME=admin
PORTAL_BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-password-at-least-12-characters
ADMIN_TOKEN=replace-with-a-long-random-service-admin-token
CONFIG_ENCRYPTION_KEY=<unique-32-byte-key>
```

Правила генерации и ротационного/операционного обращения с encryption key: [`docs/CONFIG_ENCRYPTION_KEY.md`](docs/CONFIG_ENCRYPTION_KEY.md).

Запуск:

```bash
docker compose up -d --build
docker compose ps
```

Портал:

```text
http://localhost:3001
```

Остановка без удаления persistent volume:

```bash
docker compose down
```

Данные хранятся в Compose volume `dashboard-data`.

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

Bootstrap admin создаётся только при пустой таблице portal users. После создания bootstrap variables не перезаписывают пароль или роль существующего пользователя.

Portal user и FreeIPA user — разные сущности. FreeIPA groups не назначают portal roles автоматически.

Полный contract: [`docs/LOCAL_AUTH_RBAC.md`](docs/LOCAL_AUTH_RBAC.md).

## Архитектурный контур

- **Frontend:** React/Vinext, `app/`;
- **Backend:** Worker-oriented HTTP runtime, `worker/`;
- **Storage:** local D1/SQLite-compatible DB в Docker volume;
- **FreeIPA:** private Node.js Gateway `scripts/freeipa-gateway.mjs`;
- **XYOps:** server-side API client; API key не передаётся браузеру;
- **Schema:** canonical versioned migration lifecycle до ordinary API;
- **Recovery:** maintenance + selective restore + offline full restore.

Полный `ARCHITECTURE.md` и module-boundary map являются отдельным этапом Epic #82. До их появления authoritative owners перечислены в [`docs/SOURCE_OF_TRUTH.md`](docs/SOURCE_OF_TRUTH.md).

## Health и диагностика

Контракты разделены:

```text
GET /health/live
GET /health/ready
GET /health/dependencies
GET /metrics/health
GET /diagnostics/health
```

- liveness не зависит от FreeIPA/XYOps;
- readiness проверяет обязательный локальный runtime;
- external dependency degradation не является restart signal;
- metrics не выполняют external dependency probes.

Документация:

- [`docs/operations/HEALTH_CONTRACTS.md`](docs/operations/HEALTH_CONTRACTS.md)
- [`docs/operations/HEALTH_METRICS.md`](docs/operations/HEALTH_METRICS.md)
- [`docs/STORAGE_STATUS.md`](docs/STORAGE_STATUS.md)
- [`docs/STORAGE_INTEGRITY.md`](docs/STORAGE_INTEGRITY.md)

## Schema и migrations

Startup применяет только migrations, разрешённые как `automatic`. Controlled suffix никогда не применяется скрыто при startup и требует отдельного maintenance/preflight/apply workflow.

Основные operator/admin surfaces:

```text
GET  /api/schema/status
POST /api/admin/storage/migrations/preflight
POST /api/admin/storage/migrations/apply
GET  /api/admin/storage/migrations/apply/status
POST /api/admin/storage/migrations/apply/reconcile
```

Полный contract: [`docs/DATABASE_MIGRATIONS.md`](docs/DATABASE_MIGRATIONS.md).

## Backup, restore и maintenance

Портал поддерживает:

- sanitized logical export;
- full encrypted logical backup;
- read-only preview;
- isolated in-memory test restore;
- staged selective production restore;
- persistent maintenance mode;
- destructive offline full restore.

Destructive full restore **реализован** и выполняется только offline: maintenance должен быть active, dashboard останавливается, создаётся mandatory encrypted raw-SQLite recovery point, candidate проверяется до live mutation, а swap/rollback связываются receipt-ом.

Не выполняйте file-level restore по краткому README. Используйте только active runbook:

- [`docs/MAINTENANCE_MODE.md`](docs/MAINTENANCE_MODE.md)
- [`docs/OFFLINE_FULL_RESTORE.md`](docs/OFFLINE_FULL_RESTORE.md)

## XYOps ownership

XYOps остаётся источником истины для process execution, queues, rate limits и concurrency. Portal не создаёт вторую scheduler/business queue.

Документация:

- [`docs/XYOPS_EXECUTION_OWNERSHIP.md`](docs/XYOPS_EXECUTION_OWNERSHIP.md)
- [`docs/XYOPS_INSPECTOR.md`](docs/XYOPS_INSPECTOR.md)
- [`docs/PROCESS_PRESENTATION_METADATA.md`](docs/PROCESS_PRESENTATION_METADATA.md)

## Тестирование

Основные команды:

```bash
npm run lint
npm run build
npm test
npm run test:e2e:auth
npm run test:local
npm run test:p0:acceptance
npm run test:recovery
npm run test:recovery:compose
```

Локальная acceptance-процедура:

- [`docs/LOCAL_ACCEPTANCE_TESTS.md`](docs/LOCAL_ACCEPTANCE_TESTS.md)
- [`docs/P0_OPERATIONAL_ACCEPTANCE.md`](docs/P0_OPERATIONAL_ACCEPTANCE.md)

## Инженерная документация

Главная точка входа:

- [`docs/README.md`](docs/README.md)

Обязательные meta-docs:

- [`docs/DOCUMENTATION_POLICY.md`](docs/DOCUMENTATION_POLICY.md)
- [`docs/SOURCE_OF_TRUTH.md`](docs/SOURCE_OF_TRUTH.md)
- [`docs/DOCUMENTATION_INVENTORY.md`](docs/DOCUMENTATION_INVENTORY.md)
- [`docs/GLOSSARY.md`](docs/GLOSSARY.md)
- [`docs/ai/README.md`](docs/ai/README.md)

Актуальный backlog хранится в GitHub Issues. `docs/OPEN_TASKS.md` является superseded historical snapshot и не должен использоваться как текущий task registry.

## Правило для изменений

Если PR меняет API, permissions/auth, schema, config, integration contract, security boundary, deployment, health, backup/recovery или пользовательский workflow, связанная документация обновляется в том же PR.

Issue, implementation plan и старый PR не являются доказательством текущего runtime. При конфликте сначала проверяйте текущий `main` и canonical source of truth.
