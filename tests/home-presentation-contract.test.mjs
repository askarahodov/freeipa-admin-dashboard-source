import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAutomationSlug,
  PROCESS_ICON_GLYPHS,
  resolveProcessIconGlyph,
} from "../app/shell/home-presentation.ts";

test("automation slug preserves the legacy Cyrillic transliteration contract", () => {
  assert.equal(buildAutomationSlug("Резервное копирование БД"), "rezervnoe-kopirovanie-bd");
  assert.equal(buildAutomationSlug("  DevOps / Deploy  "), "devops-deploy");
  assert.equal(buildAutomationSlug("Ёж и щука"), "ezh-i-schuka");
});

test("automation slug is deterministic for labels without latin or cyrillic letters", () => {
  const first = buildAutomationSlug("⚙️");
  const second = buildAutomationSlug("⚙️");

  assert.match(first, /^section-[a-z0-9]+$/u);
  assert.equal(second, first);
});

test("automation slug stays bounded for navigation-safe URLs", () => {
  assert.ok(buildAutomationSlug("Очень длинная категория ".repeat(20)).length <= 80);
});

test("process icon resolution keeps canonical product glyphs", () => {
  assert.equal(resolveProcessIconGlyph(undefined, "event"), PROCESS_ICON_GLYPHS.event);
  assert.equal(resolveProcessIconGlyph(undefined, "workflow"), PROCESS_ICON_GLYPHS.workflow);
  assert.equal(resolveProcessIconGlyph("database", "event"), PROCESS_ICON_GLYPHS.database);
  assert.equal(resolveProcessIconGlyph("backup", "workflow"), PROCESS_ICON_GLYPHS.backup);
});

test("unknown icon identifiers degrade to a compact textual marker", () => {
  assert.equal(resolveProcessIconGlyph("kubernetes", "event"), "KU");
  assert.equal(resolveProcessIconGlyph("x", "workflow"), "X");
});
