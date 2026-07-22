# XYOps Automation Portal — product roadmap

## Product contract

The portal is a generated user interface and visualization layer over XYOps.
XYOps remains the source of truth and the only automation orchestrator. Events,
Workflows, execution logic and operational integrations are not duplicated in
the portal.

The portal must discover XYOps metadata, turn it into navigable sections and
validated forms, launch the original XYOps process, and visualize its lifecycle
for the user. FreeIPA is the first domain module, not a limit of the platform.

## Delivery backlog

### P0 — dynamic execution core

- [x] Read and normalize Events and Workflows from `get_events`.
- [x] Generate forms from field types, requirements, options and targets.
- [x] Route submitted values to `params`, `input.data` and `workflowData`.
- [x] Launch the original process through `run_event` without exposing API keys.
- [x] Persist operation history and synchronize active job states.
- [x] Persist admin configuration and route mappings with encrypted secrets.
- [x] Persist a safe catalog snapshot and detect added, changed and removed schemas.
- [x] Generate portal category navigation from XYOps categories.

### P1 — real XYOps contract hardening

- [ ] Validate normalization against a sanitized diagnostic export from the target XYOps installation.
- [ ] Support conditional fields, nested groups, dependencies and remote option providers exposed by XYOps.
- [ ] Add explicit process/version identifiers and a schema compatibility report.
- [ ] Refresh route schemas from their source Event or Workflow with a reviewed change summary.
- [ ] Add scheduled catalog synchronization and retention of schema history.

### P1 — execution visualization

- [ ] Add a process run details page with workflow stages, timing and sanitized output.
- [ ] Add retry, cancel and safe re-run where the XYOps contract supports them.
- [ ] Render process-specific result widgets, files and links from declared output metadata.
- [ ] Add notifications for completion and failure.

### P1 — portal governance

- [ ] Add roles and policies for catalog visibility and execution permissions.
- [ ] Add approval gates for dangerous or privileged processes.
- [ ] Extend the audit trail with actor, approval and schema-version context.
- [ ] Add rate limits and per-process concurrency controls.

### P2 — administration modules

- [ ] Add generated FreeIPA user/group detail surfaces backed by declared XYOps actions.
- [ ] Add reusable presentation templates for database backups, infrastructure maintenance and access requests.
- [ ] Add administrator-controlled labels, icons, ordering and help text without forking process schemas.
- [ ] Add multilingual presentation metadata.

## Definition of done for a generated process

A newly published XYOps Event or Workflow appears after synchronization without
a portal code change, in the correct generated category, with all supported
fields and validation. A permitted user can launch it, follow its real XYOps
job state, and inspect a sanitized result. Schema changes are visible before
they affect a saved route. No API key, password, secret default or raw sensitive
response is returned to the browser or written to the audit journal.
