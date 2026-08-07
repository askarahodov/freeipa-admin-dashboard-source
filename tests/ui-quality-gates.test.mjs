import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { contrastRatio, cssPolicyViolations, parseHexTokens, scanSharedUiCss } from "../scripts/ui-quality-policy.mjs";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("canonical UI text and semantic colors meet WCAG AA normal-text contrast", async () => {
  const tokens = parseHexTokens(await read("app/styles/tokens.css"));
  const surface = tokens["--ui-color-surface"];
  const pairs = [
    ["text", tokens["--ui-color-text"], surface],
    ["muted", tokens["--ui-color-muted"], surface],
    ["primary button", "#ffffff", tokens["--ui-color-primary"]],
    ["primary semantic", tokens["--ui-color-primary"], tokens["--ui-color-primary-subtle"]],
    ["success semantic", tokens["--ui-color-success"], tokens["--ui-color-success-subtle"]],
    ["warning semantic", tokens["--ui-color-warning"], tokens["--ui-color-warning-subtle"]],
    ["danger semantic", tokens["--ui-color-danger"], tokens["--ui-color-danger-subtle"]],
    ["info semantic", tokens["--ui-color-info"], tokens["--ui-color-info-subtle"]],
  ];

  for (const [label, foreground, background] of pairs) {
    assert.ok(foreground && background, `${label}: missing canonical color token`);
    const ratio = contrastRatio(foreground, background);
    assert.ok(ratio >= 4.5, `${label}: expected >= 4.5:1, received ${ratio.toFixed(3)}:1`);
  }
});

test("shared redesign CSS stays within the calm visual policy", async () => {
  const result = await scanSharedUiCss(new URL("..", import.meta.url).pathname);
  assert.ok(result.files.length > 0, "expected at least the #93 shared UI stylesheet");
  assert.deepEqual(result.violations, []);
});

test("visual policy rejects linear, radial and conic gradients", () => {
  for (const gradient of [
    "linear-gradient(red, blue)",
    "radial-gradient(red, blue)",
    "conic-gradient(red, blue)",
  ]) {
    assert.equal(cssPolicyViolations(`background: ${gradient};`, "fixture.css").length, 1, gradient);
  }
});

test("visual policy rejects mixed non-canonical elevation even with the overlay token present", () => {
  const violations = cssPolicyViolations(
    "box-shadow: var(--ui-shadow-overlay), 0 1px 2px rgb(0 0 0 / 20%);",
    "fixture.css",
  );
  assert.equal(violations.length, 1);
});

test("shared controls expose explicit keyboard focus and icon buttons require accessible names", async () => {
  const css = await read("app/ui/ui.module.css");
  const iconButton = await read("app/ui/IconButton.tsx");
  assert.match(css, /:focus-visible/u);
  assert.match(iconButton, /"aria-label": string/u);
});

test("future shared form/dialog modules are checked automatically when present", async () => {
  const source = await read("scripts/ui-quality-policy.mjs");
  assert.match(source, /app\/ui/u);
  assert.match(source, /app\/shell/u);
  assert.match(source, /app\/overview/u);
});
