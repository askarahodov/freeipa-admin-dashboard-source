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
- управление ролями `viewer`, `operator` и `admin` через UI.

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
- удаление пользователя в одной системе не удаляет его в другой.

## Роли и права

| Роль | Права |
|---|---|
| `viewer` | просмотр каталога, FreeIPA, операций и собственных уведомлений |
| `operator` | права viewer, изменения FreeIPA и запуск XYOps |
| `admin` | все права, удаление объектов, согласования, настройки, аудит и RBAC |

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
- изменения RBAC записываются в append-only аудит.

Подробности: [docs/LOCAL_AUTH_RBAC.md](docs/LOCAL_AUTH_RBAC.md).

## Архитектура

- **Frontend:** React и Vinext, каталог `app/`;
- **Backend:** Worker API в `worker/`;
- **Локальный runtime:** Wrangler/Workerd внутри контейнера;
- **Хранилище:** локальная D1/SQLite-совместимая база в Docker volume;
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

### Состояние и настройки

```text
GET  /api/integrations/health
GET  /api/integrations/status
GET  /api/integrations/settings
PUT  /api/integrations/settings
POST /api/integrations/settings/test
```

Часть критичных endpoint дополнительно использует `ADMIN_TOKEN`. Он остаётся серверным секретом и не заменяет пользовательскую RBAC-проверку.

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
- [Дорожная карта](docs/PRODUCT_ROADMAP.md)
- [Контракт XYOps](docs/XYOPS_EXECUTION_OWNERSHIP.md)
- [Инспектор XYOps](docs/XYOPS_INSPECTOR.md)
- [Презентационные метаданные](docs/PROCESS_PRESENTATION_METADATA.md)
- [Аудит](docs/AUDIT_LOG.md)

## Резервное копирование

Для резервного копирования остановите контейнер и сохраните содержимое volume `dashboard-data`. В резервную копию входят локальные пользователи, роли, сессии, настройки, история операций, approvals, метаданные и аудит.

Пароли FreeIPA, ключ XYOps и другие секреты внутри базы зашифрованы ключом `CONFIG_ENCRYPTION_KEY`. Этот ключ необходимо хранить отдельно от резервной копии базы.