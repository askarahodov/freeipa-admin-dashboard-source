# Approval-гейты опасных процессов XYOps

Approval-гейт реализует принцип четырёх глаз: процесс, требующий согласования,
не отправляется в XYOps сразу после заполнения формы. Портал создаёт отдельную
заявку, ожидает решение независимого согласующего и только затем разрешает
инициатору выполнить операцию.

## Когда требуется согласование

Признак опасного процесса поступает из каталога XYOps:

```json
{
  "dangerous": true
}
```

или:

```json
{
  "requires_confirmation": true
}
```

Если административная политика не переопределена, любой такой процесс требует
одного согласования пользователя с ролью `admin`. Инициатор не может согласовать
собственную заявку. Разрешение действует 60 минут.

Политика может дополнительно назначать гейты по категории, точному ID процесса,
роли, группе или identity инициатора. Она также может увеличить количество
требуемых согласований или явно отключить гейт для выбранного процесса.

## Жизненный цикл

1. Инициатор заполняет форму Event или Workflow.
2. Сервер проверяет RBAC, visibility policy, targets и схему полей.
3. Approval policy определяет требование.
4. Вместо `run_event` создаётся заявка со статусом `pending`.
5. Подходящий согласующий выбирает `approve` или `reject`.
6. После набора необходимого количества решений заявка получает статус
   `approved`.
7. Инициатор нажимает «Выполнить в XYOps».
8. Сервер атомарно переводит заявку `approved -> executing`, повторно проверяет
   каталог, `schemaVersion`, visibility policy и approval policy.
9. Только после этих проверок портал вызывает `run_event`.
10. Созданный `operation_run` связывается с approval-заявкой.

Одна заявка используется только один раз. Повторный запрос выполнения получает
HTTP 409 и не вызывает XYOps.

## Статусы

| Статус | Значение |
| --- | --- |
| `pending` | ожидаются решения |
| `approved` | согласования собраны, инициатор может выполнить операцию |
| `rejected` | согласующий отклонил заявку |
| `cancelled` | инициатор отменил заявку |
| `expired` | истёк срок действия |
| `executing` | разрешение уже захвачено сервером, выполняется отправка в XYOps |
| `executed` | XYOps создал Job и сохранён `run_id` |
| `failed` | запуск не был выполнен из-за окончательной ошибки проверки |
| `unknown` | результат отправки в XYOps неизвестен; автоматический повтор запрещён |

`unknown` используется при неоднозначной сетевой ошибке. Опасную операцию нельзя
повторять автоматически, потому что XYOps мог принять первый запрос до обрыва
соединения.

## Хранение

D1-таблицы:

- `approval_policy_sets` — текущая административная политика;
- `operation_approvals` — заявки и их жизненный цикл;
- `operation_approval_decisions` — решения согласующих.

Пара `(approval_id, approver_identity)` уникальна, поэтому один пользователь не
может проголосовать дважды.

Несекретная спецификация запуска шифруется AES-256-GCM через
`CONFIG_ENCRYPTION_KEY`. Дополнительно рассчитывается SHA-256 fingerprint
параметров и targets.

## Секретные поля

Поля типа `password` не записываются в заявку и не отображаются согласующему.
Заявка хранит только названия таких полей.

После согласования инициатор вводит секрет заново непосредственно перед
выполнением. Сервер принимает только ожидаемые секретные поля и объединяет их с
ранее согласованными несекретными параметрами. Секреты не попадают в D1,
уведомления, журнал операций или ответ API.

## Права

- `xyops.run` — создать, отменить и выполнить собственную согласованную заявку;
- `xyops.approve` — одобрить или отклонить подходящую заявку;
- `settings.manage` + `x-admin-token` — управлять approval policy.

По умолчанию `xyops.approve` входит в роль `admin`. Дополнительное ограничение по
группам задаётся в самой approval policy.

## API

Получение доступных пользователю заявок:

```text
GET /api/integrations/approvals?limit=100
```

Решения и действия:

```text
POST /api/integrations/approvals/:id/approve
POST /api/integrations/approvals/:id/reject
POST /api/integrations/approvals/:id/cancel
POST /api/integrations/approvals/:id/execute
```

Для `reject` требуется непустой `comment`. Для `execute` секреты передаются в
объекте `secretValues` только при наличии соответствующих password-полей.

Управление политикой:

```text
GET /api/integrations/approval/policies
PUT /api/integrations/approval/policies
```

## Формат политики

```json
{
  "version": 1,
  "dangerousDefaults": {
    "requiredApprovals": 1,
    "approverRoles": ["admin"],
    "approverGroups": [],
    "requesterCannotApprove": true,
    "expiresMinutes": 60,
    "ruleId": "dangerous-default"
  },
  "rules": [
    {
      "id": "production-two-person",
      "effect": "require",
      "requesterUsers": [],
      "requesterRoles": [],
      "requesterGroups": [],
      "categories": ["Production"],
      "processes": [],
      "dangerous": null,
      "requiredApprovals": 2,
      "approverRoles": ["admin"],
      "approverGroups": ["ops-leads"],
      "requesterCannotApprove": true,
      "expiresMinutes": 30
    }
  ]
}
```

Правила обрабатываются сверху вниз; последнее совпавшее правило определяет
требование. `effect: "none"` отключает гейт для совпавшего ресурса.

Приоритет источников:

1. D1 `approval_policy_sets/current`;
2. `PORTAL_APPROVAL_POLICIES_JSON`;
3. встроенная безопасная политика для dangerous-процессов.

## Safe re-run и route API

Опасный safe re-run никогда не использует старое согласование: он создаёт новую
approval-заявку с новой TTL и новым набором решений.

Legacy endpoint `/api/integrations/actions` делегирует запуск в общий
`catalog/run`, поэтому route-based действия не обходят RBAC, visibility policy и
approval gate.

## Требования развёртывания

Для approval-гейтов обязательны:

- D1 / совместимое persistent storage;
- корректный 32-байтовый `CONFIG_ENCRYPTION_KEY`;
- доверенная portal identity;
- корректный RBAC;
- доверенные группы, если они используются в policy.

При отсутствии D1 или ключа шифрования опасный процесс не запускается и возвращает
ошибку конфигурации.
