# База знаний Admin Dashboard Softrust

Эта база знаний помогает работать с порталом по роли и по задаче. Она отвечает на вопрос **«что мне сделать и что означает результат»**.

Точные эксплуатационные команды, архитектурные контракты, API, security policy и recovery procedures остаются в канонической инженерной документации. Если здесь есть ссылка на runbook или reference, именно тот документ владеет техническими деталями.

## Выберите свою роль

### Новый пользователь

Начните с `getting-started/`: что такое портал, как войти, какие разделы доступны и где искать помощь.

### User / Viewer

Раздел `user/` предназначен для пользователей с правами просмотра: навигация, каталог FreeIPA, каталог процессов, operations и понятные объяснения состояний «нет данных», «нет прав», «недоступно» и «временно недоступно».

### Operator

Раздел `operator/` будет содержать типовые рабочие сценарии: операции с разрешёнными объектами FreeIPA, запуск процессов XYOps, approvals, результаты, повторные действия и эскалация ошибок.

### Administrator

Раздел `administrator/` предназначен для администраторов портала: локальные учётные записи и сессии, настройки, интеграции, audit, diagnostics, storage, backup/maintenance/recovery overview и безопасные административные ограничения.

### Operations / DevOps

Раздел `operations/` будет объяснять deployment, update/rollback, health/readiness, Docker, network/TLS, monitoring, backup/restore и incident troubleshooting с ссылками на точные runbooks.

### Support

Раздел `support/` будет содержать безопасную первичную диагностику, correlation ID, допустимые данные для запроса у пользователя и escalation path. Поддержка не должна запрашивать пароли, session cookies, API keys, encryption keys или raw database.

### Developer / AI agent

Раздел `developer/` будет служить входной точкой в разработку: current-main-first workflow, source of truth, repository ownership, testing policy, PR/CI lifecycle, multi-agent collision checks и Knowledge Base impact.

## Дополнительные разделы

- `concepts/` — термины и ключевые понятия.
- `troubleshooting/` — поиск решения по симптому.
- `ARTICLE_TEMPLATE.md` — шаблон новой практической статьи.

## Как устроена документация

1. **Knowledge Base / Guide** — как человеку выполнить задачу.
2. **Operations runbooks** — точные эксплуатационные и аварийные процедуры.
3. **Engineering reference** — архитектура, API, security, storage и testing contracts.
4. **Source code и tests** — фактическая реализация и executable contracts.

Если эти уровни расходятся, не исправляйте Guide догадкой. Сначала проверьте current code/tests и канонический source of truth.

## Что нельзя помещать в Guide

- реальные пароли, API keys, cookies, private keys и encryption keys;
- production hostnames, внутренние URL и персональные данные без явной необходимости;
- raw upstream responses или database dumps;
- будущие функции как будто они уже доступны;
- копии destructive recovery commands, если ими владеет отдельный runbook.

## Связанные канонические документы

- [`../README.md`](../README.md) — инженерный индекс документации;
- [`../reference/SOURCE_OF_TRUTH.md`](../reference/SOURCE_OF_TRUTH.md) — владельцы authoritative contracts;
- [`../architecture/ARCHITECTURE.md`](../architecture/ARCHITECTURE.md) — текущая архитектура;
- [`../security/SECURITY_MODEL.md`](../security/SECURITY_MODEL.md) — security/trust boundaries;
- [`../operations/HEALTH_CONTRACTS.md`](../operations/HEALTH_CONTRACTS.md) — health/readiness/dependency semantics;
- [`../operations/OFFLINE_FULL_RESTORE.md`](../operations/OFFLINE_FULL_RESTORE.md) — destructive offline restore runbook;
- [`../ai/AI_AGENT_WORKFLOW.md`](../ai/AI_AGENT_WORKFLOW.md) — обязательный workflow ИИ-агентов.

## Как обновлять базу знаний

Если feature, UI или operation меняет пользовательский workflow, issue/PR должен явно указать Knowledge Base impact: `none`, `update existing article`, `new article` или `troubleshooting update` и затронутую аудиторию.
