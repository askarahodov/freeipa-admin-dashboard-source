import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
const overlays = readFileSync(new URL("../../app/shell/PortalOverlays.tsx", import.meta.url), "utf8");

function hasNamedImportFrom(source, modulePath) {
  const escapedPath = modulePath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`import\\s*\\{[^}]+\\}\\s*from\\s*["']${escapedPath}["']`, "u").test(source);
}

test("Home and portal overlays delegate presentation concerns to the canonical owner", () => {
  assert.equal(hasNamedImportFrom(page, "./shell/home-presentation"), true);
  assert.equal(hasNamedImportFrom(overlays, "./home-presentation"), true);
});

test("ownership guard detects loss of the canonical presentation dependency without binding helper names", () => {
  const renamedCanonicalConsumer = `import { buildSectionId } from "./shell/home-presentation";\nconst id = buildSectionId("Example");`;
  const localDuplicateWithoutOwner = `function buildSectionId(value) { return value.toLowerCase(); }`;

  assert.equal(hasNamedImportFrom(renamedCanonicalConsumer, "./shell/home-presentation"), true);
  assert.equal(hasNamedImportFrom(localDuplicateWithoutOwner, "./shell/home-presentation"), false);
});
