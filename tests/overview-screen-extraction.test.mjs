import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const overview = readFileSync(new URL("../app/overview/LegacyOverview.tsx", import.meta.url), "utf8");

test("Home delegates legacy Overview presentation to a screen component", () => {
  assert.match(page, /from\s+["']\.\/overview\/LegacyOverview["']/u);
  assert.match(page, /<LegacyOverview\b/u);
  assert.doesNotMatch(page, /function\s+Overview\s*\(/u);
  assert.doesNotMatch(page, /function\s+Metric\s*\(/u);
});

test("Overview extraction preserves the existing navigation and recent-operation boundary", () => {
  assert.match(page, /goToOperations=\{\(\) => navigateTo\(["']operations["']\)\}/u);
  assert.match(page, /recentOperations=\{<OperationTable rows=\{recentRuns\.slice\(0, 4\)\} \/>\}/u);
  assert.match(overview, /onClick=\{goToOperations\}/u);
  assert.match(overview, /Состояние подключения/u);
  assert.match(overview, /Последние операции/u);
});
