# P0 — автоматическая эксплуатационная приёмка

Runner `scripts/p0-operational-acceptance.mjs` дополняет ручной сценарий из `LOCAL_ACCEPTANCE_TESTS.md` и проверяет критичные свойства локальной аутентификации на реально запущенном портале.

## Что проверяется

- доступность `/api/integrations/health`;
- вход bootstrap-администратора;
- наличие у session cookie атрибутов `HttpOnly` и `SameSite=Strict`;
- фактическая роль `admin` у bootstrap-учётной записи;
- создание временного пользователя `viewer`;
- временная блокировка после пяти неверных паролей;
- запрет входа с правильным паролем, пока действует блокировка;
- ручная разблокировка администратором;
- успешный вход после разблокировки;
- опциональный перезапуск контейнера Dashboard;
- сохранение пользователя, его ID, роли и пароля после перезапуска;
- автоматическое удаление временного пользователя;
- redaction паролей и session cookie в JSON/HTML-отчётах.

Runner не изменяет пользователей FreeIPA и не запускает процессы XYOps. Эти проверки выполняются отдельным интеграционным сценарием `npm run test:local`.

## Подготовка

Портал должен быть запущен в режиме локальной аутентификации:

```env
PORTAL_IDENTITY_MODE=local
PORTAL_BOOTSTRAP_ADMIN_USERNAME=admin
PORTAL_BOOTSTRAP_ADMIN_PASSWORD=<текущий пароль администратора>
```

Создайте отдельный файл параметров runner:

```bash
cp .env.local-auth-acceptance.example .env.local-auth-acceptance
```

Впишите текущий пароль bootstrap-администратора. Файл `.env.local-auth-acceptance` исключён из Git и не должен коммититься.

## Запуск без перезапуска Docker

```bash
set -a
source .env.local-auth-acceptance
set +a

PORTAL_TEST_RESTART_DASHBOARD=false npm run test:p0:acceptance
```

В этом режиме проверяются вход, cookie, блокировка и разблокировка. Проверка персистентности будет отмечена как `skipped`.

## Полный P0-прогон с перезапуском

Проверьте параметры:

```env
PORTAL_TEST_RESTART_DASHBOARD=true
PORTAL_TEST_COMPOSE_FILE=compose.yaml
PORTAL_TEST_COMPOSE_ENV_FILE=.env
PORTAL_TEST_COMPOSE_SERVICE=dashboard
PORTAL_TEST_RESTART_TIMEOUT_MS=120000
```

Запуск:

```bash
set -a
source .env.local-auth-acceptance
set +a

npm run test:p0:acceptance
```

Runner выполнит команду, эквивалентную:

```bash
docker compose --env-file .env -f compose.yaml restart dashboard
```

После восстановления `/api/integrations/health` runner повторно войдёт администратором и проверит сохранённого тестового пользователя.

## Артефакты

```text
artifacts/p0-operational-acceptance/latest.json
artifacts/p0-operational-acceptance/<run-id>/report.json
artifacts/p0-operational-acceptance/<run-id>/report.html
```

Отчёт не должен содержать:

- пароль администратора;
- сгенерированный пароль тестового пользователя;
- неправильный тестовый пароль;
- значение `portal_session`;
- заголовки `Cookie` или `Set-Cookie` целиком.

## Что остаётся ручным

После успешного runner всё ещё требуется браузерная проверка интерфейса ролей `viewer`, `operator`, `admin`, а также реальный тест FreeIPA CRUD и полного жизненного цикла безопасного процесса XYOps.
