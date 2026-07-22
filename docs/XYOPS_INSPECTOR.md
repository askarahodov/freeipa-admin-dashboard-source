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
