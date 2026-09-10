# HTTP security and TLS reverse proxy

This document defines the Node production HTTP security contract introduced for issue #53.

## Response policy

The Node production host applies one policy to Worker responses and static assets before writing them to the client. The default policy is enforcing and includes:

- `Content-Security-Policy` with `frame-ancestors 'none'`, `object-src 'none'`, same-origin form/connect defaults, and no `unsafe-eval`;
- `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- a minimal `Permissions-Policy` disabling camera, geolocation, microphone, payment, and USB.

The current Vinext/React output still requires inline bootstrap/style compatibility, so the enforcing CSP keeps `unsafe-inline` for `script-src` and `style-src`. Removing those exceptions requires nonce/hash integration with the renderer and must be proven by browser regression tests rather than removed textually.

`PORTAL_CSP_MODE=report-only` is available only as a temporary migration/diagnostic mode. The safe default is enforcing CSP. Before switching a production deployment to report-only, record the reason and rollback window; restore `PORTAL_CSP_MODE=enforce` after violations are resolved.

The middleware does not add CORS headers and does not widen any origin policy.

## HSTS

HSTS is emitted only when both conditions are true:

1. the effective request URL is HTTPS; and
2. `PORTAL_HSTS_ENABLED=true` is explicitly configured.

This prevents an HTTP-only deployment or a forged `X-Forwarded-Proto` header from enabling HSTS. Set `PORTAL_HSTS_ENABLED=true` only for a production hostname that is permanently HTTPS.

## Trusted reverse proxy boundary

The final transport-source rules are owned by the preceding trusted-proxy slice of #53. This header/Nginx follow-up must consume that canonical policy rather than define a weaker independent source check. Forwarded origin metadata is accepted only after the configured trusted-proxy mode, transport-source policy and shared-secret proof have succeeded.

The shared proxy secret is also consumed by the #59 login rate limiter, so it remains available to the Worker until that contract has an explicit migration. For a valid TLS proxy request, the reconstructed request URL is HTTPS. Local authentication therefore emits the existing `Secure; HttpOnly; SameSite=Strict` session cookie without a force-secure-cookie bypass.

## Nginx profile

Use [`../deploy/nginx/portal.conf.template`](../deploy/nginx/portal.conf.template) as the supported example. Set these server-side values before rendering:

- `PORTAL_SERVER_NAME` — public portal hostname;
- `PORTAL_UPSTREAM_HOST` — private portal container/host name;
- `TLS_CERTIFICATE` and `TLS_CERTIFICATE_KEY` — local filesystem certificate paths;
- `PORTAL_TRUSTED_PROXY_SECRET` — a long random secret shared only by Nginx and the portal process.

Render **only** those template placeholders. Unrestricted `envsubst` also substitutes Nginx runtime variables such as `$host`, `$request_uri` and `$remote_addr`, producing an invalid/insecure configuration. Use:

```sh
envsubst '${PORTAL_UPSTREAM_HOST} ${PORTAL_SERVER_NAME} ${TLS_CERTIFICATE} ${TLS_CERTIFICATE_KEY} ${PORTAL_TRUSTED_PROXY_SECRET}' \
  < deploy/nginx/portal.conf.template > /etc/nginx/conf.d/portal.conf
nginx -t
```

The template redirects HTTP to HTTPS, supports TLS 1.2/1.3, sets request-size/time limits, replaces client forwarding metadata instead of appending it, and disables websocket upgrade forwarding. There is no current portal websocket runtime contract; enable upgrades only with a dedicated behavior test and owner.

The portal process behind this TLS profile should use the trusted-proxy source configuration defined by the canonical trusted-proxy policy, the same server-side `PORTAL_TRUSTED_PROXY_SECRET`, optional `PORTAL_HSTS_ENABLED=true` after permanent HTTPS is confirmed, and the default enforcing CSP (use `PORTAL_CSP_MODE=report-only` only for a bounded migration window).

Do not expose `PORTAL_TRUSTED_PROXY_SECRET` to browser code, image layers, logs, or committed files.

## Verification

The contract is protected by:

- `tests/runtime/node-worker-host-security.test.mjs` for forged/trusted forwarded-origin and Secure-cookie decisions in this follow-up until the canonical trusted-proxy slice is rebased in;
- `tests/security/http-security.test.mjs` for CSP, clickjacking, MIME sniffing, referrer/permissions policy, HSTS and download-header preservation;
- `tests/security/nginx-security-profile.test.mjs` for TLS, restricted template rendering, proxy proof, forwarding replacement, body/time limits, redirect and websocket policy.

For production acceptance, also run the repository's auth/browser suite and verify there are no CSP violations during navigation, modals, forms, downloads, RSC transitions, assets and image optimization. This browser acceptance remains required before considering #53 fully complete across every runtime profile.
