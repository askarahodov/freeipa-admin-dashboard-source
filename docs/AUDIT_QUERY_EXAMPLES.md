# Примеры запросов к журналу аудита

Этот документ дополняет [AUDIT_LOG.md](AUDIT_LOG.md) практическими сценариями
поиска и расследования. Endpoint доступен только роли `admin` с разрешением
`settings.manage`.

## Последние события

```bash
curl -sS \
  -H 'Accept: application/json' \
  'https://portal.example.test/api/integrations/audit?limit=100'
```

## Цепочка по Correlation ID

```bash
CORRELATION_ID='cor_0123456789abcdef0123456789abcdef'

curl -sS \
  -H 'Accept: application/json' \
  "https://portal.example.test/api/integrations/audit?correlationId=${CORRELATION_ID}&limit=200"
```

Ожидаемая последовательность опасной операции:

```text
approval.requested
approval.approve
approval.execute
xyops.run
xyops.run.status_changed
```

## Поиск по approval-заявке

```bash
APPROVAL_ID='approval-id'

curl -sS \
  -H 'Accept: application/json' \
  "https://portal.example.test/api/integrations/audit?approvalId=${APPROVAL_ID}&limit=200"
```

Проверьте:

- кто создал заявку;
- кто согласовал или отклонил;
- совпадает ли `schemaVersion`;
- какой `runId` появился после выполнения;
- отсутствуют ли неожиданные повторные `approval.execute`.

## Поиск по запуску

```bash
RUN_ID='run-id'

curl -sS \
  -H 'Accept: application/json' \
  "https://portal.example.test/api/integrations/audit?runId=${RUN_ID}&limit=200"
```

Связанные записи должны содержать `eventId`, `jobId` и один серверный
`correlationId`.

## Ошибочные и неоднозначные операции

```bash
curl -sS \
  -H 'Accept: application/json' \
  'https://portal.example.test/api/integrations/audit?outcome=failure&limit=200'

curl -sS \
  -H 'Accept: application/json' \
  'https://portal.example.test/api/integrations/audit?outcome=unknown&limit=200'
```

`unknown` требует ручной проверки в XYOps: запрос мог быть принят до сетевого
обрыва, поэтому опасную операцию нельзя автоматически повторять.

## Действия конкретного пользователя

```bash
ACTOR='operator@example.test'

curl -sS \
  -H 'Accept: application/json' \
  "https://portal.example.test/api/integrations/audit?actor=${ACTOR}&limit=200"
```

## Изменения политик

```bash
curl -sS \
  -H 'Accept: application/json' \
  'https://portal.example.test/api/integrations/audit?action=catalog.policy.updated&limit=100'

curl -sS \
  -H 'Accept: application/json' \
  'https://portal.example.test/api/integrations/audit?action=approval.policy.updated&limit=100'
```

Metadata содержит только безопасные признаки: версию, число правил и режим
политики. Полный JSON политики в журнал не копируется.

## FreeIPA

```bash
curl -sS \
  -H 'Accept: application/json' \
  'https://portal.example.test/api/integrations/audit?action=freeipa.user_disable&limit=100'
```

Для сброса пароля сохраняется факт операции, identity, роль и `runId`, но пароль
не сохраняется ни в `metadata`, ни в API-ответе.

## Временной диапазон

`dateFrom` и `dateTo` передаются в Unix milliseconds:

```bash
DATE_FROM=$(date -d '2026-07-23 00:00:00 UTC' +%s)000
DATE_TO=$(date -d '2026-07-24 00:00:00 UTC' +%s)000

curl -sS \
  -H 'Accept: application/json' \
  "https://portal.example.test/api/integrations/audit?dateFrom=${DATE_FROM}&dateTo=${DATE_TO}&limit=200"
```

## Минимальный порядок расследования

1. Найдите событие по `runId`, `approvalId` или `jobId` в интерфейсе.
2. Скопируйте `correlationId`.
3. Получите всю цепочку по `correlationId`.
4. Проверьте actor, role, `schemaVersion`, approval и outcome.
5. При `unknown` сопоставьте `jobId` с журналом XYOps до повторного запуска.
6. Зафиксируйте результаты расследования во внешней системе инцидентов.

Портал не предоставляет API изменения или удаления audit-событий. Retention и
архивирование должны выполняться отдельным согласованным процессом вне приложения.
