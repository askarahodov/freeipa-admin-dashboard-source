# Developer / AI agent guide

## Для кого

Для разработчика, reviewer и ИИ-агента, который впервые работает с Admin Dashboard Softrust или берёт новую задачу из backlog.

Этот guide — навигатор. Он не заменяет обязательные repository policies, architecture contracts и executable tests.

## Самое важное правило

Работайте от **текущего `main`**, а не от старого issue appendix, PR description, локального checkout или истории чата.

Перед изменением кода:

1. получите актуальный `main`;
2. прочитайте задачу полностью;
3. проверьте открытые PR и их changed files;
4. найдите канонического owner для затрагиваемого поведения;
5. определите owned paths своего slice;
6. определите contracts, которые нельзя изменить случайно;
7. выберите проверки по риску;
8. только после этого создавайте branch и вносите изменения.

Обязательный repository contract: [`../../../AGENTS.md`](../../../AGENTS.md).

## Обязательные документы перед работой

Если вы ИИ-агент, начните с [`../../ai/README.md`](../../ai/README.md): это обязательная AI entrypoint, которая владеет порядком чтения и дальнейшим переходом к workflow/policies. Не заменяйте этот entrypoint сокращённым списком из Guide.

Для разработчика и как справочная карта после обязательного AI entrypoint:

- [`../../ai/README.md`](../../ai/README.md) — обязательный вход для ИИ-агента и порядок чтения;
- [`../../ai/AI_AGENT_WORKFLOW.md`](../../ai/AI_AGENT_WORKFLOW.md) — полный lifecycle и уровни риска;
- [`../../TESTING_POLICY.md`](../../TESTING_POLICY.md) — какие tests/E2E выбирать;
- [`../../reference/SOURCE_OF_TRUTH.md`](../../reference/SOURCE_OF_TRUTH.md) — где находится authoritative owner;
- [`../../architecture/PROJECT_STRUCTURE.md`](../../architecture/PROJECT_STRUCTURE.md) — карта модулей;
- [`../../architecture/ARCHITECTURE.md`](../../architecture/ARCHITECTURE.md) — runtime/trust/data boundaries;
- [`../../development/README.md`](../../development/README.md) — repository governance.

Если задача касается security, recovery, deployment, integrations или schema, дополнительно прочитайте профильный active contract/runbook.

## Как читать OPEN issue

Порядок доверия для исполнения:

1. фактический current `main` и tests;
2. active PRs / changed files;
3. свежий execution-status block или checkpoint;
4. canonical source-of-truth/active docs;
5. основной scope и acceptance criteria issue;
6. historical appendices/старые audit snapshots.

Старый appendix полезен для истории, но не подтверждает, что dependency всё ещё открыта.

Если issue говорит «после #123», проверьте фактический статус #123 до планирования.

## Multi-agent workflow

Параллельная работа разрешена только при понятном разделении ответственности.

### Coordinator

Coordinator владеет dependency graph, collision decisions, очередностью и итоговым checkpoint.

### Implementation agent

Получает один bounded outcome и явные owned paths. Не выполняет целый epic одним PR, если его можно безопасно разделить.

### Test agent

Проверяет изменённое поведение и негативные сценарии. Green не считается доказательством, если нужные тесты не были обнаружены или реально выполнены.

### Review / Security agent

Проверяет финальный combined diff: bypass, fail-open, секреты, race/idempotency, data loss, compatibility и невыполненные acceptance criteria.

### Documentation / Knowledge agent

Обновляет active engineering docs и/или ролевую Knowledge Base, когда изменение затрагивает workflow человека.

## Collision check

До начала работы ответьте:

- Есть ли open PR по этой issue?
- Кто уже меняет те же файлы или owner-модуль?
- Можно ли выделить непересекающийся slice?
- Требует ли задача последовательности из-за schema/auth/runtime/shared CSS/workflow files?

При collision не запускайте вторую реализацию. Разделите paths, измените очередность или продолжайте после merge owning change.

## Основные владельцы системы

### Portal

Portal владеет локальной аутентификацией и RBAC, настройками и локальным состоянием, audit, approvals, portal-side history и recovery metadata.

### FreeIPA

FreeIPA владеет directory identities — пользователями и группами. Не создавайте вторую локальную копию FreeIPA как источник истины.

Браузер не должен получать FreeIPA credentials или FreeIPA session cookie.

### XYOps

XYOps владеет определением процессов и фактическим job execution, scheduler, queue, concurrency и rate limiting.

Portal может предоставлять UX, approvals, history/projection и safe controls, но не должен становиться вторым orchestration engine.

Подробнее: [`../../integrations/XYOPS_EXECUTION_OWNERSHIP.md`](../../integrations/XYOPS_EXECUTION_OWNERSHIP.md).

## Authentication и authorization

Не объединяйте механизмы аутентификации только потому, что они приводят к похожим permissions.

Portal local session, service-admin token и другие доверенные identity mechanisms имеют разные trust boundaries. Authorization должен опираться на канонический permission contract.

Основные ссылки:

- [`../../security/LOCAL_AUTH_RBAC.md`](../../security/LOCAL_AUTH_RBAC.md);
- [`../../reference/PERMISSIONS.md`](../../reference/PERMISSIONS.md);
- [`../../security/SECURITY_MODEL.md`](../../security/SECURITY_MODEL.md).

Не переносите server-side RBAC/same-origin/approval checks в браузер как замену серверной защите.

