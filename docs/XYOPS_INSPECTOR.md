# XYOps Contract Inspector

The inspector performs read-only requests against a test or production XYOps
instance and creates a sanitized JSON report. Its purpose is to replace guessed
field mappings with the exact API contracts returned by your installed XYOps
version.

## Safety properties

- only `GET` probes are performed;
- the API key is read from `XYOPS_API_KEY` and is never written to the report;
- authorization headers and raw response bodies are not stored;
- password, secret, token, key, cookie, credential, and session properties are
  replaced with `[REDACTED]`;
- hostnames, IDs, titles, names, descriptions, usernames, and URLs are replaced
  with typed placeholders by default;
- reports are created with mode `0600` and their timestamped filenames are
  ignored by Git.

The report retains JSON property names and safe structural values such as field
types, destinations, required flags, ranges, and enabled states. Always review
the generated file before sharing it because custom property names may still
describe internal concepts.

## Run

Use a dedicated read-only XYOps API key where possible. Do not put the key in a
command-line argument:

```bash
export XYOPS_URL="https://xyops.company.local"
export XYOPS_API_KEY="replace-with-read-only-key"
npm run inspect:xyops
```

The command probes the Event catalog plus optional server, server-group,
Toolset, and active-job endpoints. Unsupported optional endpoints are recorded
as failures without preventing creation of the report. Failure of the Event
catalog sets a non-zero exit code because that contract is required by the
portal.

Inspector version 2 also classifies failures that happen before an HTTP
response. The report records only a safe category, an allowlisted system error
code and a generic hint; it never stores the raw error message or target
address. Common categories are `dns`, `tls`, `timeout`,
`connection_refused`, `connection_reset` and `network`.

If every probe has `status: 0`, first read `results[].error.category` and
`results[].error.hint`. This means no XYOps API contract was received yet:

- `dns`: run the inspector on a computer connected to the required DNS/VPN;
- `tls`: add the organization's CA certificate to Node.js trust with
  `NODE_EXTRA_CA_CERTS=/path/to/company-ca.pem` and run again;
- `connection_refused`: verify the XYOps scheme and port;
- `timeout`: verify routing, firewall/VPN and increase `--timeout` if needed;
- `network`: verify Node.js meets the version in `package.json`, then check the
  URL, proxy and TLS configuration.

Do not disable TLS verification and do not add credentials to the URL.

To choose the output path:

```bash
npm run inspect:xyops -- --output ./xyops-inspection.json
```

Use `--include-names` only when preserving identifiers, labels, and the XYOps
hostname is acceptable. It still redacts secret-like properties and URLs, and
never stores the API key:

```bash
npm run inspect:xyops -- --include-names
```

## What to send back

After reviewing the file, provide the generated `xyops-inspection-*.json`.
With that report the dashboard adapter can be updated for the actual Event,
Workflow, Toolset, target, and job response shapes without receiving network
access or credentials.
