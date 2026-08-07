import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("UI foundation exposes canonical semantic tokens", async () => {
  const css = await read("app/styles/tokens.css");
  for (const token of [
    "--ui-font-sans",
    "--ui-font-mono",
    "--ui-color-canvas",
    "--ui-color-surface",
    "--ui-color-text",
    "--ui-color-muted",
    "--ui-color-border",
    "--ui-color-primary",
    "--ui-color-danger",
    "--ui-focus-ring",
    "--ui-radius-sm",
    "--ui-radius-md",
    "--ui-radius-lg",
    "--ui-control-height",
    "--ui-shadow-overlay",
  ]) {
    assert.ok(css.includes(token), `missing token: ${token}`);
  }
  assert.match(css, /--ui-radius-sm:\s*4px/);
  assert.match(css, /--ui-radius-md:\s*6px/);
  assert.match(css, /--ui-radius-lg:\s*8px/);
});

test("shared primitives remain domain agnostic and accessible", async () => {
  const files = ["Button", "IconButton", "TextInput", "Select", "StatusBadge", "Alert", "PageHeader", "Toolbar"];
  const sources = await Promise.all(files.map((name) => read(`app/ui/${name}.tsx`)));
  const all = sources.join("\n");

  for (const forbidden of ["fetch(", "FreeIPA", "XYOps", "localStorage", "sessionStorage", "/api/"]) {
    assert.equal(all.includes(forbidden), false, `domain coupling: ${forbidden}`);
  }

  const iconButton = await read("app/ui/IconButton.tsx");
  assert.match(iconButton, /aria-label/);
});

test("primitive styles consume canonical tokens and expose keyboard focus", async () => {
  const css = await read("app/ui/ui.module.css");
  assert.match(css, /@import\s+["']\.\.\/styles\/tokens\.css["']/);
  assert.match(css, /font-family:\s*var\(--ui-font-sans\)/);
  assert.match(css, /:focus-visible/);
  assert.equal(css.includes("translateY("), false);
});
