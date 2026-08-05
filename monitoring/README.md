# Monitoring integration

Этот каталог содержит только переносимые monitoring contracts. Он не разворачивает Prometheus, Alertmanager, Grafana или другой monitoring stack.

## Prometheus scrape

```yaml
scrape_configs:
  - job_name: freeipa-admin-dashboard-health
    metrics_path: /metrics/health
    scrape_interval: 30s
    scrape_timeout: 5s
    static_configs:
      - targets: ["dashboard.internal.example:3001"]
```

Endpoint экспортирует только локальные liveness/readiness/schema/encryption/Gateway metrics. Scrape не вызывает FreeIPA или XYOps и не читает integration credentials.

## Alert rules

Подключите файл `prometheus-health-alerts.yml` через `rule_files` вашего Prometheus-compatible сервера:

```yaml
rule_files:
  - /etc/prometheus/rules/prometheus-health-alerts.yml
```

Перед применением проверьте rules стандартным validation tool вашей monitoring-платформы.

## External dependency monitoring

FreeIPA/XYOps state публикуется отдельно:

```text
GET /health/dependencies
```

Это cached JSON contract. Используйте JSON/blackbox collector с периодом не меньше 30 секунд. Не назначайте его container liveness/readiness probe и не вызывайте автоматическое восстановление только из-за `degraded` state.

Подробный контракт: `docs/HEALTH_METRICS.md` и `docs/HEALTH_CONTRACTS.md`.
