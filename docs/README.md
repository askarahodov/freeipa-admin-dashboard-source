# Engineering documentation

Этот каталог — главный индекс инженерной документации **Admin Dashboard Softrust** для разработчиков, операторов, security reviewers и ИИ-агентов.

Корневой [`README.md`](../README.md) остаётся краткой входной точкой. Current audit status: [`DOCUMENTATION_INVENTORY.md`](DOCUMENTATION_INVENTORY.md).

## С чего начать

### Новый разработчик

1. [`../README.md`](../README.md) — назначение и quick start.
2. [`ARCHITECTURE.md`](ARCHITECTURE.md) — current runtime topology, trust/data boundaries и major ownership.
3. [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) — repository/module map и where-to-change routing.
4. [`MODULE_COVERAGE.md`](MODULE_COVERAGE.md) — module ownership, dependency direction и scoped tests.
5. [`DEPLOYMENT_MATRIX.md`](DEPLOYMENT_MATRIX.md) — supported/development/constrained/unsupported deployment modes.
6. [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) — authoritative owners и precedence.
7. [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md) — docs-as-code и правила нескольких агентов.
8. [`development/README.md`](development/README.md) — repository governance, branch lifecycle, required checks and dependency-update policy.
9. При изменении внешнего/операционного контракта свериться с [`reference/API.md`](reference/API.md), [`reference/PERMISSIONS.md`](reference/PERMISSIONS.md), [`reference/CONFIGURATION.md`](reference/CONFIGURATION.md) и [`reference/ERROR_CODES.md`](reference/ERROR_CODES.md).
10. Затем читать профильный документ и фактический code/tests текущего ref.

### ИИ-агент

Обязательная точка входа: [`ai/README.md`](ai/README.md). Issue, implementation plan, старый PR или historical design не являются доказательством текущего поведения. При конфликте приоритет у canonical code/tests, затем documented source of truth и verified-active профильных документов.

### Оператор

Основной набор:

- [`DEPLOYMENT_MATRIX.md`](DEPLOYMENT_MATRIX.md)
- [`HEALTH_CONTRACTS.md`](HEALTH_CONTRACTS.md)
- [`HEALTH_METRICS.md`](HEALTH_METRICS.md)
- [`STORAGE_STATUS.md`](STORAGE_STATUS.md)
- [`STORAGE_INTEGRITY.md`](STORAGE_INTEGRITY.md)
- [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md)
- [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md)
- [`OFFLINE_FULL_RESTORE.md`](OFFLINE_FULL_RESTORE.md)
- [`CONFIG_ENCRYPTION_KEY.md`](CONFIG_ENCRYPTION_KEY.md)
- [`reference/CONFIGURATION.md`](reference/CONFIGURATION.md)
- [`reference/ERROR_CODES.md`](reference/ERROR_CODES.md)

Для destructive/recovery операций используйте только профильный active runbook.

### Security reviewer

Основной набор:

- [`ARCHITECTURE.md`](ARCHITECTURE.md)
- [`MODULE_COVERAGE.md`](MODULE_COVERAGE.md)
- [`DEPLOYMENT_MATRIX.md`](DEPLOYMENT_MATRIX.md)
- [`SECURITY_MODEL.md`](SECURITY_MODEL.md)
- [`LOCAL_AUTH_RBAC.md`](LOCAL_AUTH_RBAC.md)
- [`security/DEPENDENCY_SECURITY.md`](security/DEPENDENCY_SECURITY.md)
- [`reference/PERMISSIONS.md`](reference/PERMISSIONS.md)
- [`reference/API.md`](reference/API.md)
- [`reference/CONFIGURATION.md`](reference/CONFIGURATION.md)
- [`reference/ERROR_CODES.md`](reference/ERROR_CODES.md)
- [`AUDIT_LOG.md`](AUDIT_LOG.md)
- [`CONFIG_ENCRYPTION_KEY.md`](CONFIG_ENCRYPTION_KEY.md)
- [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md)
- [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md)
- [`OFFLINE_FULL_RESTORE.md`](OFFLINE_FULL_RESTORE.md)
- [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md)

## Foundation / governance

| Документ | Назначение |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Current topology/request/trust/data/failure boundaries |
| [`PROJECT_STRUCTURE.md`](PROJECT_STRUCTURE.md) | Repository ownership map and module boundaries |
| [`MODULE_COVERAGE.md`](MODULE_COVERAGE.md) | Module documentation/test coverage and dependency direction |
| [`DEPLOYMENT_MATRIX.md`](DEPLOYMENT_MATRIX.md) | Supported and unsupported deployment models |
| [`DOCUMENTATION_POLICY.md`](DOCUMENTATION_POLICY.md) | Docs-as-code, statuses, review and multi-agent rules |
| [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md) | Authoritative source registry and precedence |
| [`DOCUMENTATION_INVENTORY.md`](DOCUMENTATION_INVENTORY.md) | Current audit status |
| [`development/README.md`](development/README.md) | Development/repository governance policies |
| [`adr/README.md`](adr/README.md) | ADR policy/registry — why-level decisions |
| [`GLOSSARY.md`](GLOSSARY.md) | Common terminology |
| [`ai/README.md`](ai/README.md) | Mandatory AI-agent entrypoint |

## Development / repository governance

| Документ | Назначение |
| --- | --- |
| [`development/AGENT_BRANCH_POLICY.md`](development/AGENT_BRANCH_POLICY.md) | AI-agent branch lifecycle and safe cleanup |
| [`development/REQUIRED_CHECKS.md`](development/REQUIRED_CHECKS.md) | Stable branch-protection and CI check contract |
| [`development/DEPENDABOT_POLICY.md`](development/DEPENDABOT_POLICY.md) | Dependency-update capacity and coordination policy |

