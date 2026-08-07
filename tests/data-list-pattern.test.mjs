import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("data-list components remain domain agnostic", async () => {
  const files = ["DataListPage", "DataTable", "DataListState", "Pagination"];
  const sources = await Promise.all(files.map((name) => read(`app/ui/data-list/${name}.tsx`)));
  const all = sources.join("\n");
  for (const forbidden of ["fetch(", "FreeIPA", "XYOps", "/api/", "localStorage", "sessionStorage"]) {
    assert.equal(all.includes(forbidden), false, `domain coupling: ${forbidden}`);
  }
});

test("data table keeps native semantics", async () => {
  const source = await read("app/ui/data-list/DataTable.tsx");
  assert.match(source, /<table/);
  assert.match(source, /TableHTMLAttributes<HTMLTableElement>/);
  assert.match(source, /role="region"/);
});

test("data-list states are explicit and pagination is accessible", async () => {
  const state = await read("app/ui/data-list/DataListState.tsx");
  for (const kind of ["loading", "empty", "filtered-empty", "error", "forbidden"]) {
    assert.ok(state.includes(`"${kind}"`), `missing state kind: ${kind}`);
  }
  const pagination = await read("app/ui/data-list/Pagination.tsx");
  assert.match(pagination, /aria-label="Пагинация"/);
  assert.match(pagination, /page <= 1/);
  assert.match(pagination, /page >= totalPages/);
});

test("data-list styles stay calm and responsive", async () => {
  const css = await read("app/ui/data-list/data-list.module.css");
  assert.match(css, /@import\s+["']\.\.\/\.\.\/styles\/tokens\.css["']/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.equal(css.includes("translateY("), false);
  assert.equal(css.includes("box-shadow"), false);
  assert.equal(css.includes("position: fixed"), false);
});
