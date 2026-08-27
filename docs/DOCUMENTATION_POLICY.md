# Documentation policy

## Purpose

Документация Admin Dashboard Softrust является частью инженерного контракта проекта. Изменение считается незавершённым, если затронутое фактическое поведение, архитектура, API, security boundary, конфигурация, схема данных, deployment или runbook изменились, а документация осталась прежней.

Эта policy обязательна для людей и ИИ-агентов.

## Основные принципы

### Docs as code

Документация хранится в том же репозитории, проходит review и изменяется в том же PR, что и связанный код.

### Current state отдельно от планов

Active-документы описывают то, как система работает сейчас.

- планы и будущие работы — GitHub Issues или implementation plans;
- архитектурные решения и их причины — ADR;
- release history — changelog/release notes;
- runbook — только поддерживаемая процедура для текущего состояния.

Нельзя оставлять в active reference фразы вроде «следующий PR сделает...», если соответствующий переход уже завершён. Такие маркеры считаются потенциально устаревшими и должны пересматриваться.

### Один владелец каждого контракта

Не создавайте второй документ, повторяющий тот же contract. Перед созданием нового файла проверьте [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) и существующую документацию.

Если информация принадлежит canonical code registry, документация объясняет semantics и указывает source of truth, а не копирует большие структуры вручную.

### Документировать причины и границы

Документация должна объяснять не только «что существует», но и:

- зачем существует boundary;
- кто владеет данными;
- что модуль не имеет права делать;
- failure/fail-closed semantics;
- security assumptions;
- recovery/rollback behavior;
- ограничения поддержки.

Бесполезные комментарии и повтор очевидного кода не считаются документацией.

## Типы документов

Используйте подходящий тип вместо смешивания всех задач в одном README.

### Overview / explanation

Объясняет устройство и причины решений: architecture, security model, module overview.

### Reference

Фиксирует точные контракты: API, permissions, configuration, error codes, schema ownership.

### Runbook / how-to

Описывает конкретную эксплуатационную процедуру с prerequisites, safety checks, failure handling и rollback.

### ADR

Фиксирует существенное архитектурное решение: context, alternatives, decision, consequences, status.

### Tutorial / getting started

Пошагово вводит нового пользователя или разработчика в ограниченный сценарий.

## Когда документация обязательна

Проверьте documentation impact, если PR изменяет хотя бы одну из областей:

- публичный или внутренний API contract;
- route, method, auth или permission;
- DB schema, migration, ownership или recovery behavior;
- environment variable или effective configuration;
- integration protocol FreeIPA/XYOps;
- security assumption, secret handling, redaction или trust boundary;
- startup/shutdown, container, network, TLS или deployment model;
- health/readiness/diagnostics;
- backup, restore, maintenance, cleanup;
- пользовательский workflow, который уже описан в docs;
- module boundary, dependency или source of truth.

Изменение, не затрагивающее документацию, должно иметь короткое обоснование в PR checklist.

## Когда создавать новый документ

Создавайте новый файл только если:

1. тема имеет отдельного владельца и жизненный цикл;
2. существующий документ станет смешивать разные аудитории/контракты;
3. информация достаточно стабильна, чтобы быть current-state knowledge;
4. существует понятное место в индексе `docs/README.md`.

Не создавайте новый файл только потому, что так проще агенту. Расширяйте существующий owner-document, если он уже отвечает за тему.

## Статусы документов

Критичные документы могут использовать следующие статусы в front matter или явной шапке:

- `draft` — ещё не является поддерживаемым contract;
- `active` — соответствует текущему поддерживаемому runtime;
- `deprecated` — всё ещё применим временно, но имеет replacement/migration path;
- `superseded` — заменён другим документом; должен ссылаться на replacement;
- `historical` — сохраняется только для истории и не используется как инструкция.

Документ без явного статуса считается обычной current-state документацией и не должен содержать неподтверждённые планы.

## Критичные runbook

Для backup/restore, migrations, maintenance, security recovery и других опасных процедур рекомендуется фиксировать:

