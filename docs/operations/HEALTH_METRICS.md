# Health metrics contract

`GET /metrics/health` предоставляет минимальный Prometheus-compatible baseline для локального состояния Admin Dashboard Softrust.

Endpoint предназначен для внутреннего scrape и обслуживается до обычных schema, maintenance и authentication gates. Он остаётся доступным для наблюдения за incident state, но не является Docker или Kubernetes restart probe.

## Scope

Metrics handler вызывает только существующие JSON contracts:

- `GET /health/live`;
- `GET /health/ready`.

Он **не вызывает** `GET /health/dependencies`, не читает integration settings и не обращается к FreeIPA или XYOps. Поэтому частота Prometheus scrape не влияет на внешние системы.

Dependency state продолжает наблюдаться через cached sanitized JSON contract `/health/dependencies`. Его следует опрашивать отдельным blackbox/JSON collector с периодом не меньше cache TTL.

## Scrape example

```yaml
scrape_configs:
  - job_name: freeipa-admin-dashboard-health
    metrics_path: /metrics/health
    scrape_interval: 30s
    scrape_timeout: 5s
    static_configs:
      - targets:
          - dashboard.internal.example:3001
```

Для production ingress ограничьте `/metrics/health` внутренней сетью, service mesh policy или отдельным monitoring listener. Endpoint не требует browser session и намеренно остаётся recovery-доступным.

## Metrics

| Metric | Type | Labels | Meaning |
| --- | --- | --- | --- |
| `portal_health_contract_info` | gauge | `version` | Версия sanitized health contract |
| `portal_build_info` | gauge | `version` | Sanitized build version или `unknown` |
| `portal_health_live` | gauge | — | `1`, когда event loop обслуживает HTTP |
| `portal_health_ready` | gauge | — | `1`, когда обязательный локальный runtime ready |
| `portal_health_readiness_check` | gauge | `check` | Fixed checks: `database`, `schema`, `encryption`, `gateway` |
| `portal_health_schema_version` | gauge | — | Текущая canonical schema version; `-1`, если неизвестна |
| `portal_health_schema_latest_version` | gauge | — | Последняя известная schema version; `-1`, если неизвестна |
| `portal_health_schema_lag` | gauge | — | Разница latest-current; `-1`, если вычисление невозможно |
| `portal_health_dependency_contract_info` | gauge | `mode`, `path` | Указывает, что dependency state публикуется отдельным cached JSON contract |

Metrics endpoint всегда старается вернуть HTTP `200`, даже когда readiness evaluation завершилась ошибкой. Неизвестное состояние представляется нулевыми readiness gauges и schema values `-1`; exception text в exposition не попадает.

## Cardinality policy

Разрешены только фиксированные label sets:

- `version` — bounded sanitized build/contract version;
- `check` — одно из четырёх фиксированных значений;
- `mode="cached_json"`;
- `path="/health/dependencies"`.

Запрещены labels с:

- username и персональными данными;
- URL, hostname и IP;
- run ID, operation ID и resource names;
- error code и raw exception;
- API key, bearer token, password и cookie;
- FreeIPA/XYOps object identifiers.

Добавление нового label требует отдельного contract review и regression tests на cardinality и redaction.

## Alert rules

Baseline rules находятся в:

```text
monitoring/prometheus-health-alerts.yml
```

Они определяют:

- `PortalHealthMetricsMissing` — liveness series отсутствует 2 минуты;
- `PortalNotReady` — readiness равна `0` 5 минут;
- `PortalSchemaLagging` — schema lag больше `0` 5 минут;
- `PortalEncryptionUnavailable` — encryption readiness check равна `0` 5 минут;
- `PortalGatewayUnavailable` — local Gateway readiness check равна `0` 5 минут.

Rules содержат только fixed labels `severity` и `component`. Они не выполняют команды, webhooks, deployment actions или автоматическое восстановление.

## Operational policy

- `portal_health_live == 0` или отсутствующая series требуют проверки процесса и scrape route.
- `portal_health_ready == 0` означает, что instance следует исключить из рабочего трафика и диагностировать локальные обязательные компоненты.
- `portal_health_schema_lag > 0` требует проверки migration journal и schema boundary.
- Ошибка внешней зависимости не изменяет эти gauges и не должна приводить к restart loop.
- Для внешних зависимостей используйте `/health/dependencies` и `/diagnostics/health`.

Docker продолжает использовать только `/health/live`. Kubernetes readiness продолжает использовать `/health/ready`. `/metrics/health` используется только для monitoring scrape.

## Verification

Contract tests проверяют:

- deterministic Prometheus text output;
- healthy, unready и exception paths;
- отсутствие external dependency request;
- отсутствие secret/raw error leakage;
- fixed readiness labels;
- соответствие alert expressions реально экспортируемым metrics;
- неизменность Docker liveness policy.
