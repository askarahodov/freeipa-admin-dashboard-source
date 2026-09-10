import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../../app/page.tsx", import.meta.url), "utf8");
const overview = readFileSync(new URL("../../app/overview/OperationalOverview.tsx", import.meta.url), "utf8");

test("Home delegates Overview presentation to the prepared OperationalOverview", () => {
  assert.match(page, /from\s+["']\.\/overview["']/u);
  assert.match(page, /<OperationalOverview\b/u);
  assert.doesNotMatch(page, /from\s+["']\.\/overview\/LegacyOverview["']/u);
  assert.doesNotMatch(page, /<LegacyOverview\b/u);
  assert.doesNotMatch(page, /function\s+Overview\s*\(/u);
  assert.doesNotMatch(page, /function\s+Metric\s*\(/u);
});

test("Operational Overview consumes existing bounded page data instead of a new backend aggregate", () => {
  assert.match(page, /fetch\(["']\/health\/ready["']/u);
  assert.match(page, /pendingApprovals=\{approvalPendingForMe\}/u);
  assert.match(page, /failedOperations=\{runStats\.failed\}/u);
  assert.match(page, /catalogNeedsReview=\{catalogMeta\.stale \|\| catalogMeta\.changes\.length > 0\}/u);
  assert.match(page, /recentOperations=\{overviewOperations\}/u);
  assert.match(page, /quickActions=\{overviewQuickActions\}/u);
  assert.match(overview, /Состояние системы/u);
  assert.match(overview, /Последние операции/u);
  assert.match(overview, /Быстрые действия/u);
});

test("Overview navigation keeps privileged diagnostics and settings role-aware", () => {
  assert.match(page, /case "diagnostics":[\s\S]*canManageSettings[\s\S]*window\.location\.assign\("\/diagnostics"\)/u);
  assert.match(page, /case "settings":[\s\S]*canManageSettings[\s\S]*navigateTo\("settings"\)/u);
  assert.match(page, /attentionTargets=\{canManageSettings/u);
});
