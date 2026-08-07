import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Home consumes the extracted navigation contract instead of owning a second route table", () => {
  assert.match(page, /from\s+["']\.\/shell\/home-navigation["']/u);
  assert.match(page, /\bbuildHomePath\s*\(/u);
  assert.match(page, /\bresolveHomeLocation\s*\(/u);

  assert.doesNotMatch(page, /\bconst\s+pagePaths\b/u);
  assert.doesNotMatch(page, /Object\.entries\(pagePaths\)/u);
});

test("Home keeps History API navigation while delegating path semantics", () => {
  assert.match(page, /window\.history\[replace\s*\?\s*["']replaceState["']\s*:\s*["']pushState["']\]/u);
  assert.match(page, /window\.addEventListener\(["']popstate["']/u);
  assert.match(page, /window\.removeEventListener\(["']popstate["']/u);

  assert.doesNotMatch(page, /nextPage\s*===\s*["']automation["'][^\n]*`\/automation\/\$\{section\.slug\}`/u);
});
