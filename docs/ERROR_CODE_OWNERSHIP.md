# Stable error-code ownership

`src/auth/stable-error-contract.ts` is the machine-readable ownership and verification surface for stable error/status codes already verified as contracts. Domain handlers and their tests remain authoritative for emitted behavior and semantics.

Namespaces remain separate: `api`, `status`, and `audit-evidence`. Audit action names, human-readable error messages, exception text, and transient identifiers are not promoted into stable machine contracts.

When a stable code changes, update its domain owner and scoped tests, the registry when it is intentionally stable, and `docs/reference/ERROR_CODES.md` when client/operator reference semantics change. Do not rename or remove an emitted stable code without explicit compatibility analysis.

`tests/stable-error-contract.test.mjs` guards uniqueness, conflicting ownership, namespace-aware lookup, exclusion of human/audit-action strings, and synchronization of registered values with the error-code reference.
