# AI agent entrypoint

Этот документ — обязательная точка входа для ИИ-агентов, работающих с Admin Dashboard Softrust. Он не заменяет обычную инженерную документацию, а задаёт порядок чтения, правила достоверности и координацию при параллельной работе нескольких агентов.

## Обязательный порядок чтения

Перед любым изменением:

1. прочитать корневой [`README.md`](../../README.md);
2. прочитать [`docs/README.md`](../README.md);
3. прочитать [`ARCHITECTURE.md`](../ARCHITECTURE.md) — фактическая runtime/trust/data topology;
4. прочитать [`PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md) — module ownership и where-to-change routing;
5. прочитать [`DOCUMENTATION_POLICY.md`](../DOCUMENTATION_POLICY.md);
6. проверить [`SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md);
7. для security-sensitive изменения прочитать [`SECURITY_MODEL.md`](../SECURITY_MODEL.md) до проектирования нового privileged/trust boundary;
8. если изменение затрагивает HTTP route/method/auth boundary — свериться с [`reference/API.md`](../reference/API.md);
9. если изменение затрагивает role/permission — свериться с [`reference/PERMISSIONS.md`](../reference/PERMISSIONS.md) и canonical `src/auth/portal-permissions.ts`;
10. если изменение затрагивает ENV/dynamic/recovery configuration — свериться с [`reference/CONFIGURATION.md`](../reference/CONFIGURATION.md);
11. если изменение вводит/меняет stable machine-readable code — свериться с [`reference/ERROR_CODES.md`](../reference/ERROR_CODES.md);
12. прочитать профильный active-document затрагиваемого домена;
13. проверить актуальный код и tests текущего `main`/целевого ref;
14. проверить связанные открытые PR/Issues, если они влияют на ownership или параллельную работу.

Нельзя начинать с issue и затем предполагать, что описанное в issue уже реализовано.

## Как определить owner изменения

Перед созданием нового файла, сервиса, route или abstraction ответьте:

