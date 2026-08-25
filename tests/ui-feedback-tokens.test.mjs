import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../app/ui/ui.module.css", import.meta.url), "utf8");
const tokens = readFileSync(new URL("../app/styles/tokens.css", import.meta.url), "utf8");

test("feedback surfaces consume semantic design tokens", () => {
  for (const token of [
    "--ui-color-success-border",
    "--ui-color-warning-border",
    "--ui-color-danger-hover",
    "--ui-color-danger-border",
    "--ui-color-info-border",
    "--ui-color-primary-border",
  ]) {
    assert.match(tokens, new RegExp(token.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"), "u"));
    assert.match(css, new RegExp(`var\\(${token.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\)`, "u"));
  }
});

test("shared feedback CSS does not reintroduce literal semantic border or hover colors", () => {
  assert.doesNotMatch(css, /border-color:\s*#[0-9a-f]{6}/iu);
  assert.doesNotMatch(css, /background:\s*#[0-9a-f]{6}/iu);
});
