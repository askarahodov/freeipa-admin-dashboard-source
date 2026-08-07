# Operational Overview design

Issue: #97  
Epic: #92

## Goal

Turn Overview into an operational summary that answers, in order:

1. What requires attention now?
2. Is the portal core healthy?
3. Are FreeIPA and XYOps integrations available?
4. What happened recently?
5. What can this role do next?

## Source semantics

Portal core health must reuse the existing `/health/ready` contract. Canonical readiness checks are `database`, `schema`, `encryption` and `gateway`, each with `healthy|unready` state and bounded safe code.

Overview must not surface readiness metadata such as build version or schema versions, internal URLs, secrets or raw errors.

FreeIPA and XYOps reachability are shown as integration states. Their degradation must never be rendered as if the portal core itself were down.

## Information hierarchy

### Attention required

Rendered first only when attention exists. Sources may include:

- pending approvals;
- failed operations;
- degraded FreeIPA or XYOps integration;
- stale/catalog review signal;
- unready portal-core checks.

Red is reserved for failed/core-unready states. Amber is used for degraded/review/pending states.

### System health

A quiet row-based list, not success cards:

- Portal core;
- Database;
- Schema;
- Encryption;
- FreeIPA Gateway;
- FreeIPA;
- XYOps.

Healthy rows should visually recede.

### Recent operations

Compact list/table-style rows with status, title, actor and time. The section links to the full Operations screen.

### Quick actions

Only actions supplied by the caller after existing RBAC/capability filtering. The Overview component does not infer permissions.

## Visual rules

- no decorative KPI card grid;
- no hover lift;
- no gradients;
- no persistent shadows;
- one calm bordered surface per section;
- semantic color appears mostly in status/attention labels;
- counts are shown only inside actionable attention rows.

## Integration boundary

The first implementation creates a pure operational model and render component. `app/page.tsx` remains untouched while it is a shared high-conflict monolith. Existing Home state will later map into this component through a targeted patch.
