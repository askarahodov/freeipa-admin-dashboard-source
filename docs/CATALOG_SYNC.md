# Scheduled XYOps catalog synchronization

The Worker registers an hourly Cloudflare Cron Trigger (`0 * * * *`). The `scheduled()` handler calls the existing catalog API internally, so scheduled and interactive synchronization use the same XYOps normalization, snapshot, schema-diff, and history logic.

## Concurrency safety

A D1 lock prevents overlapping synchronizations. Locks older than `XYOPS_CATALOG_SYNC_LOCK_TTL_SECONDS` are treated as abandoned. The default is 900 seconds; accepted values are clamped between 60 and 3600 seconds.

```env
XYOPS_CATALOG_SYNC_ENABLED=true
XYOPS_CATALOG_SYNC_LOCK_TTL_SECONDS=900
```

Set `XYOPS_CATALOG_SYNC_ENABLED=false` to pause automatic execution without removing the cron trigger.

Demo mode and an unconfigured XYOps connection produce a visible `skipped` result. Returning a cached catalog during a scheduled run is recorded as a failure, because it means the live XYOps contract was not refreshed.

## Administrative API

The endpoints require the `admin` portal role and the same `x-admin-token` used by persistent settings.

- `GET /api/integrations/catalog/sync?limit=20` returns recent scheduled and manual runs.
- `POST /api/integrations/catalog/sync` starts synchronization immediately.

Each record contains the trigger, status, timestamps, number of processes, number of detected changes, and a sanitized error. Only the latest 50 records are retained.
