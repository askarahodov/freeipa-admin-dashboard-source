# FreeIPA Admin Dashboard

Панель управления пользователями и группами FreeIPA на
[vinext](https://github.com/cloudflare/vinext) для Cloudflare Workers.
Использует платформу автоматизации XYOps как оркестратор операций и хранит
конфигурацию, журнал запусков и снимки каталога в D1/SQLite.

## Требования

- Node.js `>=22.13.0`
- Linux с утилитами `flock`, `curl` и GNU `timeout`

## Быстрый старт

```bash
cp .env.example .env
# Замените ADMIN_TOKEN и CONFIG_ENCRYPTION_KEY в .env на реальные значения
docker compose up -d --build
docker compose ps
```

Панель доступна на `http://localhost:3001`.

## Архитектура

- **Frontend**: React SPA в каталоге `app/` (Vinext SSR/SSR streaming).
- **Backend**: Cloudflare Worker (`worker/index.ts`) — API-шлюз для FreeIPA и XYOps.
- **База данных**: D1/SQLite через Drizzle ORM (`db/`, `drizzle/`).
- **Шлюз FreeIPA**: опциональный Node.js-процесс (`scripts/freeipa-gateway.mjs`) для
  обхода ограничений Workerd с TLS и сессиями FreeIPA.

### Хранилище D1

| Таблица | Назначение |
|---------|-----------|
| `app_settings` | Зашифрованные секреты и конфигурация |
| `operation_runs` | Журнал запусков Events/Workflows и прямых действий FreeIPA |
| `xyops_catalog_snapshot` | Текущий снимок каталога XYOps |
| `xyops_catalog_history` | История изменений каталога (последние 30 записей) |
| `process_presentation_sets` | Управляемые названия, категории, значки, порядок и справка |
| `portal_audit_events` | Append-only аудит административных действий |

### Роли и права (RBAC)

Портал определяет три роли:

| Роль | Права |
|------|-------|
| `viewer` | `directory.read` |
| `operator` | `directory.read`, `freeipa.write`, `xyops.run` |
| `admin` | все права, включая `freeipa.delete` и `settings.manage` |

Идентичность определяется по заголовку `oai-authenticated-user-email`.
Назначение ролей задается в `PORTAL_RBAC_JSON` в формате
`{"user@company.local":"admin", ...}`. По умолчанию — `admin`.

## API Endpoints

### Информация и состояние

- `GET /api/integrations/health` — легковесная проверка доступности.
- `GET /api/integrations/status` — статус интеграций, режим работы, роль
  пользователя и состояние D1.

### Пользователи и группы FreeIPA

- `GET /api/integrations/users` — список пользователей (`user_find`).
- `GET /api/integrations/groups` — список групп (`group_find` или fallback
  через членство пользователей).
- `POST /api/integrations/freeipa/actions` — прямые мутации FreeIPA:
  создание, редактирование, включение, отключение, удаление пользователей,
  создание и удаление групп, добавление и удаление участников.

### Автоматизация XYOps

- `GET /api/integrations/routes` — маршруты автоматизации (persisted + bootstrap).
- `PUT /api/integrations/routes` — сохранение маршрутов (требует `admin`).
- `GET /api/integrations/catalog` — нормализованный каталог Events/Workflows.
- `GET /api/integrations/catalog/history` — история изменений каталога.
- `GET/PUT /api/integrations/catalog/presentation` — презентационные metadata процессов.
- `GET /api/integrations/catalog/options` — динамические опции для полей выбора.
- `POST /api/integrations/catalog/run` — запуск Event/Workflow.
- `POST /api/integrations/actions` — запуск через маршрут автоматизации.
- `GET /api/integrations/runs` — журнал операций с автоматической синхронизацией
  статусов активных заданий.

### Настройки

- `GET /api/integrations/settings` — публичная информация о конфигурации.
- `PUT /api/integrations/settings` — сохранение настроек в D1 (требует `admin`).
- `POST /api/integrations/settings/test` — проверка подключения FreeIPA/XYOps.

Без `DEMO_MODE=true` все мутации требуют настроенной интеграции.

## Конфигурация

Основные переменные окружения:

| Переменная | Назначение |
|------------|-----------|
| `ADMIN_TOKEN` | Токен для доступа к настройкам и маршрутам |
| `CONFIG_ENCRYPTION_KEY` | 32-байтовый ключ AES-256-GCM для секретов |
| `DEMO_MODE` | Демо-режим без внешних интеграций |
| `IPA_URL` | Адрес FreeIPA сервера |
| `IPA_USERNAME` / `IPA_PASSWORD` | Учетные данные FreeIPA |
| `IPA_VERIFY_TLS` | Включить проверку TLS |
| `IPA_NODE_GATEWAY_URL` | Адрес Node.js-шлюза FreeIPA |
| `IPA_NODE_GATEWAY_TOKEN` | Токен доступа к шлюзу |
| `XYOPS_URL` | Адрес XYOps |
| `XYOPS_API_KEY` | API-ключ XYOps |
| `XYOPS_EVENT_ID` | Событие по умолчанию |
| `XYOPS_ROUTES_JSON` | Bootstrap-маршруты (если нет сохраненных в D1) |
| `PORTAL_DEFAULT_ROLE` | Роль по умолчанию |
| `PORTAL_RBAC_JSON` | JSON с назначениями ролей |

## Docker

Локальный сервис использует `network_mode: host`, чтобы разделять сетевой
стек хоста. Порт `3001` на хосте должен быть свободен. Именованный том
`dashboard-data` сохраняет базу D1 между перезапусками.

```bash
docker compose up -d --build
docker compose down
```

Контейнер запускает:
1. Dashboard (`vinext start` на порту `3001`);
2. приватный Node.js-шлюз FreeIPA на случайном порту `127.0.0.1`;
3. healthcheck на `GET /api/integrations/health`.

## Диагностика

```bash
npm run dev                  # локальный сервер разработки
npm run build                # сборка и валидация артефакта
npm run start:docker         # продакшен-запуск через wrangler dev
npm run inspect:xyops        # инспектор контрактов XYOps
npm run db:generate          # генерация миграций Drizzle
npm test                     # тесты
npm run lint                 # линтинг
```

## Документация

- [Дорожная карта продукта](docs/PRODUCT_ROADMAP.md)
- [Инспектор контрактов XYOps](docs/XYOPS_INSPECTOR.md)
- [Презентационные метаданные процессов](docs/PROCESS_PRESENTATION_METADATA.md)
- [Ответственность XYOps за rate limits и concurrency](docs/XYOPS_EXECUTION_OWNERSHIP.md)
- [Расширенный аудит](docs/AUDIT_LOG.md)

## Тестирование

```bash
npm test
```

Набор тестов покрывает:

- `freeipa-api.test.mjs` — нормализация ответов FreeIPA JSON-RPC.
- `persistent-settings.test.mjs` — шифрование/дешифрование настроек в D1.
- `xyops-catalog-api.test.mjs` — нормализация каталога XYOps и сценарии drift.
- `xyops-inspector.test.mjs` — инспектор контрактов.
- `rendered-html.test.mjs` — smoke-проверка рендеринга UI.
- `rbac.test.mjs` — проверка ролевой матрицы.
- `freeipa-gateway.test.mjs` — корректность запуска и responses Node.js-шлюза.

## Локальная разработка

Для разработки без Docker:

```bash
cp .dev.vars.example .dev.vars
npm run dev
```

Lokaly Vinext симулирует D1 через Wrangler/Miniflare. Миграции не применяются
автоматически; для проверки сценариев с persistent storage используйте Docker.

## FreeIPA Node Gateway

FreeIPA использует сессионные cookies и часто самоподписанные сертификаты,
что несовместимо с Cloudflare Workerd. Для этого запускается отдельный
Node.js-процесс (`scripts/freeipa-gateway.mjs`), который:

- выполняет вход по логину/паролю;
- сохраняет cookie-сессию;
- проксирует разрешенные JSON-RPC методы (`user_find`, `group_find`,
  `user_add`, `user_mod`, `user_password`, `user_enable`, `user_disable`,
  `user_del`, `group_add`, `group_del`, `group_add_member`,
  `group_remove_member`).

Worker вызывает шлюз по `IPA_NODE_GATEWAY_URL` с токеном
`IPA_NODE_GATEWAY_TOKEN`. Шлюз не exposes наружу.

В Docker compose шлюз запускается автоматически. При ручном запуске:

```bash
node scripts/freeipa-gateway.mjs
```

## Развертывание

### Cloudflare Workers / Pages

Проект собирается в Sites-артефакт через `npm run build`. Результат
(`dist/`) разворачивается на Cloudflare Pages или Workers. Требуются
привязки D1 и опционально R2, описанные в `.openai/hosting.json`.

Переменные окружения задаются в дашборде Cloudflare:
- `ADMIN_TOKEN`
- `CONFIG_ENCRYPTION_KEY`
- `IPA_URL`, `IPA_USERNAME`, `IPA_PASSWORD`, `IPA_VERIFY_TLS`
- `XYOPS_URL`, `XYOPS_API_KEY`, `XYOPS_ROUTES_JSON`
- `PORTAL_DEFAULT_ROLE`, `PORTAL_RBAC_JSON`

FreeIPA Node Gateway не работает в чистом Worker; для production используйте
внешний прокси или разверните gateway отдельно.

### Docker

```bash
docker compose up -d --build
docker compose down
```

Контейнер работает от не-root, только для чтения, сбрасывает capabilities.
Том `dashboard-data` сохраняет D1 между перезапусками.

## RBAC и безопасность

По умолчанию все аутентифицированные пользователи получают роль `admin`.
Для production назначьте роли через `PORTAL_RBAC_JSON`:

```bash
PORTAL_RBAC_JSON={"admin@company.local":"admin","ops@company.local":"operator","audit@company.local":"viewer"}
PORTAL_DEFAULT_ROLE=viewer
```

Идентичность берется из заголовка `oai-authenticated-user-email`, который
внедряет платформа Sites или обратный прокси. Если заголовок отсутствует,
используется `portal-user`.

Пароли FreeIPA и ключи XYOps хранятся в D1 зашифрованными AES-256-GCM.
Браузер никогда не получает сырые секреты. Пустые поля в форме настроек
сохраняют текущее значение.

Секретные endpoint настроек и маршрутов требуют заголовок
`x-admin-token` с SHA-256 хешем `ADMIN_TOKEN`.

## Troubleshooting

### FreeIPA: TLS error

Если FreeIPA использует самоподписанный сертификат, добавьте CA в
доверенные Node.js внутри контейнера:

```bash
# В Dockerfile или derived image:
COPY company-ca.pem /usr/local/share/ca-certificates/
RUN update-ca-certificates
```

Или для локального запуска:

```bash
NODE_EXTRA_CA_CERTS=/path/to/company-ca.pem npm run start:docker
```

Никогда не отключайте `IPA_VERIFY_TLS` в production.

### XYOps: 502/timeout

Проверьте сетевую доступность из контейнера/Worker:

```bash
curl -v https://xyops.company.local/api/app/get_events/v1
```

Убедитесь, что API-ключ валиден и имеет права на `get_events`, `run_event`,
`get_active_jobs`.

### D1: миграции

Миграции Drizzle хранятся в `drizzle/`. Для применения новых миграций
используйте `npm run db:generate` локально, а в продакшене обновите
артефакт развертывания.

### Контейнер: port 3001 занят

Остановите конфликтующий сервис или измените `DASHBOARD_PORT` в `.env`
и сопоставьте порт в `compose.yaml`.

