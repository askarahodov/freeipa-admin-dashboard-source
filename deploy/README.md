# Deployment fixtures

This directory owns deployment and container fixtures that do not need to remain repository-root entrypoints.

- [`compose/recovery.test.yaml`](compose/recovery.test.yaml) is the isolated recovery-container smoke fixture owned by `scripts/recovery-compose-smoke.mjs`. It preserves the repository root as the Docker build context and is not a production deployment contract.

The root `compose.yaml` and environment example files keep their existing ownership until separate #269 slices audit every consumer and environment-loading assumption. Do not move them opportunistically with unrelated fixture changes.
