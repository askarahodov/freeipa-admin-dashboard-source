# Health contracts

Портал разделяет проверку жизни процесса, готовность обязательного локального runtime и состояние внешних интеграций. Эти сигналы нельзя взаимозаменять: ошибка FreeIPA или XYOps не должна приводить к циклическому перезапуску исправного портала.

## Endpoint policy

| Endpoint | Доступ | Что проверяет | Успех | Рекомендуемое применение |
| --- | --- | --- | --- | --- |
| `GET /health/live` | публичный | Только способность Worker обработать HTTP-запрос | `200` | Docker `HEALTHCHECK`, liveness probe |
| `GET /health/ready` | внутренний | D1 binding, canonical schema, AES-GCM self-test и локальный Node Gateway | `200`; иначе `503` | readiness probe, исключение instance из балансировки |
| `GET /health/dependencies` | внутренний/диагностический | Read-only probes FreeIPA и XYOps с краткоживущим sanitized cache | `200` для evaluated healthy/degraded; `503`, если проверку нельзя выполнить | Наблюдаемость, alerting и диагностика, но не restart probe |
| `GET /api/integrations/health` | публичный, deprecated | Совместимый alias liveness | `200` | Только временная совместимость старых клиентов |

`/health/live` не читает D1, не использует ключ шифрования, не вызывает Gateway и не выполняет внешние сетевые запросы. Endpoint остаётся доступным до schema, maintenance, authentication и integration gates.

`/health/ready` считается успешным только когда:

1. доступен migration-capable D1 binding;
2. canonical schema имеет состояние `ready`;
3. `CONFIG_ENCRYPTION_KEY` проходит локальный AES-GCM encrypt/decrypt self-test;
4. локальный loopback Gateway отвечает на защищённый `GET /health` с текущим ephemeral bearer token.

Проверка Gateway внутри readiness подтверждает только работоспособность локального процесса. Она не обращается к FreeIPA и не передаёт пользовательские учётные данные.

`/health/dependencies` сначала требует доступные D1 и canonical schema, затем читает effective integration settings через read-only `SELECT`. Для FreeIPA выполняется ограниченный `user_find` через тот же authenticated loopback Gateway, который используется рабочими операциями. Для XYOps выполняется read-only `GET /api/app/get_events/v1`. Endpoint ничего не создаёт, не изменяет, не удаляет, не запускает и не отменяет.

## Live and ready response contract

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

Deprecated alias дополнительно возвращает `Deprecation: true` и `Link: </health/live>; rel="successor-version"`, сохраняя точный body `{ "ok": true }` для старых клиентов.

## Dependency response contract

Успешно выполненная диагностика возвращает HTTP `200`, даже когда одна из внешних систем недоступна. Это отделяет состояние dependency от состояния самого процесса:

```json
{
  "contractVersion": "1",
  "service": "freeipa-admin-dashboard",
  "check": "dependencies",
  "state": "degraded",
  "code": "dependencies_degraded",
  "ok": false,
  "metadata": {
    "buildVersion": "unknown",
    "schemaVersion": 3,
    "latestSchemaVersion": 3,
    "observedAt": 1785859200000,
    "cache": {
      "source": "fresh",
      "ageMs": 0,
      "ttlMs": 30000
    }
  },
  "dependencies": [
    {
      "name": "freeipa",
      "state": "degraded",
      "category": "timeout",
      "code": "freeipa_timeout",
      "latencyMs": 8000,
      "lastSuccessAt": 1785859100000
    },
    {
      "name": "xyops",
      "state": "healthy",
      "category": "ok",
      "code": "xyops_ready",
      "latencyMs": 42,
      "lastSuccessAt": 1785859200000
    }
  ]
}
```

HTTP `503` используется только когда dependency evaluation нельзя безопасно выполнить: отсутствует D1 binding, canonical schema не ready или effective settings нельзя прочитать/расшифровать. В этом случае внешние probes не запускаются.

### Dependency states and categories

- `healthy` — read-only probe завершён успешно;
- `degraded` — система настроена, но probe завершился безопасно классифицированной ошибкой;
- `unconfigured` — обязательные параметры отсутствуют;
- `configuration` — отсутствует или некорректна конфигурация;
- `dns` — имя FreeIPA не разрешилось;
- `tls` — TLS-проверка FreeIPA не прошла;
- `timeout` — bounded probe превысил лимит времени;
- `authentication` — credentials/API key отклонены;
- `rate_limited` — XYOps вернул HTTP `429`;
- `upstream` — upstream вернул server-side failure;
- `protocol` — ответ не соответствует ожидаемому безопасному контракту;
- `network` — соединение не установлено или было разорвано;
- `disabled` — XYOps отключён режимом demo.

Коды ответа фиксированы и пригодны для alert rules. Текст upstream exception или response body в API не возвращается.

## Cache and concurrency policy

Dependency probes используют process-local cache с TTL 30 секунд:

- кэш содержит только sanitized results, `latencyMs`, `observedAt` и `lastSuccessAt`;
- URLs, usernames, passwords, API keys, Gateway tokens, cookies, encrypted settings и raw errors не сохраняются;
- одновременные stale-запросы объединяются в один probe run;
- healthy и degraded результаты кэшируются одинаково, чтобы outage не создавал request storm;
- после неуспешного probe сохраняется timestamp последнего успешного результата;
- restart процесса очищает cache, что допустимо: это не persistent monitoring storage;
- изменение settings может быть видно с задержкой не более TTL.

`portal_settings_revisions.health_json` не используется как runtime cache: это данные revision lifecycle. Persistent health history, metrics и diagnostics UI должны иметь отдельного владельца данных.

## Response sanitization

Все health responses содержат `Cache-Control: no-store`. В ответах запрещены:

- URL и hostnames внешних систем;
- логины, пароли, cookies, bearer tokens, API keys и encryption keys;
- encrypted settings blobs;
- SQL, checksums и migration drift details;
- raw exception messages и upstream response bodies.

Разрешены только allowlisted service names, states, categories, codes, bounded latency, timestamps и числовые schema versions.

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

Readiness failure исключает instance из трафика, но не должен автоматически означать повреждение процесса. Для production ingress ограничьте `/health/ready` и `/health/dependencies` внутренней сетью или политикой маршрутизации.

`/health/dependencies` вызывается системой мониторинга с периодом, который не меньше cache TTL. Его нельзя назначать `livenessProbe`, `readinessProbe` или Docker `HEALTHCHECK`.

## Operational interpretation

- `health_live`: Worker отвечает; процесс не нужно перезапускать.
- `health_database_unavailable`: отсутствует или несовместим D1 binding.
- `health_schema_unready`: schema migration/drift boundary не готов.
- `health_encryption_unavailable`: ключ конфигурации отсутствует, имеет неверный формат или crypto self-test не прошёл.
- `health_gateway_unavailable`: локальный Gateway не запущен, token mismatch или loopback request не прошёл.
- `health_ready`: портал готов принимать рабочий трафик.
- `dependencies_healthy`: оба read-only integration probes успешны.
- `dependencies_degraded`: evaluation выполнена, но FreeIPA или XYOps degraded/unconfigured.
- `dependency_database_unavailable`: dependency evaluation невозможно без D1.
- `dependency_schema_unready`: dependency evaluation остановлена schema boundary.
- `dependency_configuration_unavailable`: effective settings нельзя безопасно прочитать или расшифровать.

При `dependencies_degraded` проверяйте `dependencies[].category`, `code`, `latencyMs` и `lastSuccessAt`. Не перезапускайте контейнер только из-за этого состояния.
