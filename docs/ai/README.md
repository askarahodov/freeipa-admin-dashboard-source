- [`../reference/API.md`](../reference/API.md) — normalized route reference;
- [`../reference/PERMISSIONS.md`](../reference/PERMISSIONS.md) — normalized canonical RBAC reference;
- [`../reference/CONFIGURATION.md`](../reference/CONFIGURATION.md) — supported configuration classes;
- [`../reference/ERROR_CODES.md`](../reference/ERROR_CODES.md) — stable machine-code reference;
- [`../SOURCE_OF_TRUTH.md`](../SOURCE_OF_TRUTH.md) — authoritative owners;
- [`../GLOSSARY.md`](../GLOSSARY.md) — терминология;
- профильные runbook — фактические operational/security contracts.

Если architecture/project/security/reference map и текущий код расходятся, не выдумывайте новое boundary: проверьте current ref/canonical owner и исправьте подтверждённый documentation drift.

## Canonical AI delivery policy

- [`AI_AGENT_WORKFLOW.md`](AI_AGENT_WORKFLOW.md) — mandatory AI-agent delivery workflow, testing, review and checkpoint policy.

Product runtime/security contracts, including approval gates for dangerous XYOps workflows, remain with their product-domain documentation owners rather than `docs/ai/`.
