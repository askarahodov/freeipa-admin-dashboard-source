# HTTP security baseline

This document describes the Node/Docker HTTP security slice of issue #53. The trusted forwarded-scheme boundary is owned by `scripts/trusted-proxy-policy.mjs`; this document does not redefine it.

## Response headers

`scripts/http-security.mjs` is the centralized Node response policy. `scripts/node-worker-host.mjs` applies it to Worker responses, static assets and Node-generated 500/503 responses.

The enforcing baseline sends:

- `Content-Security-Policy` with `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, `form-action 'self'` and no `unsafe-eval`;
- `X-Frame-Options: DENY`;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- a minimal `Permissions-Policy` disabling camera, geolocation, microphone, payment and USB.

The middleware does not introduce or widen CORS. Existing status, content type, download disposition and response body are preserved.

The current Vinext/React output still requires inline bootstrap/style compatibility, so `script-src` and `style-src` retain `unsafe-inline`. Removing those tokens requires nonce/hash integration and browser proof; do not remove them by source-text assumption alone.

## CSP rollout

Enforcement is the default. `PORTAL_CSP_MODE=report-only` switches only the CSP header to `Content-Security-Policy-Report-Only` for a bounded migration/debug period. Before returning to enforcement, exercise portal navigation, modals, generated forms, downloads, RSC transitions and image paths and inspect browser CSP violations. Report-only must not become a permanent production bypass.

## HSTS

HSTS is disabled unless `PORTAL_HSTS_ENABLED=true`. Even with that opt-in, the header is emitted only when the effective request URL is HTTPS. For Node/Docker, HTTPS can be established through the authenticated trusted-proxy scheme contract merged in #640. A forged `X-Forwarded-Proto` without that proof remains HTTP and cannot trigger HSTS.

Enable HSTS only after the public hostname is permanently HTTPS and certificate/redirect behavior is verified. Roll back by disabling the opt-in; browsers may retain an already received HSTS policy until its max-age expires.

## Nginx TLS profile

`deploy/nginx/portal.conf.template` is the repository-owned example profile. Render only its documented placeholders so Nginx runtime variables are not expanded accidentally. The profile:

- redirects HTTP to HTTPS;
- permits TLS 1.2 and 1.3;
- replaces forwarded protocol/address and proxy proof instead of appending client input;
- sends the existing `PORTAL_TRUSTED_PROXY_SECRET` proof to the application;
- bounds request size and upstream timeouts;
- deliberately disables websocket upgrade forwarding because the current portal has no owned websocket runtime contract.

The proxy secret is server-side configuration and must never be exposed to clients or committed with a real value.

## Scope and remaining #53 work

This slice covers the Node/Docker response boundary and Nginx deployment profile. Issue #53 remains open until the Worker/Cloudflare response path has equivalent centralized coverage and the required browser CSP/navigation/forms/download/image acceptance run is completed without policy violations.
