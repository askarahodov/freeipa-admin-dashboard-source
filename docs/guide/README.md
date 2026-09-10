# База знаний Admin Dashboard Softrust

Эта база знаний помогает работать с порталом по роли и по задаче. Она отвечает на вопрос **«что мне сделать и что означает результат»**.

Точные эксплуатационные команды, архитектурные контракты, API, security policy и recovery procedures остаются в канонической инженерной документации. Если здесь есть ссылка на runbook или reference, именно тот документ владеет техническими деталями.

## Текущее состояние

Foundation и основные ролевые guides уже доступны: Getting Started, User / Viewer, Operator, Administrator, Operations / DevOps, Support и Developer / AI agent. Также доступен symptom-first Troubleshooting. База знаний развивается вместе с пользовательскими workflow; точные технические процедуры остаются в связанных canonical references и runbooks.

## Выберите свою роль

### Новый пользователь

Начните с [`getting-started/README.md`](getting-started/README.md): там объяснены назначение портала, вход, базовые роли, основные области и состояния `forbidden`, `unavailable` и `degraded`.

### User / Viewer

Используйте [`user/README.md`](user/README.md) для read-only workflows: просмотр пользователей и групп FreeIPA, каталога XYOps, операций и доступных результатов.

### Operator

Используйте [`operator/README.md`](operator/README.md) для типовых рабочих сценариев: разрешённые операции с FreeIPA, запуск процессов XYOps, работа с состояниями runs, безопасный retry и эскалация.

### Administrator

Используйте [`administrator/README.md`](administrator/README.md) для управления локальными portal accounts/sessions, настройками и интеграциями, audit/diagnostics/storage, а также безопасного понимания backup, maintenance и recovery с переходом к точным runbooks.

### Operations / DevOps

Используйте [`operations/README.md`](operations/README.md) для deployment/update/rollback, health/readiness, Docker/runtime/storage, network/DNS/TLS troubleshooting, monitoring, backup/restore и incident escalation с переходом к authoritative runbooks.

### Support

Используйте [`support/README.md`](support/README.md) для безопасной первичной диагностики, сбора минимальной evidence и escalation matrix. Поддержка не должна запрашивать пароли, session cookies, API keys, encryption keys или raw database.

### Developer / AI agent

Используйте [`developer/README.md`](developer/README.md) для current-main-first разработки, source-of-truth navigation, risk-based testing, PR/CI lifecycle, multi-agent collision checks и обязательной оценки Knowledge Base impact. ИИ-агенты должны начинать обязательный порядок чтения через [`../ai/README.md`](../ai/README.md).

## Дополнительные разделы

- [`concepts/TERMINOLOGY.md`](concepts/TERMINOLOGY.md) — правила терминологии и ключевые понятия.
- [`troubleshooting/README.md`](troubleshooting/README.md) — поиск причины по симптому и безопасная первичная диагностика.
- [`ARTICLE_TEMPLATE.md`](ARTICLE_TEMPLATE.md) — шаблон новой практической статьи.

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
