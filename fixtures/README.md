# Non-production fixtures

This directory owns checked-in configuration fixtures used by isolated local, acceptance, and browser-test runners. It is intentionally separate from production deployment entrypoints such as the repository-root `compose.yaml` and `.env.example`, and from local-development configuration under `config/development/`.

## Compose fixtures

- `fixtures/compose/e2e.yaml` — isolated browser/E2E stack used by `scripts/run-auth-e2e.sh`.
- `fixtures/compose/local-integration.yaml` — isolated local integration stack used by `scripts/run-local-integration.sh`.
- Recovery-specific Compose smoke ownership remains under `deploy/compose/` because it exercises the recovery deployment contract directly.

Compose-relative paths are written so the build context, runtime env files, mocks, and artifact directories resolve to the same repository-root resources as before relocation.

## Environment examples

- `fixtures/env/e2e.example` — copy to repository-root `.env.e2e` for the isolated E2E runner.
- `fixtures/env/local-integration.example` — copy to repository-root `.env.test` for the local integration runner.
- `fixtures/env/local-auth-acceptance.example` — source into the shell for `npm run test:local-auth:acceptance` against an isolated running portal.

The E2E and local-integration runtime env filenames stay at the repository root because their runner contracts and Docker Compose `--env-file` precedence intentionally remain unchanged. These examples are fixtures only; never point them at production services or reuse their example secrets.
