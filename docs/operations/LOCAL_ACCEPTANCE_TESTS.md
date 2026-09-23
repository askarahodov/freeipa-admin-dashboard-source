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

При `PORTAL_TEST_RESTART_DASHBOARD=true` runner создаёт временного viewer, проверяет lock/unlock и login, перезапускает только Dashboard service, затем повторно проверяет пользователя, роль и login.

Recreate — отдельная более строгая release-acceptance проверка. Перед её включением используйте dedicated `.env.acceptance`, укажите exact digest image и включите флаг:

```env
PORTAL_TEST_RECREATE_DASHBOARD=true
PORTAL_TEST_ACCEPTANCE_IMAGE=harbor.example.invalid/portal/admin-dashboard@sha256:<64-hex-digest>
PORTAL_TEST_COMPOSE_ENV_FILE=.env.acceptance
```

Для recreate runner сам выводит тот же `portal-accept-<digest-prefix>` Compose project, передаёт `PORTAL_IMAGE` и `PORTAL_SERVICE_ENV_FILE` как authoritative overrides и выполняет `docker compose ... up -d --no-deps --no-build --force-recreate dashboard`. Поэтому проверка не может незаметно пересобрать или подменить immutable release image и не пересоздаёт зависимости/volume. После recreate снова проверяются временный пользователь, роль и login. Временный пользователь удаляется в cleanup. Не запускайте этот P0 runner против production.

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
- the default read-only baseline: healthy liveness/readiness, healthy dependencies and explicitly inactive maintenance. A `503`, degraded dependency payload or active/failed maintenance state is a release-blocking baseline failure, not an accepted degraded pass;
- readiness must expose integer `metadata.schemaVersion` and `metadata.latestSchemaVersion`, and both values must match. Missing or behind schema metadata is release-blocking evidence rather than an implicit pass.

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
- records the report/manifest schema versions, observed portal schema current/latest versions, failure/remediation codes and stage evidence consistently in JSON and HTML.

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

Without `--run-local-auth-p0`, the executor remains **read-only baseline only**. Local auth/RBAC/P0 mutations are an explicit opt-in checkpoint described below. FreeIPA/XYOps mutations, restore/upgrade checks and release-exception logic remain out of scope.



## 13. Opt-in local-auth/RBAC/P0 release scenarios

The production acceptance executor can reuse the canonical local-auth and P0 runners while keeping the same immutable isolated Compose project alive. This mode mutates only the disposable portal user database and is disabled by default.

Provide dedicated acceptance administrator credentials in the caller environment:

```bash
export PORTAL_ACCEPTANCE_ADMIN_USERNAME=<dedicated-test-admin>
export PORTAL_ACCEPTANCE_ADMIN_PASSWORD=<dedicated-test-password>
```

Then require **two independent confirmations**:

1. explicit destructive confirmation `YES`;
2. the exact digest-derived Compose project name printed by the plan, for example `portal-accept-0123456789ab`.

```bash
node scripts/production-acceptance-executor.mjs \
  --plan artifacts/production-acceptance/plan.json \
  --base-url http://127.0.0.1:3001 \
  --run-local-auth-p0 \
  --confirm-destructive YES \
  --confirm-project portal-accept-0123456789ab
```

Both confirmations and the dedicated admin credentials are validated **before Compose starts**. A missing/wrong confirmation fails closed.

The executor does not duplicate auth/RBAC/P0 behavior. It invokes the existing canonical owners in order:

```text
scripts/local-auth-acceptance.mjs
scripts/p0-operational-acceptance.mjs
```

The child runners receive the normalized loopback target and `PORTAL_TEST_CONFIRM=YES`. Their restart/recreate flags are forcibly disabled in this orchestration mode because persistence/recreate is owned by Checkpoint C; the production executor remains the only owner of the isolated Compose lifecycle and final volume cleanup.

Production release evidence stores only bounded scenario stage results such as `local_auth_rbac_passed` or `acceptance_p0_operational_failed`; child stdout/stderr, cookies, passwords and raw responses are not copied into the production report. If either scenario fails, later mutation scenarios stop and the isolated Compose cleanup still executes from the executor's `finally` path.

This mode is still not permission to run against production. The production acceptance target is loopback-only and the Compose project is digest-derived and isolated. FreeIPA acceptance is documented in section 15; XYOps mutation scenarios remain a later checkpoint.


## 14. Opt-in settings persistence and rollback acceptance

Settings release acceptance is a separate opt-in mutation stage. It uses the same isolated immutable Compose project and the same double-confirmation boundary as section 13.

