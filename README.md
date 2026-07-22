# vinext-starter

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`
- Linux with `flock`, `curl`, and GNU `timeout`

## Sites Lifecycle

The Sites lifecycle CLI runs the locked dependency install before returning this checkout. Edit the source under `app/`, then checkpoint when a coherent milestone is ready to inspect or share. The remote Sites builder runs `npm run build` against the pushed commit. Do not repeat install or build as a normal pre-checkpoint step.

This starter does not use `wrangler.jsonc`.

`install:ci` is intentionally a single, non-retrying `npm ci`. It refuses a concurrent install for the same project, consumes a matching image-seeded npm cache with `--prefer-offline` while retaining registry fallback for a missing cache object, otherwise downloads and verifies the complete vinext tarball recorded in `package-lock.json`, limits npm to one socket, and terminates a stalled install. `build` applies a short timeout and then validates the Sites artifact. These helpers target Linux and use GNU `timeout`; they are not native macOS scripts.

Scripts that need writable project-scoped home, npm, XDG, and temporary paths use `scripts/sites-env.sh`. The `dev` and `start` scripts honor the caller's runtime environment and keep Wrangler logs inside the checkout. The generated `.sites-runtime/` directory is disposable and ignored by Git.

## Included Shape

- edit site code under `app/`
- `app/chatgpt-auth.ts` provides optional dispatch-owned ChatGPT sign-in helpers
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/index.ts` reads the D1 binding from the Cloudflare Worker environment
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## FreeIPA and xyOps integration

The dashboard reads directory data from FreeIPA on the server side and routes
mutating operations through xyOps. xyOps workflows use the same `run_event`
endpoint as regular events, so the dashboard models both as automation routes.
The long-term product contract and prioritized delivery backlog are maintained
in [docs/PRODUCT_ROADMAP.md](docs/PRODUCT_ROADMAP.md).

Copy `.dev.vars.example` to `.dev.vars` for local development. Routes can be
created in **Settings → Automation routes** by selecting a catalog Event or
Workflow and mapping it to a dashboard operation. They are stored persistently
in D1/SQLite and may contain multiple routes for the same operation. The
`XYOPS_ROUTES_JSON` environment value remains available as a bootstrap fallback
when no routes have been saved. Each route declares:

- a stable `key` and user-facing `title`;
- the dashboard `operation` it accepts;
- `kind`, either `event` or `workflow`;
- the xyOps `eventId` and optional `targets` override;
- a field schema with type, required flag and destination (`params`, `input`,
  or `workflowData`).

The browser receives only the public route schema. The API key and FreeIPA
password remain server-side. The action endpoint rejects unknown operations,
unknown routes, missing required fields, invalid select values, and route / operation
mismatches before calling xyOps.

When xyOps is configured, the dashboard also calls `GET
/api/app/get_events/v1` through its server-side proxy. Event definitions are
normalized into a safe public catalog containing IDs, titles, kind, category,
and user-field schemas. The API key is never exposed. Launch dialogs render
their inputs from the selected route schema rather than from hard-coded forms.
User enable/disable/delete and group add/remove-member/delete controls appear
only when a matching enabled route exists; every mutation is sent to the chosen
XYOps Event or Workflow.

The normalized catalog is persisted as a safe D1/SQLite snapshot. Every live
synchronization compares process schemas and reports added, changed and removed
items. If XYOps is temporarily unavailable, the portal can still visualize the
last snapshot, but execution is disabled until a live contract is available.

Generated forms also understand section metadata, ordering and common
`visible_when` / `show_when` dependency shapes. Select fields may declare an
XYOps-side option provider. Those requests are proxied with the server API key
only when the declared endpoint is a relative `/api/app/…` path; arbitrary URLs
are rejected. Saved routes indicate schema drift and can be refreshed from the
current Event or Workflow without recreating the route.

Nested `group`, `section` and `fieldset` collections are flattened into a safe
field contract while retaining their hierarchy for the generated form. Before
a saved route is refreshed, the UI lists added, changed and removed fields for
explicit review. The operation journal also persists sanitized stage metadata
from `stages`, `steps`, `tasks`, `nodes` or `workflow_steps` returned by XYOps
and renders it as a run timeline.

Each normalized Event and Workflow receives a deterministic `schemaVersion`
derived from its executable contract. Saved routes retain the version they were
reviewed against. Catalog changes are stored in a bounded D1 history, and the
Settings screen reports compatibility plus the added, changed and removed
process counts for every retained synchronization.

## Schema-driven XYOps self-service

The **Automation** section is generated from `GET /api/app/get_events/v1` and
does not require a dashboard code change when a new XYOps Event or Workflow is
published. The server normalizes XYOps field metadata and supports text,
password, textarea, number, boolean, select, multiselect, date, datetime, and
JSON controls, including defaults, required flags, ranges, descriptions,
destinations, and targets.