## Database / schema / migration

Не создавайте второй schema owner или отдельную migration систему.

Перед изменением persisted data проверьте:

- canonical schema;
- migration journal;
- backward compatibility;
- restart/crash behavior;
- partial failure;
- rollback/recovery;
- backup prerequisite для destructive change.

Ссылки:

- [`../../operations/DATABASE_MIGRATIONS.md`](../../operations/DATABASE_MIGRATIONS.md);
- [`../../operations/STORAGE_STATUS.md`](../../operations/STORAGE_STATUS.md);
- [`../../operations/STORAGE_INTEGRITY.md`](../../operations/STORAGE_INTEGRITY.md).

Persisted-data/schema changes относятся к high-risk work.

## FreeIPA integration boundary

Изменяя FreeIPA path:

- сохраняйте server-side credentials/session boundary;
- учитывайте allowlisted RPC methods;
- не отключайте TLS verification ради прохождения теста;
- различайте auth/permission/TLS/DNS/timeout errors;
- проверяйте idempotency перед retry mutation;
- не логируйте raw upstream response с чувствительными данными.

API/reference: [`../../reference/API.md`](../../reference/API.md).

## XYOps integration boundary

При изменении XYOps:

- не дублируйте scheduler/queue/concurrency;
- не делайте blind retry non-idempotent run;
- сохраняйте 409/429/`Retry-After` semantics;
- не отдавайте browser API key;
- проверяйте approval/visibility/schema compatibility перед execution/replay;
- sanitized failure code предпочтительнее raw upstream body.

## Testing by risk

Каноническая политика: [`../../TESTING_POLICY.md`](../../TESTING_POLICY.md).

Базовый порядок:

1. focused unit/contract test доказывает изменяемое поведение;
2. negative/error case покрывает соответствующий риск;
3. repository router выбирает нужные browser categories;
4. cross-cutting runtime/dependency/workflow changes получают предусмотренную full regression;
5. CI result проверяется на exact PR head.

Нельзя ослаблять assertion или исключать failing test только ради зелёного CI.

Если тест красный, сначала классифицируйте причину: regression, настоящий ранее существовавший defect, outdated test, flake или infrastructure failure.

## Уровни риска

### Level 1

Документация и узкие non-runtime изменения. Нужны fresh-state/collision check, focused diff, docs/contracts checks, review и CI.

### Level 2

Обычная UI/backend feature или bug fix. Нужны acceptance criteria, compatibility/risk review, regression tests и routed integration/E2E.

### Level 3

Auth/RBAC, secrets, schema/data migration, persistence/recovery, CI trust boundary, deployment/runtime foundation, destructive operations и cross-cutting architecture.

Дополнительно требуются threat/failure modeling, rollback/recovery, negative tests, restart/concurrency/idempotency анализ там, где он применим.

При сомнении выбирайте более высокий уровень.

## Branch и PR lifecycle

Каждое meaningful изменение:

1. fresh current main;
2. dedicated branch;
3. focused implementation;
4. focused tests;
5. final diff review;
6. documentation impact;
7. PR с правдивыми evidence;
8. required CI/review clean;
9. merge;
10. post-merge verification на resulting `main`.

Не объявляйте задачу завершённой сразу после push или зелёного локального теста.

## Что писать в PR

PR должен позволить другому человеку или агенту проверить изменение без истории вашего чата:

- refs issue/parent;
- scope и non-goals;
- owned paths;
- сохранённые contracts;
- security/data/runtime impact;
- реально выполненные проверки и exact results;
- ограничения/непроверенное;
- rollback/recovery;
- Knowledge Base impact.

Не пишите «all tests pass», если вы выполнили только focused test.

## Knowledge Base impact

Для каждой feature/UX/operations задачи определите, меняется ли работа человека.

Проверьте аудитории:

- User / Viewer;
- Operator;
- Administrator;
- Support;
- Operations / DevOps;
- Developer.

Результат должен быть одним из:

- `none`;
- `update existing article`;
- `new article`;
- `troubleshooting update`.

Если workflow изменился, Guide должен быть обновлён в том же workstream или через явный documentation handoff. Не документируйте target state до его merge.

Главный индекс: [`../README.md`](../README.md).

## Когда нужен ADR

ADR нужен для решения, которое меняет существенную архитектурную границу или требует зафиксировать выбор между реальными альтернативами.

Не создавайте ADR для каждого локального refactor. Existing architecture и source-of-truth должны расширяться, а не дублироваться новым документом без необходимости.

ADR registry: [`../../adr/README.md`](../../adr/README.md).

## Definition of Done

Работа завершена только когда:

- requested behavior действительно присутствует;
- acceptance criteria выполнены;
- применимые tests и required CI зелёные;
- review/security blockers закрыты;
- documentation соответствует фактическому поведению;
- PR safely merged;
- resulting `main` проверен;
- residual work вынесен отдельно.

## Быстрый checklist перед стартом

- [ ] Я на актуальном `main`.
- [ ] Я проверил open PRs и changed files.
- [ ] Я знаю owner поведения и owned paths своего slice.
- [ ] Я не создаю второй auth/storage/config/audit/scheduler owner.
- [ ] Я знаю риск и нужные tests.
- [ ] Я знаю rollback/recovery, если изменение рискованное.
- [ ] Я оценил Knowledge Base impact.
- [ ] Я не использую реальные secrets/PII в code/tests/docs/artifacts.