Run it alone:

```bash
node scripts/production-acceptance-executor.mjs \
  --plan artifacts/production-acceptance/plan.json \
  --base-url http://127.0.0.1:3001 \
  --run-settings \
  --confirm-destructive YES \
  --confirm-project portal-accept-0123456789ab
```

The caller must also provide the same dedicated local acceptance administrator credentials:

```bash
export PORTAL_ACCEPTANCE_ADMIN_USERNAME=<dedicated-test-admin>
export PORTAL_ACCEPTANCE_ADMIN_PASSWORD=<dedicated-test-password>
```

`--run-settings` does not enable `--run-local-auth-p0` implicitly. Both flags may be supplied when one acceptance run should execute all internal portal-state mutation stages.

The settings stage deliberately mutates only the non-secret `demoMode` field through the canonical revisioned settings lifecycle:

1. read `/api/integrations/settings/effective` and capture the current revision, value and source;
2. create a draft that toggles `demoMode`;
3. validate it with an explicit empty service list so this checkpoint does not probe or mutate FreeIPA/XYOps;
4. apply the draft;
5. read effective settings again and require a newer revision, the changed value and database persistence;
6. in `finally`, create and apply a rollback draft;
7. require both the original value and the original source (`database`, `environment` or `default`) to be restored.

If the initial value came from ENV/default, rollback uses the existing `resetFields` lifecycle instead of writing a synthetic database override. If the initial value was already a database override, rollback writes back the original boolean while preserving database ownership.

A failed persistence read still triggers rollback. Any rollback mismatch or rollback API failure is release-blocking. Production release evidence receives only the bounded `settings_persistence_rollback` stage with safe success/failure/remediation codes; settings payloads, session cookies and credentials are not copied into the release report.

The settings runner is loopback-only and requires `PORTAL_TEST_CONFIRM=YES` from the production orchestrator. It does not own Compose restart/recreate; final isolated-project and volume cleanup remains owned by the production acceptance executor.


## 15. FreeIPA read and opt-in CRUD/membership acceptance

FreeIPA release acceptance is split into a safe read stage and a separately confirmed mutation stage. Both act **through the portal's canonical FreeIPA HTTP/API owner**; the acceptance runner does not implement FreeIPA JSON-RPC itself and never receives the upstream FreeIPA URL or service-account credential.

The service environment used by the isolated acceptance Compose project must point to a dedicated non-production FreeIPA test instance when mutation mode is used. Do not enable FreeIPA mutation acceptance against production.

### Read-only FreeIPA acceptance

The read stage is opt-in but does not require destructive confirmation:

```bash
node scripts/production-acceptance-executor.mjs \
  --plan artifacts/production-acceptance/plan.json \
  --base-url http://127.0.0.1:3001 \
  --run-freeipa-read
```

Dedicated local portal administrator credentials are still required so the runner can authenticate to the isolated portal:

```bash
export PORTAL_ACCEPTANCE_ADMIN_USERNAME=<dedicated-test-admin>
export PORTAL_ACCEPTANCE_ADMIN_PASSWORD=<dedicated-test-password>
```

The read stage requires:

- integration status to report FreeIPA as configured and reachable in live mode;
- `GET /api/integrations/users` to return the canonical live users envelope;
- `GET /api/integrations/groups` to return the canonical live groups envelope.

No upstream URL, identity list or directory object is copied into production release evidence. The stage records only `freeipa_read` plus bounded pass/fail/remediation codes.

### Opt-in FreeIPA CRUD and membership acceptance

Mutation mode automatically runs the safe read stage first and then the CRUD/membership stage. It requires the same two independent mutation confirmations used by other destructive acceptance scenarios:

```bash
node scripts/production-acceptance-executor.mjs \
  --plan artifacts/production-acceptance/plan.json \
  --base-url http://127.0.0.1:3001 \
  --run-freeipa-mutations \
  --confirm-destructive YES \
  --confirm-project portal-accept-0123456789ab
```

The mutation stage:

1. proves FreeIPA is live, configured and reachable;
2. derives a unique acceptance namespace from the digest-derived Compose project plus a random run suffix;
3. verifies the generated user/group identifiers do not already exist;
4. creates an acceptance group;
5. creates an acceptance user with a generated temporary credential;
6. updates the user and verifies the canonical users API reflects the update;
7. adds the user to the group and verifies membership through the canonical group-members API;
8. removes the membership and verifies it is absent;
9. in `finally`, deletes the acceptance user and group and verifies they are absent.

