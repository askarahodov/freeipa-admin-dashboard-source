# CONFIG_ENCRYPTION_KEY operations

`CONFIG_ENCRYPTION_KEY` is the AES-256-GCM root key used by the portal for encrypted integration settings and other encrypted portal state. Production startup must receive it from external configuration; the repository does not provide a working production default.

## Generate a production key

Generate a unique 32-byte value for every installation:

```bash
openssl rand -hex 32
```

A canonical base64 encoding of exactly 32 bytes is also accepted. Do not reuse the documented test/E2E fixture keys, the previously published Compose key, repeated-byte keys, or example placeholders.

Copy `.env.example` to `.env`, replace the placeholder with the generated value, and keep the actual key outside Git. `docker compose config` must fail when the variable is absent or empty, and the dashboard startup validator rejects malformed or unsafe values before the FreeIPA Gateway or Worker runtime starts.

## Backup and recovery

Back up the database and the matching `CONFIG_ENCRYPTION_KEY` as separate protected assets. A database backup without its corresponding key is not sufficient to recover encrypted settings, approval/replay payloads, or encrypted revision snapshots.

Changing the key is **not** a rotation procedure. Replacing it without first re-encrypting existing records makes previously encrypted data unreadable. Before any future rotation workflow:

1. create and verify a current database backup;
2. retain the old key in the protected recovery procedure;
3. verify that the current key can decrypt the existing encrypted state;
4. only then run a dedicated, tested re-encryption migration.

The portal must never expose the key, its hash, a prefix/suffix, or another fingerprint through settings, health, diagnostics, logs, HTML, audit metadata, or test artifacts.

## Test and E2E fixtures

`.env.test.example` and `.env.e2e.example` contain fixed non-production fixture keys so isolated tests are reproducible. Their Compose profiles explicitly set `PORTAL_RUNTIME_PROFILE=test` or `PORTAL_RUNTIME_PROFILE=e2e`. The production profile rejects those fixture keys.