Launching a process uses `POST /api/integrations/catalog/run`. The server
reloads the catalog, confirms that the selected process exists and is enabled,
validates every submitted value, rejects unknown targets, and then builds the
`run_event` payload. Fields are routed to `params`, `input.data`, or
`workflowData` according to their XYOps metadata. The API key stays server-side.
When XYOps is not configured, the catalog is explicitly marked as unavailable
and no process can be started. Set `DEMO_MODE=true` only when you intentionally
want the non-mutating example catalog, including a database-backup Workflow.

Every accepted or rejected launch is recorded in the `operation_runs` D1 table
without raw XYOps response bodies or submitted secret fields. The Operations
page reads this persistent journal from `GET /api/integrations/runs`. While a
job is active, the server compares its ID with the read-only
`GET /api/app/get_active_jobs/v1` response and normalizes XYOps states to
`queued`, `running`, `success`, `failed`, or `unknown`. The UI refreshes the
journal automatically and derives overview counters from the stored records.

### Inspect a real XYOps contract

Before enabling the portal against a real instance, run the read-only contract
inspector. It records response shapes and sanitized samples without storing the
API key, request headers, or raw response bodies:

```bash
export XYOPS_URL="https://xyops.company.local"
export XYOPS_API_KEY="replace-with-read-only-key"
npm run inspect:xyops
```

Review the resulting `xyops-inspection-*.json` before sharing it. Identifiers,
names, titles, hostnames, URLs, and secret-like properties are redacted by
default. See [docs/XYOPS_INSPECTOR.md](docs/XYOPS_INSPECTOR.md) for all safety
properties, options, and the expected handoff.

## Local production deployment with Docker

Create the local environment file and replace all placeholder addresses and
secrets:

```bash
cp .env.example .env
# .env.example includes a fixed public encryption key for local testing.
# Generate a private administrator token and place it into .env:
openssl rand -hex 32  # ADMIN_TOKEN
docker compose up -d --build
docker compose ps
```

Open `http://localhost:3000`. To use another host port, set
`DASHBOARD_PORT=8080` in `.env`. Stop the service with `docker compose down`.

The container is non-root, read-only, drops Linux capabilities, and exposes
only the dashboard port. The named `dashboard-data` volume persists the local
D1/SQLite database across container restarts. It must have network access to
the configured FreeIPA and XYOps addresses. FreeIPA needs a certificate trusted
by Node.js inside the container; for an internal CA, add the CA certificate to a
derived image and set `NODE_EXTRA_CA_CERTS` to its container path. TLS
verification is not disabled.

Open **Settings**, enter the `ADMIN_TOKEN` from `.env`, and select **Open
settings**. Saved non-secret values are stored in D1/SQLite. FreeIPA passwords
and XYOps API keys are encrypted with AES-256-GCM using
`CONFIG_ENCRYPTION_KEY`. Empty secret inputs retain the currently stored value;
the browser never receives it. Changing `CONFIG_ENCRYPTION_KEY` after saving
settings makes the encrypted values unreadable, so back up both the volume and
the `.env` file securely. The fixed `CONFIG_ENCRYPTION_KEY` in the example is
public and intended only for an isolated local test environment. Replace it
with `openssl rand -hex 32` before any production or shared deployment.

At runtime, FreeIPA credentials are used only by the server-side proxy for
`user_find` and `group_find`. The browser never receives the password. If an
integration is not configured, the UI displays an explicit `OFF` state and
does not invent directory records or jobs. Mutations are validated server-side
and sent to the selected XYOps Event or Workflow route. Demo records and demo
jobs exist only when `DEMO_MODE=true` is set deliberately.

## Workspace Auth Headers

OpenAI workspace sites can read the current user's email from
`oai-authenticated-user-email`.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Diagnostic Commands

- `npm run install:ci`: perform the one bounded lockfile install
- `npm run dev`: start the Vite/Vinext development server
- `npm run build`: build and validate the deployable Sites artifact
- `npm run start`: start the built Vinext application
- `npm run start:docker`: start the built Worker with persistent local D1 (used by Docker)
- `npm test`: build, validate, and verify the rendered development-preview metadata
- `npm run validate:artifact`: recheck an existing artifact's manifest and ESM `default.fetch` export
- `npm run db:generate`: generate Drizzle migrations after schema changes

Use build and validation commands for targeted diagnosis after a remote failure, not as part of the normal checkpoint path.

The timeout defaults can be overridden for a controlled canary with `SITES_INSTALL_TIMEOUT`, `SITES_INSTALL_KILL_AFTER`, `SITES_BUILD_TIMEOUT`, and `SITES_BUILD_KILL_AFTER`. A timeout fails the command; the helpers never retry an unchanged install or build.

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