Create attempts are treated as potentially committed **before** the request result is known. If a network response is lost after FreeIPA committed an object, cleanup re-reads the directory and removes that object. A pre-existing identifier collision fails before any mutation and is never cleaned up by the runner.

If cleanup cannot prove the acceptance objects were removed, the run is release-blocking. Child stdout/stderr, temporary credentials, directory entries, upstream error bodies and FreeIPA endpoint details are not copied into the release report. Only the bounded `freeipa_crud_membership` stage result is persisted.

`--run-freeipa-read` may be used by itself. `--run-freeipa-mutations` already includes the read stage, so supplying both flags is harmless but unnecessary. FreeIPA acceptance does not own Compose lifecycle; isolated project/volume teardown remains unconditional in the production executor.


## 16. XYOps read and dedicated test-process lifecycle acceptance

XYOps release acceptance is split into a safe read stage and a separately confirmed lifecycle stage. Both communicate only with the isolated loopback portal; the child runner does not receive `XYOPS_URL` or `XYOPS_API_KEY`.

Safe catalog/status validation:

```bash
node scripts/production-acceptance-executor.mjs \
  --plan artifacts/production-acceptance/plan.json \
  --base-url http://127.0.0.1:3001 \
  --run-xyops-read
```

The caller must provide the dedicated portal acceptance administrator credentials used by the other release scenarios. The read stage requires live/configured/reachable XYOps and a canonical catalog response, but it does not launch a process.

The lifecycle stage is mutation-capable and must target an explicitly dedicated non-production XYOps event. The event must be enabled, marked dangerous, expose no input fields and no fixed targets. This intentionally narrow contract prevents the acceptance runner from forwarding arbitrary parameters or selecting an ordinary production process.

Provide a dedicated portal requester account with `xyops.run`, and use the dedicated acceptance administrator as the independent approver. The requester username must differ from the acceptance administrator username (case-insensitive); this is validated before Compose starts:

```bash
export PORTAL_ACCEPTANCE_XYOPS_REQUESTER_USERNAME=<dedicated-test-operator>
export PORTAL_ACCEPTANCE_XYOPS_REQUESTER_PASSWORD=<dedicated-test-password>
export PORTAL_ACCEPTANCE_XYOPS_EVENT_ID=portal-acceptance-event
export PORTAL_ACCEPTANCE_XYOPS_CONFIRM_EVENT_ID=portal-acceptance-event

node scripts/production-acceptance-executor.mjs \
  --plan artifacts/production-acceptance/plan.json \
  --base-url http://127.0.0.1:3001 \
  --run-xyops-lifecycle \
  --confirm-destructive YES \
  --confirm-project portal-accept-0123456789ab
```

The event ID must be entered twice independently and match exactly. The lifecycle verifies two controlled executions:

1. requester creates an approval request, the independent approver approves it, requester executes it, then the resulting active run is cancelled;
2. a second independent approval/execution is allowed to reach terminal success and must expose a sanitized portal result.

Any pending approval or active run left by a partial failure is reconciled in `finally`. The runner snapshots visible approvals/runs before the lifecycle so a lost response after approval creation can be detected as new residue for the confirmed dedicated event without touching pre-existing objects. Failure to prove cleanup is release-blocking. Production release evidence contains only bounded `xyops_read` and `xyops_approval_cancel_result` stage codes. Approval IDs, run IDs, catalog payloads, credentials, upstream URLs/API keys and result bodies are not copied into release evidence.

The dedicated XYOps test event must be provisioned so one invocation remains active long enough for cancellation and another can complete successfully with a result. Do not point this stage at an ordinary or production process.


## 17. Encrypted backup and isolated restore smoke

Checkpoint H adds an opt-in release stage that verifies backup creation and restoreability without committing restored data into the active acceptance database.

```bash
node scripts/production-acceptance-executor.mjs \
  --plan artifacts/production-acceptance/plan.json \
  --base-url http://127.0.0.1:3001 \
  --run-backup-restore-smoke
```

Provide the dedicated acceptance administrator credentials used by the other portal-admin acceptance stages. The child runner talks only to the isolated loopback portal.

The stage snapshots the authenticated administrator identity plus effective settings revision/value/source, creates an encrypted backup across the canonical backup domains, previews it through the canonical encrypted-import endpoint, consumes the returned restore-plan approval token, and runs only the isolated test-restore endpoint. It requires the restore result to report `productionMutated: false` and verifies the portal snapshot remains unchanged afterward.

