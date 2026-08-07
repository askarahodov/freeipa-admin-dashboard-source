# Project glossary

Этот glossary фиксирует значения терминов, которые используются в коде, UI, документации и GitHub Issues. Цель — уменьшить неоднозначность между разработчиками и несколькими ИИ-агентами.

Если runtime использует термин иначе, чем этот документ, это документационный дефект: исправьте glossary вместе с контрактом, а не создавайте второе значение того же слова.

## Portal

**FreeIPA Admin Dashboard / Portal** — локальное административное приложение, которое предоставляет собственную аутентификацию, UI, API, локальное хранилище и интеграции с FreeIPA и XYOps.

Portal не является FreeIPA и не является XYOps.

## Worker

Server-side HTTP/runtime boundary приложения, обслуживающий API, route gates, integration logic и связанный runtime-контракт. В текущей реализации используется Worker/Vinext/Workerd-oriented stack.

Не использовать слово Worker как синоним Docker host или XYOps executor.

## Portal user

Локальная учётная запись для входа в административный Portal. Хранится в локальной базе Portal и имеет portal role/permissions.

Portal user не связывается автоматически с одноимённым FreeIPA user.

## FreeIPA user

Доменная учётная запись, которой управляет FreeIPA. Portal выполняет административные операции над этими объектами, но FreeIPA user сам по себе не получает права входа в Portal.

## FreeIPA Gateway

Приватный server-side Node.js process/boundary, через который Portal выполняет разрешённые FreeIPA operations. Gateway не является публичным browser API и не должен раскрывать upstream credentials/session cookies.

Текущая реализация связана с `scripts/freeipa-gateway.mjs`.

## XYOps

Внешняя система автоматизации, являющаяся владельцем Events/Workflows и их execution contract. Portal получает каталог, отображает формы и инициирует/отслеживает разрешённые операции, но не должен становиться второй копией XYOps scheduler/queue.

## service-admin

Отдельный административный механизм для строго ограниченных server/recovery endpoints, обычно связанный с `ADMIN_TOKEN`/`x-admin-token` boundary.

service-admin не является обычной browser session и не должен создавать универсальный обход local authentication, maintenance или recovery gates.

## Role

Именованная группа portal permissions. Текущие built-in роли включают `viewer`, `operator` и `admin`. Role относится к Portal и не равна FreeIPA group.

## Permission

Server-side capability Portal, проверяемая перед защищённой операцией. UI visibility не является permission enforcement.

## Operation

Пользовательская или системная административная операция, которую Portal отображает и отслеживает. Operation может быть связана с FreeIPA action или запуском XYOps process.

## Run

Конкретный экземпляр выполнения operation/process, имеющий собственный lifecycle/status и идентификаторы.

Не путать definition процесса с конкретным run.

## Job

Upstream execution instance/identifier, обычно принадлежащий XYOps. Portal run может ссылаться на upstream job, но это не обязательно одна и та же модель данных.

## Replay / rerun

Повторный запуск на основании сохранённой безопасной спецификации предыдущего run. Replay не должен обходить текущие permissions, visibility, approval или schema compatibility checks.

## Catalog

Нормализованное представление доступных XYOps Events/Workflows и их metadata, используемое Portal для навигации и генерации форм.

## Catalog snapshot

Снимок нормализованного каталога на определённый момент времени. Snapshot используется для сравнения изменений и не делает Portal владельцем XYOps process definition.

## Approval

Server-side lifecycle согласования опасной или policy-controlled операции. Approval не является простой UI-кнопкой: перед execution должны повторно проверяться актуальные условия, которые определяет runtime contract.

## Audit event

Append-only запись о значимом действии или security/operational transition. Audit не должен содержать secrets, raw credentials или неограниченные upstream payloads.

## Canonical schema

Поддерживаемое итоговое состояние локальной D1/SQLite schema Portal. Текущий source of truth указан в `SOURCE_OF_TRUTH.md` и `db/portal-schema.ts`.

## Schema migration

Версионированное контролируемое изменение canonical schema с migration journal/checksum semantics. Migration definition после выпуска не должна переписываться как будто это новая версия.

## Migration journal

Persistent registry применённых schema migrations, используемый runtime для проверки версии, порядка и checksum.

## Adoption

Безопасное принятие существующей compatible runtime database в canonical migration lifecycle. Adoption не является произвольным исправлением данных и не означает, что несовместимый drift будет изменён автоматически.

## Drift

Расхождение фактической DB structure с canonical schema.

- **compatible drift** — дополнительная структура, которую runtime может безопасно терпеть;
- **incompatible drift** — расхождение, которое блокирует readiness/операцию согласно contract.

## Preflight

Read-only или безопасная предварительная проверка условий перед потенциально опасной операцией. Успешный preflight подтверждает только проверенные условия и сам по себе не выполняет destructive commit.

## Backup

Контролируемое сохранение данных/состояния для последующего восстановления. В проекте существуют разные backup representations и recovery paths; термин не должен использоваться без уточнения типа, если это влияет на безопасность.

## Backup candidate

Проверяемый входной набор данных, рассматриваемый для restore. Candidate не становится production state только потому, что его удалось прочитать или расшифровать.

## Recovery point

Обязательное сохранённое состояние, позволяющее вернуть систему к известной точке до destructive/restore transition. Recovery point отличается от candidate backup, который пытаются применить.

## Receipt

Bounded metadata-доказательство, связывающее этапы offline recovery/restore: исходное состояние, operation, candidate/recovery point и результаты проверок. Receipt не должен содержать секреты, необходимые для обхода recovery boundary.

## Maintenance operation

Конкретный persistent maintenance lifecycle, связанный с operation ID и state machine. Maintenance не является просто UI banner.

## Controller secret

Одноразовый секрет, создаваемый для управления конкретным maintenance operation. Server хранит только необходимое безопасное представление/проверку; потерянный secret не должен восстанавливаться через обычный status endpoint.

## Liveness

Сигнал того, способен ли процесс/Worker отвечать на HTTP. Не должен зависеть от FreeIPA/XYOps и не должен использоваться для проверки полной готовности Portal.

## Readiness

Сигнал того, готов ли обязательный локальный runtime принимать рабочий трафик. Включает локальные обязательные dependencies согласно `HEALTH_CONTRACTS.md`.

## Dependency health

Отдельная read-only диагностика внешних интеграций (например, FreeIPA и XYOps). Degraded dependency не означает автоматически, что Portal process необходимо restart.

## Recovery gate

Fail-closed boundary, ограничивающий обычные operations во время schema/maintenance/recovery состояния. Recovery endpoint не должен превращаться в общий обход authorization.

## Source of truth

Authoritative владелец конкретного контракта — обычно кодовый registry/schema/runtime module плюс owner-document. Текущий registry находится в [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md).

## ADR

Architecture Decision Record — запись существенного архитектурного решения, его контекста, рассмотренных альтернатив и последствий. ADR объясняет «почему», но current runtime всё равно определяется фактическим кодом и active contracts.
