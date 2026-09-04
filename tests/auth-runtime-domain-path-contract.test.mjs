import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const canonicalPaths = [
  "src/auth/local-auth.ts",
  "src/auth/local-session-management.ts",
  "src/auth/admin-session-authorization.ts",
];

test("runtime auth implementations live only under src/auth", async () => {
  for (const canonicalPath of canonicalPaths) {
    const canonical = await readFile(new URL(`../${canonicalPath}`, import.meta.url), "utf8");
    assert.ok(canonical.length > 100, `${canonicalPath} must own the implementation`);
    const rootPath = canonicalPath.replace("src/auth/", "");
    await assert.rejects(access(new URL(`../${rootPath}`, import.meta.url)), { code: "ENOENT" });
  }
});
