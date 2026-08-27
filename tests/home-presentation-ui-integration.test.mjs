import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const overlays = readFileSync(new URL("../app/shell/PortalOverlays.tsx", import.meta.url), "utf8");

test("Home and portal overlays consume the extracted presentation contract", () => {
  assert.match(page, /from\s+["']\.\/shell\/home-presentation["']/u);
  assert.match(page, /\bbuildAutomationSlug\(/u);
  assert.doesNotMatch(page, /\bresolveProcessIconGlyph\(/u);
  assert.match(overlays, /from\s+["']\.\/home-presentation["']/u);
  assert.match(overlays, /\bresolveProcessIconGlyph\(/u);
  assert.doesNotMatch(page, /function\s+automationSlug\s*\(/u);
  assert.doesNotMatch(page, /function\s+processIconGlyph\s*\(/u);
  assert.doesNotMatch(overlays, /function\s+processIconGlyph\s*\(/u);
  assert.doesNotMatch(page, /const\s+processIconGlyphs\b/u);
  assert.doesNotMatch(overlays, /const\s+processIconGlyphs\b/u);
});
