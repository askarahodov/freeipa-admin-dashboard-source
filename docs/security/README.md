# Security documentation

This section contains focused product-security and supply-chain documentation.

- [`SECURITY_MODEL.md`](SECURITY_MODEL.md) — current product security model, trust boundaries, identity classes and secret/recovery invariants.
- [`LOCAL_AUTH_RBAC.md`](LOCAL_AUTH_RBAC.md) — canonical local portal authentication, session, brute-force protection, role and access-management contract.
- [`DEPENDENCY_SECURITY.md`](DEPENDENCY_SECURITY.md) — production dependency audit, SBOM, runtime image scanning, temporary exceptions and upgrade/rollback policy.
- [`AUDIT_LOG.md`](AUDIT_LOG.md) — append-only audit contract, correlation, redaction and authorized read boundary.
- [`AUDIT_QUERY_EXAMPLES.md`](AUDIT_QUERY_EXAMPLES.md) — practical audit query scenarios for the canonical audit contract.

Operational recovery/security runbooks remain at their current canonical paths until their own explicit #268 migration slices. The former root `docs/SECURITY_MODEL.md` and `docs/LOCAL_AUTH_RBAC.md` paths are retained only as relocation pointers for existing external links.
