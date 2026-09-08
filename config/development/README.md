# Local development configuration

This directory owns checked-in configuration examples for local development that are not production deployment contracts and are not test fixtures.

- `config/development/runtime.env.example` is the explicit local-development runtime profile. Copy or adapt it only for an isolated developer environment.
- Repository-root `.dev.vars.example` remains a justified tool-facing entrypoint for the root `.dev.vars` developer runtime file used with `npm run dev`.
- Repository-root `.env.example` remains the production/environment deployment example and is not a development fixture.

Test and acceptance examples belong under `fixtures/env/`; deployment-specific contracts belong under `deploy/` or justified root entrypoints such as `compose.yaml`.
