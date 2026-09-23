# Локальные acceptance-тесты

Этот сценарий проверяет портал на реальной локальной сборке без облачных сервисов.

## 1. Подготовка

Используйте тестовые FreeIPA и XYOps. Не запускайте мутационные проверки на рабочих пользователях и процессах.

```bash
git pull
cp .env.example .env
```

Укажите в `.env`:

```env
PORTAL_IDENTITY_MODE=local
PORTAL_BOOTSTRAP_ADMIN_USERNAME=admin
PORTAL_BOOTSTRAP_ADMIN_PASSWORD=<надежный пароль>
PORTAL_BOOTSTRAP_ADMIN_NAME=Локальный администратор
PORTAL_SESSION_TTL_HOURS=12

IPA_URL=<тестовый FreeIPA>
IPA_USERNAME=<тестовый сервисный пользователь>
IPA_PASSWORD=<пароль>

XYOPS_URL=<тестовый XYOps>
XYOPS_API_KEY=<тестовый API key>
```

Для полностью чистого **disposable acceptance-контура** удалите контейнеры и Compose-owned volumes через сам Compose, а не по вычисленному имени Docker volume:

```bash
docker compose down -v
docker compose up -d --build
docker compose ps
```

`docker compose down -v` удаляет данные текущего Compose project. Не выполняйте эту команду против рабочего или единственного экземпляра портала. Для проверки существующего persistent экземпляра используйте отдельный checkout/project name и отдельный volume.

## 2. Первый вход

1. Откройте `http://localhost:3001`.
2. Убедитесь, что портал перенаправил на `/login`.
3. Войдите bootstrap-администратором.
4. Проверьте отображение имени и роли администратора.
5. Откройте `/access`.

Ожидаемый результат:

- вход успешен;
- cookie `portal_session` имеет `HttpOnly` и `SameSite=Strict`;
- в UI нет паролей, password hashes и session tokens;
- в локальной базе создан ровно один активный администратор.

## 3. Управление ролями

Создайте:

```text
portal-viewer   → viewer
portal-operator → operator
portal-admin2   → admin
```

Для каждой роли выполните отдельный вход.

### viewer

Должен:

- просматривать FreeIPA, каталог и операции.

Не должен:

- изменять FreeIPA;
- запускать XYOps;
- видеть настройки, аудит и управление доступом.

### operator

Должен:

- просматривать данные;
- создавать и изменять тестовые объекты FreeIPA;
- запускать разрешённые процессы XYOps.

Не должен:

- удалять объекты, когда требуется `freeipa.delete`;
- управлять настройками, аудитом и RBAC;
- согласовывать процессы как admin.

### admin

Должен:

- выполнять все операции operator;
- удалять тестовые объекты;
- управлять approvals, настройками, аудитом и RBAC.

## 4. Защита локального входа

### Неверный пароль

1. Пять раз введите неправильный пароль тестового пользователя.
2. Проверьте временную блокировку.
3. Убедитесь, что правильный пароль не разрешает вход до окончания блокировки или ручной разблокировки администратором.

### Смена пароля

1. Войдите тестовым пользователем в отдельном браузере.
2. Администратор меняет ему пароль.
3. Существующая сессия должна перестать работать.
4. Старый пароль не должен подходить.
5. Новый пароль должен работать.

### Последний администратор

Проверьте, что система запрещает:

- удалить последнего активного администратора;
- отключить его;
- сменить его роль на viewer или operator.

После создания второго администратора изменение первого должно стать возможным, кроме изменения собственной текущей учётной записи из активной сессии.

## 5. Персистентность

Создайте пользователей, измените роли и настройте интеграции. Затем:

```bash
docker compose restart
```

После перезапуска должны сохраниться:

- локальные пользователи;
- password hashes;
- роли и блокировки;
- настройки FreeIPA и XYOps;
- операции, approvals, metadata и аудит.

Bootstrap-переменные не должны перезаписать существующего администратора.

## 6. FreeIPA

Используйте префикс `portal-test-`.

Проверьте:

- получение пользователей и групп;
- создание тестового пользователя;
- редактирование имени и email;
- отключение и включение;
- сброс пароля;
- создание группы;
- добавление и удаление membership;
- удаление пользователя и группы;
- обработку неверных credentials и недоступного FreeIPA.

После теста не должно остаться объектов с префиксом `portal-test-`.

## 7. XYOps

Используйте специально выделенный безопасный Event или Workflow.

Проверьте:

- загрузку каталога;
- динамические options;
- запуск процесса;
- получение Job ID;
- переходы queued → running → terminal status;
- success и failed result;
- отмену;
- повтор;
- approval для опасного процесса;
- обработку `409`, `429` и `Retry-After`.

## 8. Автоматический smoke-прогон

Для local-integration smoke используйте canonical fixture:

```bash
cp fixtures/env/local-integration.example .env.test
npm run test:local
```

Проверить Compose-конфигурацию без запуска можно так:

```bash
docker compose --env-file .env.test -f fixtures/compose/local-integration.yaml config >/dev/null
```

Для реальных мутаций включите только в тестовой среде:

```env
LOCAL_TEST_MUTATIONS=true
LOCAL_TEST_CONFIRM_MUTATIONS=YES
LOCAL_TEST_FREEIPA_MUTATIONS=true
```

Для тестового запуска XYOps:

```env
LOCAL_TEST_XYOPS_RUN=true
LOCAL_TEST_XYOPS_EVENT_ID=<безопасный тестовый процесс>
LOCAL_TEST_XYOPS_VALUES_JSON={"message":"local acceptance smoke"}
LOCAL_TEST_XYOPS_WAIT_TERMINAL=true
```

Для отдельного автоматического local-auth acceptance против уже запущенного изолированного портала используйте его собственный fixture:

```bash
cp fixtures/env/local-auth-acceptance.example .env.local-auth-acceptance
set -a
. ./.env.local-auth-acceptance
set +a
npm run test:local-auth:acceptance
```

Перед запуском замените `PORTAL_TEST_ADMIN_PASSWORD` на пароль текущего локального администратора и убедитесь, что `PORTAL_TEST_BASE_URL` указывает только на disposable/test-контур.

Для P0-проверки персистентности используйте тот же изолированный fixture и отдельный runner:

```bash
set -a
. ./.env.local-auth-acceptance
set +a
npm run test:p0:acceptance
```

При `PORTAL_TEST_RESTART_DASHBOARD=true` runner создаёт временного viewer, проверяет lock/unlock и login, перезапускает только Dashboard service, затем повторно проверяет пользователя, роль и login. При `PORTAL_TEST_RECREATE_DASHBOARD=true` после этого выполняется `docker compose up -d --no-build --force-recreate dashboard` и та же persisted-state проверка повторяется. Временный пользователь удаляется в cleanup. Не запускайте этот P0 runner против production.

## 9. Результаты

Проверьте:

```text
artifacts/local-integration/latest.json
artifacts/local-integration/<run-id>/report.json
artifacts/local-integration/<run-id>/report.html
artifacts/local-integration/compose.log
```

Отчёт не должен содержать:

- пароли;
- API keys;
- `ADMIN_TOKEN`;
- `CONFIG_ENCRYPTION_KEY`;
- session tokens;
- необработанные upstream bodies с секретами.

## 10. Критерий прохождения

Acceptance считается пройденным, когда:

- локальная аутентификация работает после перезапуска;
- серверная RBAC-матрица фактически ограничивает действия;
- FreeIPA CRUD и membership работают на тестовых объектах;
- тестовый XYOps процесс проходит полный жизненный цикл;
- аудит содержит действия с correlation ID;
- в логах, браузере и отчётах нет секретов.


## 11. Production/staging acceptance manifest

Release-level acceptance from #61 starts with an immutable image reference instead of a mutable tag. Generate the non-destructive execution plan with:

```bash
node scripts/production-acceptance-plan.mjs \
  --image harbor.example.invalid/portal/admin-dashboard@sha256:<64-hex-digest> \
  --commit <40-hex-git-sha>
```

The command only creates `artifacts/production-acceptance/plan.json`; it does **not** start containers and does not mutate portal data. The plan fixes:

- the exact image digest;
- the exact source commit;
- an isolated Compose project name derived from the digest;
- the Compose-owned isolated `dashboard-data` volume name;
- `--no-build` execution semantics so a release run cannot silently rebuild a different image;
- the default read-only baseline: healthy liveness/readiness, healthy dependencies and explicitly inactive maintenance. A `503`, degraded dependency payload or active/failed maintenance state is a release-blocking baseline failure, not an accepted degraded pass.

The generated plan records both `PORTAL_IMAGE` and `PORTAL_SERVICE_ENV_FILE=.env.acceptance`.
Before any later execution step, create `.env.acceptance` from the normal environment template and replace all credentials with dedicated staging/test values. Do not reuse a production `.env`.

`compose.yaml` accepts `PORTAL_IMAGE` and `PORTAL_SERVICE_ENV_FILE` overrides while preserving `freeipa-admin-dashboard:local` and `.env` as the local-development defaults. This distinction is required because Compose `--env-file` controls variable interpolation but does not by itself replace a service-level `env_file`; the acceptance executor must apply the environment recorded in the manifest.

The production-acceptance report contract is fail-closed: sensitive field names, cookie/authorization markers, caller-provided secret values and raw HTTP(S) URLs make the redaction gate fail. Later #61 checkpoints may execute the plan and attach JSON/HTML release evidence, but must pass this safety gate before persisting artifacts.

Mutating P0/local integration runners remain separate and keep their existing explicit confirmation requirements.

## 12. Safe read-only production/staging executor

After generating the immutable plan from section 11, prepare a dedicated `.env.acceptance` with test/staging credentials and run the bounded read-only executor:

```bash
node scripts/production-acceptance-executor.mjs \
  --plan artifacts/production-acceptance/plan.json \
  --base-url http://127.0.0.1:3001
```

The executor:

- accepts only the exact versioned read-only manifest contract generated by `production-acceptance-plan.mjs`;
- starts the isolated Compose project with the immutable image and the manifest's `--no-build` command;
- polls the four declared baseline checks until they all satisfy both HTTP status and required JSON predicates, or until the bounded startup timeout expires;
- always runs `docker compose ... down --volumes --remove-orphans` for the isolated acceptance project, including partial-start and failed-baseline paths;
- never stores raw probe bodies, command stderr, credentials or target URLs in release evidence;
- runs the blocking report-safety gate before writing `report.json` and `report.html`;
- returns a non-zero exit code when the baseline or cleanup fails;
- records explicit `compose_start`, `baseline` and `cleanup` stage outcomes (`passed` / `failed` / `skipped`) with bounded machine-readable remediation codes;
- records the same report schema version, failure/remediation codes and stage evidence in JSON and HTML.

Default release evidence keeps both a stable latest copy and bounded per-run history:

```text
artifacts/production-acceptance/latest/report.json
artifacts/production-acceptance/latest/report.html
artifacts/production-acceptance/runs/<run-id>/report.json
artifacts/production-acceptance/runs/<run-id>/report.html
```

Managed run directories are retained for 604800 seconds (7 days) by default. Change the bounded retention window when needed:

```bash
node scripts/production-acceptance-executor.mjs \
  --retention-seconds 259200
```

Only managed timestamp-shaped run directories below the history directory are pruned; unrelated files/directories are left untouched.

Optional execution bounds:

```bash
node scripts/production-acceptance-executor.mjs \
  --startup-timeout-ms 90000 \
  --probe-interval-ms 1500
```

`--base-url` is runtime-only input and is deliberately omitted from persisted evidence. It is **not** a remote-staging URL: this executor always starts its own isolated local Compose project, so only loopback HTTP targets are accepted. `127.0.0.1`, `localhost` and IPv6 loopback input normalize to the local IPv4 publication; credentials, HTTPS, query/hash values and non-root paths are rejected before Docker starts. The runner also overrides any ambient `DASHBOARD_BIND_ADDRESS` / `DASHBOARD_PORT` values so the disposable dashboard is published only on `127.0.0.1` and on the same port used by the acceptance probes.

The executor is still **read-only baseline only**: it does not run FreeIPA/XYOps mutations, destructive P0 scenarios, restore/upgrade checks or release-exception logic.

