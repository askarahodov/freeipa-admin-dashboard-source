# Portal identity and RBAC security

The portal applies authorization in two layers:

1. `worker/secure-entry.ts` decides whether an incoming identity is trusted and removes spoofable identity headers.
2. The application worker maps the resulting identity to `viewer`, `operator`, or `admin` and checks permissions on every mutation endpoint.

An unauthenticated request is always `viewer`. A missing or invalid identity configuration never grants administrator rights, even when an old `PORTAL_DEFAULT_ROLE=admin` or wildcard RBAC assignment remains in the environment.

## Identity modes

### `anonymous`

This is the application default. All identity headers are removed and every request is read-only.

```env
PORTAL_IDENTITY_MODE=anonymous
PORTAL_DEFAULT_ROLE=viewer
```

Use this while authentication is not configured.

### `workspace`

Use only on OpenAI Sites, where the hosting platform injects trusted `oai-authenticated-user-*` headers.

```env
PORTAL_IDENTITY_MODE=workspace
PORTAL_DEFAULT_ROLE=viewer
PORTAL_RBAC_JSON={"admin@company.local":"admin","ops@company.local":"operator"}
PORTAL_GROUPS_JSON={"admin@company.local":["ops-leads"],"ops@company.local":["operations"]}
```

Do not use this mode on a directly exposed generic web server, because such a server does not guarantee that the `oai-*` headers were added by a trusted platform.

### `proxy`

Use behind an authenticated reverse proxy. The proxy must remove any client-supplied identity, group, and secret headers, authenticate the user, and then inject fresh values.

```env
PORTAL_IDENTITY_MODE=proxy
PORTAL_IDENTITY_HEADER=x-auth-request-email
PORTAL_IDENTITY_NAME_HEADER=x-auth-request-user
PORTAL_GROUPS_HEADER=x-auth-request-groups
PORTAL_PROXY_SECRET_HEADER=x-portal-proxy-secret
PORTAL_PROXY_SHARED_SECRET=replace-with-a-long-random-secret
PORTAL_DEFAULT_ROLE=viewer
PORTAL_RBAC_JSON={"admin@company.local":"admin","ops@company.local":"operator","audit@company.local":"viewer"}
```

The portal accepts proxy identity and groups only when the shared-secret header matches `PORTAL_PROXY_SHARED_SECRET`. Forged `oai-authenticated-user-*` headers are discarded in this mode.

Example Nginx rules after the authentication layer has produced `$authenticated_email`, `$authenticated_name`, and `$authenticated_groups`:

```nginx
# Never forward identity values supplied by the client.
proxy_set_header Oai-Authenticated-User-Email "";
proxy_set_header Oai-Authenticated-User-Full-Name "";
proxy_set_header Oai-Authenticated-User-Groups "";
proxy_set_header X-Auth-Request-Email "";
proxy_set_header X-Auth-Request-User "";
proxy_set_header X-Auth-Request-Groups "";
proxy_set_header X-Portal-Proxy-Secret "";

# Inject values created by the trusted authentication layer.
proxy_set_header X-Auth-Request-Email $authenticated_email;
proxy_set_header X-Auth-Request-User $authenticated_name;
proxy_set_header X-Auth-Request-Groups $authenticated_groups;
proxy_set_header X-Portal-Proxy-Secret "replace-with-the-same-long-random-secret";
proxy_pass http://127.0.0.1:3001;
```

The dashboard port should not be reachable directly when proxy mode is used. Firewall rules should permit access only through the reverse proxy.

### `static`

This mode assigns one server-configured identity to every request. It exists for an isolated developer workstation and local Compose testing only.

```env
PORTAL_IDENTITY_MODE=static
PORTAL_STATIC_IDENTITY=admin@company.local
PORTAL_STATIC_GROUPS=operations,dba
PORTAL_DEFAULT_ROLE=viewer
PORTAL_RBAC_JSON={"admin@company.local":"admin"}
```

Never use static mode on a shared or internet-accessible deployment.

## Trusted groups

The security entry point always deletes incoming `oai-authenticated-user-groups`.
It then builds the internal group list from one or more trusted sources:

- `PORTAL_STATIC_GROUPS` in static mode;
- `PORTAL_GROUPS_JSON` identity mapping in any authenticated mode;
- `PORTAL_GROUPS_HEADER` in proxy mode after shared-secret validation.

Group names are normalized to lowercase, deduplicated, limited to 100 entries, and cannot contain line breaks. The internal header is never accepted directly from the client.

## Roles

| Role | Permissions |
| --- | --- |
| `viewer` | Read users, groups, catalog, operation history, notifications, and visible approval requests |
| `operator` | Viewer permissions, non-destructive FreeIPA changes, XYOps launches, and management of the operator's own approval requests |
| `admin` | Operator permissions, deletion, `xyops.approve`, persistent settings, route and policy management |

`xyops.approve` only permits submitting a decision. The approval policy still checks approver roles/groups and normally forbids the requester from approving the request they created.

`ADMIN_TOKEN` is not an approval credential. It protects policy and connection settings; daily approve/reject actions use the authenticated portal identity.

Keep `PORTAL_DEFAULT_ROLE=viewer`. Grant wider roles only through explicit email assignments in `PORTAL_RBAC_JSON`.

## Production checklist

- Put the dashboard behind an authentication layer.
- Keep the dashboard application port inaccessible from untrusted networks.
- Use `workspace` only on OpenAI Sites; use `proxy` for a normal reverse proxy.
- Generate independent random values for `ADMIN_TOKEN`, `CONFIG_ENCRYPTION_KEY`, and `PORTAL_PROXY_SHARED_SECRET`.
- Strip incoming identity and group headers at the proxy boundary before injecting trusted values.
- Keep the default role as `viewer` and avoid wildcard administrator assignments.
- Test direct calls to mutation APIs and confirm that anonymous requests receive HTTP 403.
- Test catalog policy denies through both the UI and direct `catalog/run` API calls.
- Test that dangerous processes create approval requests and do not call XYOps before an independent decision.
- Test that an approval cannot be reused and that a dangerous safe re-run creates a new request.
- Back up the encrypted settings database together with `CONFIG_ENCRYPTION_KEY`.
- Ограничьте доступ к `/audit` администраторами и проверяйте correlation-цепочки для опасных операций.
- Не добавляйте UPDATE/DELETE API для `portal_audit_events`; таблица защищена append-only триггерами.
