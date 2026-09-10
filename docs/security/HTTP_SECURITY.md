# HTTP security baseline

## Scope

This document describes the **current Node production response-header baseline** for Admin Dashboard Softrust. It is intentionally narrower than the full TLS/CSP work tracked by #53.

The canonical Node response policy owner is `scripts/node-runtime-http.mjs`. `scripts/node-worker-host.mjs` applies the same policy to host-level failure responses that bypass normal Worker/static response serialization.

## Enforced baseline

The Node production host enforces these response headers:

| Header | Value | Purpose |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME sniffing away from the declared content type. |
| `X-Frame-Options` | `DENY` | Block framing of portal responses in legacy/current browsers that honor this header. |
| `Referrer-Policy` | `no-referrer` | Prevent the portal URL from being sent as referrer metadata. |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | Disable browser capabilities the current portal does not require while preserving the stricter restrictions already used by the diagnostics surface. |

These values are host-owned. If a Worker response supplies a weaker value for one of these headers, the Node boundary replaces it with the canonical value before sending the response. The host-owned permissions baseline is intentionally at least as restrictive as the pre-existing `/diagnostics/health` policy, so centralization does not re-enable `payment` or `usb` there.

The baseline applies to normal Worker/API responses and static assets written through `writeWebResponse()`. Host-level runtime failures and shutdown-unavailable responses use the same policy helper so those paths do not silently lose the baseline.

## What is not implemented by this baseline

This slice does **not** claim that the full #53 browser-security profile is complete. In particular, current completion still requires separate implementation and acceptance evidence for:

- `Content-Security-Policy`, including portal navigation/forms/download/image compatibility and violation-free browser proof;
- CSP report-only migration behavior, if retained by the final design;
- HSTS only for an explicitly verified HTTPS production profile;
- the repository-owned TLS/reverse-proxy server profile and its acceptance tests;
- any additional response-header matrix that depends on content type or HTTPS state.

Do not add permissive CSP, wildcard CORS, or unconditional HSTS merely to mark #53 complete.

## Trusted proxy relationship

Forwarded request scheme trust is a separate boundary. The Node host accepts `X-Forwarded-Proto` only through the current trusted-proxy mode/shared-secret proof documented in `../operations/NETWORK_CONFIGURATION.md` and `.env.example`.

The response-header baseline does not make an untrusted forwarded request trusted and does not replace host publication, firewall, TLS certificate, or reverse-proxy header-sanitization controls.

## Verification

Automated Node runtime tests verify that:

- stronger host values replace weaker Worker-provided header values;
- the centralized permissions baseline does not weaken the existing diagnostics capability restrictions;
- static assets receive the same baseline;
- host-level runtime failures receive the same baseline.

Full #53 completion additionally requires browser/profile acceptance for the controls listed above.
