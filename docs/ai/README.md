# AI agent entrypoint

Этот документ — обязательная точка входа для ИИ-агентов, работающих с Admin Dashboard Softrust. Он не заменяет обычную инженерную документацию, а задаёт порядок чтения, правила достоверности и координацию при параллельной работе нескольких агентов.

## Обязательный порядок чтения

Перед любым изменением:

1. прочитать корневой [`README.md`](../../README.md);
2. прочитать [`docs/README.md`](../README.md);
3. прочитать [`DOCUMENTATION_POLICY.md`](../DOCUMENTATION_POLICY.md);
4. проверить [`SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md);
5. прочитать профильный active-document затрагиваемого домена;
6. проверить актуальный код и tests текущего `main`/целевого ref;
7. проверить связанные открытые PR/Issues, если они влияют на ownership или параллельную работу.

Нельзя начинать с issue и затем предполагать, что описанное в issue уже реализовано.

## Как определить owner изменения

Перед созданием нового файла, сервиса, route или abstraction ответьте:

- какой домен владеет данными;
- где находится текущий source of truth;
- существует ли уже аналогичная реализация;
- какой active-document описывает контракт;
- какие tests доказывают поведение;
- не меняет ли работа shared security/runtime boundary.

Если owner неясен, это сначала architecture/documentation problem. Не создавайте второй owner только ради завершения локальной задачи.

## Иерархия доверия

При конфликте источников:

1. фактический код, canonical registries/schema и tests текущего ref;
2. `SOURCE_OF_TRUTH.md` и указанный там authoritative owner;
3. active профильный contract/runbook;
4. architecture/overview docs и README;
5. ADR как объяснение решения;
6. issue, plan, PR description, historical notes.

Issue, roadmap и implementation plan не являются доказательством current behavior.

## Правила изменения кода

- не создавать второй способ делать то, что уже имеет owner;
- не расширять scope незаметным рефакторингом unrelated modules;
- не переносить authorization или security enforcement только в UI;
- не ослаблять fail-closed gates, redaction, encryption, same-origin, approvals или audit ради упрощения tests;
- сохранять backward compatibility либо документировать и тестировать migration path;
- для security-critical fix сначала фиксировать воспроизводимое поведение test/contract там, где это возможно;
- не использовать `any`, source-text guards или mocks как замену реальному behavior test там, где важна runtime semantics.

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

### Не использовать документацию как lock

Сам факт того, что агент начал редактировать документ, не означает ownership кода. Ownership определяется canonical contract и согласованным issue/PR scope.

## Документация в каждом изменении

Перед завершением PR проверьте:

- изменился ли API;
- изменились ли permissions/auth;
- изменились ли schema/data ownership;
- изменилась ли конфигурация;
- изменился ли deployment/runtime;
- изменился ли security/failure/recovery contract;
- устарел ли существующий пример или runbook;
- появился ли новый термин/decision, который нужно оформить.

Следуйте [`DOCUMENTATION_POLICY.md`](../DOCUMENTATION_POLICY.md). Не создавайте новый Markdown-файл, если существующий документ уже владеет темой.

## Current state vs plan

Разделяйте формулировки:

- **реализовано сейчас** — подтверждено кодом/tests текущего ref;
- **documented contract** — active документ соответствует runtime;
- **planned** — существует issue/plan, но implementation не подтверждён;
- **historical** — относится к предыдущей архитектуре/release.

Нельзя писать «портал делает X» только потому, что Issue требует X.

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

## Проверка перед завершением задачи

Минимальный self-review:

1. scope соответствует issue;
2. не создан дублирующий owner/abstraction;
3. permission/security boundaries остались server-side;
4. failure semantics понятны и протестированы;
5. актуальные docs обновлены;
6. superseded statements удалены;
7. paths/links действительно существуют;
8. test/build/lint команды выполнены настолько полно, насколько позволяет scope;
9. PR содержит evidence и known gaps без ложного claim о полном покрытии.

## Документальные задачи

При работе только с документацией дополнительно:

- проверяйте каждое current-state утверждение против текущего `main`;
- не создавайте ссылку на planned-файл, пока он не существует;
- не используйте плавающие числа тестов как долгоживущий факт;
- не переписывайте runtime semantics «для красоты»;
- если найдено расхождение docs и runtime, зафиксируйте его как дефект и исправьте в согласованном scope.

## Куда смотреть дальше

- [`../README.md`](../README.md) — навигация;
- [`../SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md) — authoritative owners;
- [`../GLOSSARY.md`](../GLOSSARY.md) — терминология;
- профильные runbook — фактические operational/security contracts.

Architecture overview, project structure и расширенный module map будут добавляться поэтапно в Epic #82. До их появления не выдумывайте отсутствующие boundaries: проверяйте фактический код.
