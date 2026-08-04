# Health contracts

Портал разделяет проверку жизни процесса, готовность обязательного локального runtime и состояние внешних интеграций. Эти сигналы нельзя взаимозаменять: ошибка FreeIPA или XYOps не должна приводить к циклическому перезапуску исправного портала.

## Endpoint policy

| Endpoint | Доступ | Что проверяет | Успех | Рекомендуемое применение |
| --- | --- | --- | --- | --- |
| `GET /health/live` | публичный | Только способность Worker обработать HTTP-запрос | `200` | Docker `HEALTHCHECK`, liveness probe |
| `GET /health/ready` | внутренний | D1 binding, canonical schema, AES-GCM self-test и локальный Node Gateway | `200`; иначе `503` | readiness probe, исключение instance из балансировки |
| `GET /api/integrations/health` | публичный, deprecated | Совместимый alias liveness | `200` | Только временная совместимость старых клиентов |
| `GET /health/dependencies` | ещё не реализован | Будущая проверка FreeIPA и XYOps | — | Наблюдаемость и диагностика, не liveness |

`/health/live` не читает D1, не использует ключ шифрования, не вызывает Gateway и не выполняет внешние сетевые запросы. Endpoint остаётся доступным до schema, maintenance, authentication и integration gates.

`/health/ready` считается успешным только когда:

1. доступен migration-capable D1 binding;
2. canonical schema имеет состояние `ready`;
3. `CONFIG_ENCRYPTION_KEY` проходит локальный AES-GCM encrypt/decrypt self-test;
4. локальный loopback Gateway отвечает на защищённый `GET /health` с текущим ephemeral bearer token.

Проверка Gateway подтверждает только работоспособность локального процесса. Она не обращается к FreeIPA и не передаёт пользовательские учётные данные.

## Response contract

Ответы live/ready используют версионированную безопасную форму:

```json
{
  "contractVersion": "1",
  "service": "freeipa-admin-dashboard",
  "check": "readiness",
  "state": "healthy",
  "code": "health_ready",
  "ok": true,
  "metadata": {
    "buildVersion": "unknown",
    "schemaVersion": 3,
    "latestSchemaVersion": 3
  },
  "checks": [
    { "name": "database", "state": "healthy", "code": "database_available" },
    { "name": "schema", "state": "healthy", "code": "schema_ready" },
    { "name": "encryption", "state": "healthy", "code": "encryption_ready" },
    { "name": "gateway", "state": "healthy", "code": "gateway_ready" }
  ]
}
```

Все ответы содержат `Cache-Control: no-store`. Failure payload возвращает только фиксированные коды и безопасные числовые версии schema. В ответах запрещены:

- URL и имена внешних систем;
- логины, пароли, cookies, токены и ключи;
- SQL, checksums, migration drift details;
- raw exception messages и upstream response bodies.

Deprecated alias дополнительно возвращает `Deprecation: true` и `Link: </health/live>; rel="successor-version"`, сохраняя поле `ok: true` для старых клиентов.

## Probe configuration

### Docker

Runtime image использует:

```text
GET http://127.0.0.1:3001/health/live
```

Нельзя менять Docker probe на readiness или dependency health: временная ошибка D1/Gateway/FreeIPA/XYOps не должна вызывать restart loop.

### Kubernetes or another orchestrator

Разделяйте probe’ы:

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 3001

readinessProbe:
  httpGet:
    path: /health/ready
    port: 3001
```

Readiness failure исключает instance из трафика, но не должен автоматически означать повреждение процесса. Для production ingress ограничьте `/health/ready` внутренней сетью или политикой маршрутизации.

## Operational interpretation

- `health_live`: Worker отвечает; процесс не нужно перезапускать.
- `health_database_unavailable`: отсутствует или несовместим D1 binding.
- `health_schema_unready`: schema migration/drift boundary не готов.
- `health_encryption_unavailable`: ключ конфигурации отсутствует, имеет неверный формат или crypto self-test не прошёл.
- `health_gateway_unavailable`: локальный Gateway не запущен, token mismatch или loopback request не прошёл.
- `health_ready`: портал готов принимать рабочий трафик.

Состояние FreeIPA и XYOps будет вынесено в отдельный dependency contract следующего checkpoint задачи #58. Оно предназначено для диагностики и alerting, а не для рестартов контейнера.