- какой домен владеет данными;
- где находится текущий source of truth;
- существует ли уже аналогичная реализация;
- какой layer/path должен владеть изменением по [`PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md);
- какой active-document описывает контракт;
- какой normalized reference затронут;
- какие tests доказывают поведение;
- не меняет ли работа shared security/runtime boundary.

Если owner неясен, это сначала architecture/documentation problem. Не создавайте второй owner только ради завершения локальной задачи.

Если изменение затрагивает identity, authorization, secrets, upstream credentials, audit, approvals, maintenance/recovery, schema fail-closed behavior или diagnostic disclosure, дополнительно сверяйтесь с [`SECURITY_MODEL.md`](../SECURITY_MODEL.md) и точным профильным security/runbook owner.

Normalized `reference/*` — навигационный current-state слой, а не второй runtime source of truth. При конфликте проверяйте canonical owner и его tests, затем исправляйте reference drift.

## Иерархия доверия

При конфликте источников:

1. фактический код, canonical registries/schema и tests текущего ref;
2. `SOURCE_OF_TRUTH.md` и указанный там authoritative owner;
3. active профильный contract/runbook;
4. normalized `reference/*`, подтверждённый canonical owners;
5. `ARCHITECTURE.md`, `PROJECT_STRUCTURE.md`, `SECURITY_MODEL.md` и overview docs;
6. ADR как объяснение решения;
7. issue, plan, PR description, historical notes.

Issue, roadmap и implementation plan не являются доказательством current behavior.

## Правила изменения кода

- не создавать второй способ делать то, что уже имеет owner;
- не создавать второй API/RBAC/config/error-code registry только ради локальной задачи;
- не расширять scope незаметным рефакторингом unrelated modules;
- не переносить authorization или security enforcement только в UI;
- не ослаблять fail-closed gates, redaction, encryption, same-origin, approvals или audit ради упрощения tests;
- не превращать `ADMIN_TOKEN`, maintenance/recovery credentials или integration credentials в generic admin bypass;
- не выдавать FreeIPA/XYOps credentials, cookies/session material или private Gateway token в browser/API response;
- сохранять backward compatibility либо документировать и тестировать migration path;
- для security-critical fix сначала фиксировать воспроизводимое поведение test/contract там, где это возможно;
- не использовать `any`, source-text guards или mocks как замену реальному behavior test там, где важна runtime semantics;
- перед созданием нового UI primitive/token проверить `app/ui/` и `app/styles/`;
- перед созданием нового server/integration/storage owner свериться с `PROJECT_STRUCTURE.md` и `SOURCE_OF_TRUTH.md`.

## Reference-layer routing

### API

При добавлении/изменении route:

1. изменить canonical handler/contract/test;
2. проверить authorization/method/failure semantics;
3. обновить [`reference/API.md`](../reference/API.md);
4. обновить [`reference/PERMISSIONS.md`](../reference/PERMISSIONS.md) только если реально меняется permission contract;
5. обновить [`reference/ERROR_CODES.md`](../reference/ERROR_CODES.md), если меняются stable machine codes.

Не используйте `/api/integrations/routes` как глобальный HTTP registry: это XYOps routing configuration. Canonical machine-readable HTTP route metadata живёт в `src/auth/portal-route-contract.ts`; runtime dispatch по-прежнему остаётся в текущих Worker handlers/wrappers.

### Permissions

Canonical built-in role/permission registry — `src/auth/portal-permissions.ts`. [`reference/PERMISSIONS.md`](../reference/PERMISSIONS.md) должен его отражать, но не заменять.

Canonical built-in RBAC ownership консолидирован в `src/auth/portal-permissions.ts`. Не создавайте route-local permission vocabulary; если route требует отсутствующий permission, изменяйте canonical registry и behavior tests явно.

### Configuration

[`reference/CONFIGURATION.md`](../reference/CONFIGURATION.md) отделяет supported operator configuration от internal ephemeral/test/recovery values. Не превращайте любое `process.env.*` в public configuration contract.

Особенно: private FreeIPA Gateway URL/token генерируются startup runtime и не должны становиться persistent operator secrets.

Machine-readable supported configuration contract остаётся отдельной задачей #123.

### Error codes

[`reference/ERROR_CODES.md`](../reference/ERROR_CODES.md) содержит stable machine-readable codes, а не human error messages и не audit action names.

Если код вводит новый stable code, обновите owner tests и reference в одном PR. Global consolidation остаётся отдельной задачей #124.

## Параллельная работа нескольких агентов

### Один contract — один активный owner

Два агента не должны независимо менять один и тот же canonical contract (schema, permission model, route boundary, auth mechanism, backup format, maintenance state machine) без явной координации.

Если обнаружен пересекающийся PR:

- не создавать альтернативную реализацию;
- определить dependency/ordering;
- по возможности перенести свой PR на независимый scope;
- зафиксировать зависимость в issue/PR.

### Узкие ветки и PR

Рекомендуемый формат ветки:

```text
agent/<short-scope>
```

Один PR должен быть mergeable и понятен сам по себе. Большие refactor issues следует делить на slices, которые сохраняют рабочий runtime после каждого merge.

### Coordination contract для PR

До первого изменения агент заполняет coordination scope будущего PR и поддерживает его актуальным до merge:

- `Owning issue` — Issue, который задаёт scope; если отдельного Issue действительно нет, явно указать `none` и объяснить основание в Summary;
- `Canonical domain / contract` — существующий runtime/document owner из code, [`SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md) или профильного active-document;
- `High-conflict paths` — ожидаемые shared/canonical paths либо явное `none`;
- `Dependencies / merge order` — blocking/stacked PR и точный порядок merge либо явное `none`;
- `Parallel-safe with` — известная независимая работа либо `none identified` после проверки;
- `Explicitly out of scope` — соседние contracts, которые этот PR не меняет.

Перед реализацией нужно проверить не только открытые PR, но и активные remote branches, если PR ещё не создан. Если обнаружено пересечение, агент не начинает вторую реализацию: он сужает scope, фиксирует dependency/merge order либо ждёт завершения текущего owner. Эти поля являются coordination evidence, а не новым source of truth и не дают ownership только потому, что записаны в PR.

### Shared/high-conflict files

Перед изменением `app/page.tsx`, `worker/index.ts`, canonical schema/migrations, auth/RBAC owners, CI workflows или documentation-governance файлов обязательно проверить активные PR. Если другой PR сдвинул `main`, финальная verification должна выполняться на обновлённом exact candidate head.

### Не использовать документацию как lock

Сам факт того, что агент начал редактировать документ, не означает ownership кода. Ownership определяется canonical contract и согласованным issue/PR scope.

## Документация в каждом изменении

Перед завершением PR проверьте:

- изменился ли API;
- изменились ли permissions/auth;
- изменились ли schema/data ownership;
- изменилась ли конфигурация;
- изменился ли stable machine-readable error code;
- изменился ли deployment/runtime;
- изменился ли security/failure/recovery contract;
- изменилась ли module boundary/project placement;
- устарел ли существующий пример или runbook;
- появился ли новый термин/decision, который нужно оформить.

Следуйте [`DOCUMENTATION_POLICY.md`](../DOCUMENTATION_POLICY.md). Не создавайте новый Markdown-файл, если существующий документ уже владеет темой.

Если изменена system topology/trust boundary — актуализируйте [`ARCHITECTURE.md`](../ARCHITECTURE.md). Если изменился module/path ownership — актуализируйте [`PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md). Если изменился security trust/identity/secret/authorization/recovery boundary — актуализируйте [`SECURITY_MODEL.md`](../SECURITY_MODEL.md) и профильный exact contract.

Если изменился route/permission/config/stable-code contract — актуализируйте соответствующий файл в [`../reference/`](../reference/).

## Current state vs plan

Разделяйте формулировки:

- **реализовано сейчас** — подтверждено кодом/tests текущего ref;
- **documented contract** — active документ соответствует runtime;
- **planned** — существует issue/plan, но implementation не подтверждён;
- **historical** — относится к предыдущей архитектуре/release.

Нельзя писать «портал делает X» только потому, что Issue требует X. Draft/open PR также не является current runtime до merge в целевой ref.

## Security и secret hygiene

Не помещайте в код, docs, fixtures, PR body, screenshots, logs или artifacts реальные:

- пароли;
- API keys;
- `ADMIN_TOKEN`;
- `CONFIG_ENCRYPTION_KEY`;
- cookies/session tokens;
- FreeIPA session material;
- backup/controller/stage/recovery secrets;
- internal URLs/hostnames, если они не предназначены для публикации;
- персональные данные.

Используйте sanitized fixtures и очевидные placeholders.

Для security-sensitive изменения дополнительно проверьте инварианты [`SECURITY_MODEL.md`](../SECURITY_MODEL.md): server-side authorization, upstream-secret isolation, purpose-specific privileged credentials, redaction и fail-closed recovery/schema boundaries.

## Проверка перед завершением задачи

Минимальный self-review:

1. scope соответствует issue;
2. не создан дублирующий owner/abstraction/registry;
3. изменение находится в правильном layer/path;
4. permission/security boundaries остались server-side;
5. privileged credentials не стали generic bypass;
6. upstream/session secrets не появились в browser/logs/diagnostics;
7. failure semantics понятны и протестированы;
8. актуальные docs и затронутый normalized reference обновлены;
9. `ARCHITECTURE.md`/`PROJECT_STRUCTURE.md`/`SECURITY_MODEL.md` обновлены, если затронуты их boundaries;
10. superseded statements удалены;
11. paths/links действительно существуют;
12. test/build/lint команды выполнены настолько полно, насколько позволяет scope;
13. PR содержит evidence и known gaps без ложного claim о полном покрытии.

## Документальные задачи

При работе только с документацией дополнительно:

- проверяйте каждое current-state утверждение против текущего `main`;
- не создавайте ссылку на planned-файл, пока он не существует;
- не используйте плавающие числа тестов как долгоживущий факт;
- не переписывайте runtime semantics «для красоты»;
- если найдено расхождение docs и runtime, зафиксируйте его как дефект и исправьте в согласованном scope;
- не отмечайте документ `verified-active`, пока его фактические owners/boundaries не проверены;
- reference-layer документ не должен превращаться в конкурирующий runtime registry.

## Куда смотреть дальше

- [`../README.md`](../README.md) — навигация;
- [`../ARCHITECTURE.md`](../ARCHITECTURE.md) — current runtime architecture;
- [`../PROJECT_STRUCTURE.md`](../PROJECT_STRUCTURE.md) — current repository/module map;
- [`../SECURITY_MODEL.md`](../SECURITY_MODEL.md) — current security/trust model;
- [`../reference/API.md`](../reference/API.md) — normalized route reference;
- [`../reference/PERMISSIONS.md`](../reference/PERMISSIONS.md) — normalized canonical RBAC reference;
- [`../reference/CONFIGURATION.md`](../reference/CONFIGURATION.md) — supported configuration classes;
- [`../reference/ERROR_CODES.md`](../reference/ERROR_CODES.md) — stable machine-code reference;
- [`../SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md) — authoritative owners;
- [`../GLOSSARY.md`](../GLOSSARY.md) — терминология;
- профильные runbook — фактические operational/security contracts.

Если architecture/project/security/reference map и текущий код расходятся, не выдумывайте новое boundary: проверьте current ref/canonical owner и исправьте подтверждённый documentation drift.
