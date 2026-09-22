# Autonomous task state contract

Этот документ определяет opt-in contract GitHub Issues, которые разрешено обрабатывать автономному AI Coordinator. Он дополняет, а не заменяет `AGENTS.md`, `AI_AGENT_WORKFLOW.md`, GitHub Issues backlog, PR Collision Guard и risk-based testing.

Executable owner contract находится в `scripts/autonomous-task-state.mjs`. Если prose расходится с executable contract/tests, сначала исправляется расхождение; scheduler не должен угадывать состояние задачи.

## Основной принцип

Обычная открытая Issue **не становится автономной автоматически**.

Исторические и вручную управляемые Issues без autonomous marker/state label имеют состояние `UNMANAGED` и не могут быть выбраны Coordinator. Это позволяет включать автономность постепенно и не переинтерпретировать существующий backlog.

## Managed states

Для открытой managed Issue допустим ровно один state label:

| State | GitHub label | Может быть выбрана для новой работы |
| --- | --- | --- |
| `READY` | `ai:ready` | да, после dependency/collision checks |
| `IN_PROGRESS` | `ai:in-progress` | нет |
| `REVIEW` | `ai:review` | нет |
| `BLOCKED` | `ai:blocked` | нет |

Закрытая managed Issue с обычным completed resolution имеет effective state `DONE`. Закрытие как `not_planned` или `duplicate` имеет terminal state `CANCELLED` и не должно удовлетворять dependency как успешно выполненная работа. Неизвестный close reason считается `INVALID`. Отдельный `ai:done` label не является source of truth: GitHub closed state + resolution уже выражают terminal lifecycle.

Если открытая managed Issue имеет ноль или больше одного autonomous state label, contract считается `INVALID` и scheduler обязан fail closed.

## Metadata marker

Managed Issue содержит ровно один однострочный versioned marker:

```text
<!-- ai-task:v1 {"priority":"P1","dependsOn":[391],"humanApprovalRequired":false} -->
```

Поля v1:

- `priority` — обязательно, одно из `P0`, `P1`, `P2`, `P3`;
- `dependsOn` — обязательно, массив уникальных положительных GitHub Issue numbers;
- `humanApprovalRequired` — обязательно, boolean.

Неизвестные поля, неизвестная версия, duplicate marker, malformed JSON или неоднозначные dependencies делают managed Issue `INVALID`.

Marker предназначен для scheduler metadata, а не для хранения product requirements. Goal, scope, acceptance criteria, risks и test expectations остаются обычным содержимым GitHub Issue.

## Selection semantics

State contract отвечает только на вопрос, может ли Issue участвовать в autonomous scheduler.

`READY` означает **кандидат**, а не безусловное разрешение начать работу. Перед claim Coordinator из #682 обязан заново проверить:

1. свежий `main`;
2. что Issue всё ещё open и `READY`;
3. все `dependsOn` закрыты/удовлетворены;
4. active PR/branch ownership и PR Collision Guard evidence;
5. priority/dependency ordering из `docs/ai/AI_AGENT_WORKFLOW.md`;
6. human approval boundary;
7. доступность GitHub/API evidence.

Любая неоднозначность или unavailable required evidence блокирует автоматический выбор.

## Transition rules

V1 lifecycle:

```text
UNMANAGED
   |
   | explicit opt-in: valid marker + ai:ready
   v
 READY
   |
   | successful claim after fresh dependency/collision check
   v
 IN_PROGRESS
   |
   | valid PR checkpoint
   v
 REVIEW
   |
   | merge gate + merge + healthy post-merge verification
   v
 DONE (GitHub Issue closed/completed)
```

Если GitHub Issue закрыта как `not_planned` или `duplicate`, terminal state — `CANCELLED`, а не `DONE`.

Из `READY`, `IN_PROGRESS` или `REVIEW` задача может перейти в `BLOCKED`, если обнаружен реальный blocker. Возврат из `BLOCKED` в `READY` допускается только после исчезновения blocker и повторной валидации metadata/dependencies.

Exact mutation/claim concurrency semantics принадлежат #683; этот contract не считает простой локальный read достаточным для ownership claim.

## Priority

Priority используется только после blockers/dependencies/security/correctness ordering. Coordinator не должен выбирать лёгкую `P1` задачу поверх blocking prerequisite или более критичного executable workstream только ради throughput.

Порядок принятия решений остаётся канонически задан в `docs/ai/AI_AGENT_WORKFLOW.md`.

## Human approval boundary

`humanApprovalRequired: true` означает, что задача может быть распознана и спланирована, но autonomous execution не должен пересекать approval boundary без явного разрешения.

V1 также не должен автоматически выполнять production deployment, destructive production storage/database operations, external IAM/security-policy changes, secret rotation, firewall/network changes или production Kubernetes cluster-wide mutations только потому, что Issue помечена READY.

## Bootstrap labels

Repository должен иметь labels с точными именами:

```text
ai:ready
ai:in-progress
ai:review
ai:blocked
```

Label provisioning и transition mutations должны выполняться trusted repository automation с минимальными permissions. Отсутствующий label является configuration/setup problem, а не основанием подменять contract парсингом свободного текста.

## Failure behavior

Scheduler обязан fail closed:

- malformed/unsupported marker -> `INVALID`;
- state label без marker -> `INVALID`;
- marker без state label на open Issue -> `INVALID`;
- несколько autonomous state labels -> `INVALID`;
- missing/ambiguous dependency evidence -> не выбирать;
- GitHub/API failure -> не выбирать;
- Issue без marker и autonomous label -> `UNMANAGED`, не выбирать.

Нельзя автоматически менять старую Issue в READY только на основании слов `READY`, `P1`, checklist или похожего текста в body/comments.

## Source of truth

- backlog/work requirements: GitHub Issues;
- autonomous state/metadata syntax and validation: `scripts/autonomous-task-state.mjs`;
- lifecycle/risk/next-task ordering: `AGENTS.md` и `docs/ai/AI_AGENT_WORKFLOW.md`;
- test selection: `docs/TESTING_POLICY.md`;
- collision evidence: repository PR Collision Guard.

Следующий slice #682 должен потреблять этот executable contract вместо повторной реализации label/marker parsing.