## Normalized reference layer

Эти документы дают человекочитаемый вход в распределённые runtime contracts и **не заменяют runtime owners**.

| Документ | Назначение |
| --- | --- |
| [`reference/API.md`](reference/API.md) | Route families, methods, authorization boundaries and owners |
| [`reference/PERMISSIONS.md`](reference/PERMISSIONS.md) | Built-in roles and canonical permission codes |
| [`reference/CONFIGURATION.md`](reference/CONFIGURATION.md) | Production/runtime/dynamic/recovery/test configuration classes |
| [`reference/ERROR_CODES.md`](reference/ERROR_CODES.md) | Verified stable machine-readable error/status codes |
| [`ERROR_CODE_OWNERSHIP.md`](ERROR_CODE_OWNERSHIP.md) | `src/auth/stable-error-contract.ts` ownership/verification rules |

Machine-readable ownership work referenced by the documentation platform is complete: RBAC ownership #119, route registry #121, supported configuration contract #123 and stable error-code ownership #124. Domain code/tests remain behavioral owners.

## Authentication / access / audit

| Документ | Назначение |
| --- | --- |
| [`SECURITY_MODEL.md`](SECURITY_MODEL.md) | Trust boundaries, identity classes, secret/recovery invariants |
| [`LOCAL_AUTH_RBAC.md`](LOCAL_AUTH_RBAC.md) | Portal users, sessions, roles and FreeIPA identity separation |
| [`AUDIT_LOG.md`](AUDIT_LOG.md) | Append-only audit, correlation, redaction and read API |
| [`security/DEPENDENCY_SECURITY.md`](security/DEPENDENCY_SECURITY.md) | Supply-chain audit, SBOM and runtime image security policy |

## Storage / schema / recovery

| Документ | Назначение |
| --- | --- |
| [`DATABASE_MIGRATIONS.md`](DATABASE_MIGRATIONS.md) | Canonical schema/migrations/journal/drift/recovery semantics |
| [`STORAGE_STATUS.md`](STORAGE_STATUS.md) | Bounded read-only storage status |
| [`STORAGE_INTEGRITY.md`](STORAGE_INTEGRITY.md) | Read-only SQLite/index diagnostics |
| [`MAINTENANCE_MODE.md`](MAINTENANCE_MODE.md) | Persistent maintenance state machine |
| [`OFFLINE_FULL_RESTORE.md`](OFFLINE_FULL_RESTORE.md) | Offline destructive restore, atomic swap, verify, rollback |
| [`CONFIG_ENCRYPTION_KEY.md`](CONFIG_ENCRYPTION_KEY.md) | Production encryption-key requirements |

## Health / monitoring

| Документ | Назначение |
| --- | --- |
| [`HEALTH_CONTRACTS.md`](HEALTH_CONTRACTS.md) | Liveness, readiness, dependency health and diagnostics |
| [`HEALTH_METRICS.md`](HEALTH_METRICS.md) | Prometheus-compatible baseline health metrics |

## XYOps / process presentation

| Документ | Назначение |
| --- | --- |
| [`XYOPS_EXECUTION_OWNERSHIP.md`](XYOPS_EXECUTION_OWNERSHIP.md) | Portal/XYOps execution ownership split |
| [`XYOPS_INSPECTOR.md`](XYOPS_INSPECTOR.md) | Safe read-only installed-version inspector |
| [`PROCESS_PRESENTATION_METADATA.md`](PROCESS_PRESENTATION_METADATA.md) | Presentation overrides, locale/fallback and boundaries |

## Testing / acceptance

| Документ | Назначение |
| --- | --- |
| [`LOCAL_ACCEPTANCE_TESTS.md`](LOCAL_ACCEPTANCE_TESTS.md) | Local integration acceptance procedure |
| [`P0_OPERATIONAL_ACCEPTANCE.md`](P0_OPERATIONAL_ACCEPTANCE.md) | Automated P0 local-auth/persistence runner |

## Roadmap / historical material

| Документ | Статус |
| --- | --- |
| [`PRODUCT_ROADMAP.md`](PRODUCT_ROADMAP.md) | Plan/snapshot; not runtime evidence |
| [`OPEN_TASKS.md`](OPEN_TASKS.md) | `superseded`; current backlog is GitHub Issues |
| `superpowers/specs/**` | Design/historical artifacts |
| `superpowers/plans/**` | Historical implementation/review plans |

## Иерархия доверия

1. фактический code, canonical registries/schema и tests текущего ref;
2. owner/source из [`SOURCE_OF_TRUTH.md`](SOURCE_OF_TRUTH.md);
3. `verified-active` профильный contract/runbook;
4. normalized `reference/*` как current-state orientation;
5. architecture/project/module/deployment/security overview;
6. ADR как объяснение решения;
7. roadmap, Issue, plan, PR description и historical notes.

## Когда документация должна измениться

Documentation impact обязателен, если PR изменяет route/method/auth/permission, schema/migration/data ownership, configuration, integration protocol, stable machine code, security/trust/redaction/secrets, startup/deployment/network/health, backup/restore/maintenance/recovery, documented user workflow, module boundary или source of truth.

Если код делает active-document неверным, PR не считается завершённым до исправления документации либо явной регистрации blocking documentation defect.

## Epic #82 status

Documentation foundation, architecture/project orientation, AI-agent context, normalized reference coverage, module coverage, ADR registry and docs-consistency CI реализованы. Final current-state reconciliation выполняется в #240 / PR #242; после зелёного exact-head Required CI и отсутствия новых material gaps Epic #82 может быть закрыт как completed.