- owner/domain;
- related code/source of truth;
- prerequisites;
- supported scope;
- exact safety boundaries;
- validation/verification commands;
- rollback/recovery;
- секреты и данные, которые запрещено логировать или копировать.

`last_verified` можно использовать только после фактической проверки против текущего runtime. Нельзя автоматически обновлять дату ради прохождения review.

## Правила для нескольких ИИ-агентов

1. Каждый агент начинает с `docs/ai/README.md`.
2. Один issue/branch/PR должен иметь узкий и понятный scope.
3. Перед изменением shared contract агент проверяет существующие ветки/PR, если это доступно, и не создаёт альтернативную реализацию того же owner-topic.
4. Нельзя молча менять архитектуру, permission model, source of truth или security boundary внутри feature-задачи.
5. Если два агента затрагивают один canonical contract, изменения должны быть сериализованы или явно координированы через issue/PR dependency.
6. Issue и implementation plan не считаются доказательством того, что функция уже существует.
7. Агент обязан удалить или исправить superseded утверждение, которое делает его изменение.
8. Агент не должен массово перемещать документацию без migration map и проверки всех ссылок.

## Правила достоверности

Перед утверждением о текущем поведении:

- проверить актуальный `main` или точный ref;
- проверить canonical source of truth;
- проверить профильный active-document;
- при необходимости проверить tests/contract fixtures.

Если источники расходятся, это документационный дефект. Не выбирайте удобную версию молча: зафиксируйте расхождение и используйте фактический runtime как высший технический источник до исправления документации.

## Security и privacy

В документацию, examples, screenshots и fixtures запрещено помещать реальные:

- passwords;
- API keys;
- `ADMIN_TOKEN`;
- `CONFIG_ENCRYPTION_KEY`;
- session cookies;
- FreeIPA cookies;
- controller/stage/recovery secrets;
- internal hostnames/URLs, если они не предназначены для публикации;
- raw logs с персональными данными;
- production identities.

Используйте очевидные placeholders и sanitized examples.

## Documentation impact checklist

Каждый PR должен явно оценивать:

- README/index;
- architecture/ADR;
- API/reference;
- configuration;
- security/runbook;
- tests/verification instructions;
- superseded information.

Если документация не меняется, автор указывает почему изменение не затрагивает documented contract.

## Automated consistency guard

`npm run docs:check` является обязательной детерминированной проверкой active documentation. Она запускается локально без установки зависимостей и отдельным job `Documentation consistency` в CI.

Guard проверяет только машинно-доказуемые классы drift, в том числе:

- сломанные внутренние Markdown-ссылки;
- документированные `npm run ...` команды, отсутствующие в `package.json`;
- известные запрещённые current-state маркеры после завершённых production-runtime переходов.

`docs/superpowers/**` исключён из active-doc проверки, потому что это historical design/implementation material. Guard не заменяет semantic contract tests и ручную проверку runtime owners: если точность утверждения нельзя надёжно доказать детерминированно, её проверяет профильный test или review.

Нельзя ослаблять guard ради прохождения CI, если он обнаружил реальный drift. Сначала исправьте документ/owner contract либо измените сам guard вместе с тестом и обоснованием, если машинное правило стало неверным.

## Review checklist

Перед merge документационного изменения проверьте:

- `npm run docs:check` проходит;
- ссылки ведут на существующие файлы или явно помечены как future gap без hyperlink;
- нет дублирования owner-topic;
- current state не смешан с roadmap;
- команды и paths соответствуют текущему репозиторию;
- API/permission/configuration assertions проверены;
- не осталось ссылок на удалённые файлы;
- нет секретов/PII;
- устаревшие временные утверждения удалены или помечены;
- README остаётся входной точкой, а не монолитной reference-документацией.

## Precedence

Порядок разрешения противоречий определён в `docs/README.md` и реестре [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md). Documentation policy не может переопределить фактический security/runtime contract кодом; её задача — не допускать расхождения документации с ним.
