# Deployment fixtures

This directory owns deployment and container fixtures that do not need to remain repository-root entrypoints.

- [`compose/recovery.test.yaml`](compose/recovery.test.yaml) is the isolated recovery-container smoke fixture owned by `scripts/recovery-compose-smoke.mjs`. It preserves the repository root as the Docker build context and is not a production deployment contract.

The deployment/configuration placement audit #269 is completed. The repository-root `compose.yaml` remains the supported production Compose entrypoint, while environment examples and non-production Compose/config fixtures stay in their documented production, development, E2E or acceptance owners. Do not move these files opportunistically: any future relocation must inventory and update scripts, CI, documentation, tests and environment-loading precedence in the same focused change.

For the current repository/deployment ownership map, use [`../docs/architecture/PROJECT_STRUCTURE.md`](../docs/architecture/PROJECT_STRUCTURE.md).