import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const components = ["FormField", "FormSection", "FormErrorSummary", "Dialog", "DialogFooter"];

test("form/dialog primitives exist and stay domain agnostic", async () => {
  const sources = await Promise.all(components.map((name) => read(`app/ui/forms/${name}.tsx`)));
  const all = sources.join("\n");
  for (const forbidden of ["fetch(", "/api/", "FreeIPA", "XYOps", "PortalRole", "window.confirm", "window.prompt", "portalConfirmed", "УДАЛИТЬ"]) {
    assert.equal(all.includes(forbidden), false, `domain or confirmation coupling: ${forbidden}`);
  }
});

test("FormField associates help and errors with its control", async () => {
  const source = await read("app/ui/forms/FormField.tsx");
  assert.match(source, /aria-describedby/);
  assert.match(source, /aria-invalid/);
  assert.match(source, /htmlFor/);
  assert.match(source, /required/);
  assert.match(source, /optional/);
});

test("FormErrorSummary is an accessible form-level alert", async () => {
  const source = await read("app/ui/forms/FormErrorSummary.tsx");
  assert.match(source, /role="alert"/);
  assert.match(source, /href=\{`#\$\{item\.fieldId\}`\}/);
});

test("Dialog owns ordinary modal keyboard semantics and returns focus", async () => {
  const source = await read("app/ui/forms/Dialog.tsx");
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /previousFocusRef/);
  assert.match(source, /\.focus\(\)/);
});

test("DialogFooter separates danger content from ordinary actions", async () => {
  const source = await read("app/ui/forms/DialogFooter.tsx");
  assert.match(source, /danger/);
  assert.match(source, /actions/);
});

test("form/dialog styles consume #93 tokens without decorative UI effects", async () => {
  const css = await read("app/ui/forms/forms.module.css");
  assert.match(css, /@import\s+["']\.\.\/\.\.\/styles\/tokens\.css["']/);
  assert.match(css, /var\(--ui-radius-lg\)/);
  assert.match(css, /var\(--ui-shadow-overlay\)/);
  assert.equal(css.includes("linear-gradient"), false);
  assert.equal(css.includes("translateY("), false);
  assert.equal(css.includes("box-shadow: 0 1px"), false);
});

test("form/dialog primitives are exported through the shared UI entrypoint", async () => {
  const source = await read("app/ui/index.ts");
  assert.match(source, /from "\.\/forms"/);
});
