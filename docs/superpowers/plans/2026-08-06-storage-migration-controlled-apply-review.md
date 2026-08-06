# Controlled apply plan review

The approved implementation plan is executable with these clarified invariants:

- apply confirmation is always `APPLY:<maintenanceOperationId>:<currentVersion>:<latestVersion>`;
- the controller secret is never accepted as a CLI argument and is read only from environment/input secret handling;
- a new operation may replace a safe terminal row (`succeeded`, `reconciled`, or `interrupted`), while `running` and `failed` require status/reconcile handling;
- production versions 1–4 are automatic and production has no controlled version 5 in this checkpoint;
- implementation may place migration mode validation in a focused registry module rather than enlarging `db/portal-migrations.ts`, provided startup and apply consume the same validated registry.