The backup password is generated inside the child process and is never persisted. The runner never invokes selective restore prepare/commit. Backup payloads, password, approval token, user data, restored contents, cookies and upstream credentials are not copied into release evidence. The production report stores only the bounded `backup_restore_smoke` stage with safe pass/fail/remediation codes.

The restore approval token remains bound to the encrypted backup manifest and to the current state of mutable selected domains. Current `audit` content is intentionally excluded from the stale-state digest because audit is append-only and the export/preview/test-restore operations themselves append audit events; the audit exporter is still read and schema-validated, and the backup-side `audit` manifest entry remains token-bound. This does not enable selective audit restore, which remains unsupported.


## 18. Previous-supported-version upgrade acceptance

Checkpoint I adds an opt-in upgrade smoke for the same digest-derived disposable Compose project and volume used by production acceptance.

The source release is not supplied on the command line. It is owned by the version-controlled policy:

```text
release/previous-supported.json
```

The policy format is versioned. A configured source must contain:

- a bounded release/source identifier;
- the exact 40-hex source commit;
- an immutable image reference in `repository@sha256:<64-hex-digest>` form;
- the expected portal schema version exposed by that source image.

The source image repository must exactly match the target image repository from the generated production-acceptance plan. Mutable tags, a source digest equal to the target digest, a source commit equal to the target commit, malformed schema versions and cross-repository source images fail closed before Docker execution.

The declared source commit is also bound to the immutable image itself. Runtime images intended to participate in upgrade acceptance must be built with:

```bash
docker build --target runtime \
  --build-arg PORTAL_SOURCE_COMMIT=<40-hex-git-sha> \
  ...
```

The runtime image stores that SHA in the standard OCI label `org.opencontainers.image.revision`. After the source digest is started, the upgrade runner inspects the exact digest and requires that label to equal the policy `commitSha` before it performs readiness checks or any portal mutation. A missing, malformed or mismatched revision fails closed; a well-formed but unrelated SHA in the policy cannot certify the image.

The repository currently contains an explicit unconfigured policy:

```json
{
  "schemaVersion": 1,
  "state": "unconfigured",
  "previousSupported": null
}
```

This is intentional. The repository currently has no GitHub Release/tag and CI does not publish a production image to a registry, so there is no honest immutable previous-supported image digest to record. Do not replace the unconfigured state with a guessed digest, a mutable tag, a local Docker image ID or an arbitrary old commit. Populate the policy only when the previous supported production image has actually been published and its source commit/schema are known.

After the policy is configured, run upgrade acceptance as an exclusive scenario:

```bash
node scripts/production-acceptance-executor.mjs \
  --plan artifacts/production-acceptance/plan.json \
  --base-url http://127.0.0.1:3001 \
  --run-upgrade \
  --confirm-destructive YES \
  --confirm-project portal-accept-0123456789ab
```

`release/previous-supported.json` is the only accepted source-policy path; the executor does not expose an arbitrary policy-file override. The dedicated acceptance administrator credentials are required as for other portal mutation scenarios.

Upgrade mode is deliberately exclusive: do not combine `--run-upgrade` with local-auth/P0, settings, FreeIPA, XYOps or backup/restore scenario flags. Upgrade resets only the exact digest-derived disposable acceptance project/volume before seeding source state; combining it with other scenarios would invalidate their state ordering.

The stage performs:

1. remove only the isolated acceptance project containers and volume;
2. start the configured previous-supported image with `--no-build` on that exact project;
3. require healthy source readiness with the policy-declared current/latest schema version;
4. authenticate using the dedicated acceptance administrator;
5. persist a non-secret `demoMode` marker through the canonical settings draft/validate/apply lifecycle;
6. stop only the source dashboard container while preserving the acceptance volume;
7. start the exact target image digest from the acceptance manifest with `--no-deps --no-build --force-recreate`;
8. require target readiness with `currentVersion === latestVersion` and no schema regression below the source version;
9. re-run the strict final target baseline: healthy liveness/readiness/dependencies and inactive maintenance;
10. authenticate again and require the exact settings marker revision/value to survive the upgrade.

The outer production-acceptance executor remains responsible for unconditional final `down --volumes --remove-orphans` cleanup. Source/target image references, source release identifiers, settings payloads, cookies and credentials are not copied into release evidence; the report stores only the bounded `previous_supported_upgrade` stage pass/fail/remediation code.

Until `release/previous-supported.json` is configured from a real immutable published production image, `--run-upgrade` must fail with `acceptance_upgrade_source_unconfigured` before Docker starts. This is a release-readiness blocker, not a skippable successful upgrade.
