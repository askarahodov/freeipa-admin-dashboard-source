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
```

Do not use this mode on a directly exposed generic web server, because such a server does not guarantee that the `oai-*` headers were added by a trusted platform.

### `proxy`

Use behind an authenticated reverse proxy. The proxy must remove any client-supplied identity and secret headers, authenticate the user, and then inject fresh values.

```env
PORTAL_IDENTITY_MODE=proxy
PORTAL_IDENTITY_HEADER=x-auth-request-email
PORTAL_IDENTITY_NAME_HEADER=x-auth-request-user
PORTAL_PROXY_SECRET_HEADER=x-portal-proxy-secret
PORTAL_PROXY_SHARED_SECRET=replace-with-a-long-random-secret
PORTAL_DEFAULT_ROLE=viewer
PORTAL_RBAC_JSON={"admin@company.local":"admin","ops@company.local":"operator","audit@company.local":"viewer"}
```

The portal accepts the proxy identity only when the shared-secret header matches `PORTAL_PROXY_SHARED_SECRET`. A forged `oai-authenticated-user-email` header is discarded in this mode.

Example Nginx rules after the authentication layer has produced `$authenticated_email` and `$authenticated_name`:

```nginx
# Never forward identity values supplied by the client.
proxy_set_header Oai-Authenticated-User-Email "";
proxy_set_header Oai-Authenticated-User-Full-Name "";
proxy_set_header X-Auth-Request-Email "";
proxy_set_header X-Auth-Request-User "";
proxy_set_header X-Portal-Proxy-Secret "";

# Inject values created by the trusted authentication layer.
proxy_set_header X-Auth-Request-Email $authenticated_email;
proxy_set_header X-Auth-Request-User $authenticated_name;
proxy_set_header X-Portal-Proxy-Secret "replace-with-the-same-long-random-secret";
proxy_pass http://127.0.0.1:3001;
```

The dashboard port should not be reachable directly when proxy mode is used. Firewall rules should permit access only through the reverse proxy.

### `static`

This mode assigns one server-configured identity to every request. It exists for an isolated developer workstation and local Compose testing only.

```env
PORTAL_IDENTITY_MODE=static
PORTAL_STATIC_IDENTITY=admin@company.local
PORTAL_DEFAULT_ROLE=viewer
PORTAL_RBAC_JSON={"admin@company.local":"admin"}
```

Never use static mode on a shared or internet-accessible deployment.

## Roles

| Role | Permissions |
| --- | --- |
| `viewer` | Read users, groups, catalog, and operation history |
| `operator` | Viewer permissions, non-destructive FreeIPA changes, XYOps launches |
| `admin` | Operator permissions, deletion, persistent settings, route management |

Keep `PORTAL_DEFAULT_ROLE=viewer`. Grant wider roles only through explicit email assignments in `PORTAL_RBAC_JSON`.

## Production checklist

- Put the dashboard behind an authentication layer.
- Keep the dashboard application port inaccessible from untrusted networks.
- Use `workspace` only on OpenAI Sites; use `proxy` for a normal reverse proxy.
- Generate independent random values for `ADMIN_TOKEN`, `CONFIG_ENCRYPTION_KEY`, and `PORTAL_PROXY_SHARED_SECRET`.
- Strip incoming identity headers at the proxy boundary before injecting trusted values.
- Keep the default role as `viewer` and avoid wildcard administrator assignments.
- Test direct calls to mutation APIs and confirm that anonymous requests receive HTTP 403.
- Back up the encrypted settings database together with `CONFIG_ENCRYPTION_KEY`.
