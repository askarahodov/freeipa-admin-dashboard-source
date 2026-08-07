import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("operation explorer adds filters without bypassing legacy run actions", () => {
  const component = fs.readFileSync(new URL("../app/OperationExplorer.tsx", import.meta.url), "utf8");
  const model = fs.readFileSync(new URL("../operation-explorer.ts", import.meta.url), "utf8");
  const bridge = fs.readFileSync(new URL("../operation-explorer-legacy-bridge.ts", import.meta.url), "utf8");
  const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../app/operation-explorer.css", import.meta.url), "utf8");

  assert.equal(component.includes("/api/integrations/runs?limit=100"), true);
  assert.equal(component.includes("sync=${sync ? \"1\" : \"0\"}"), true);
  assert.equal(component.includes("resolveLegacyOperationTarget"), true);
  assert.equal(component.includes("openLegacyRun"), true);
  assert.equal(component.includes("MutationObserver"), true);
  assert.equal(component.includes(".data-table .tr.ops-detailed:not(.th)"), true);
  assert.equal(component.includes(".panel-title button.secondary"), true);
  assert.equal(component.includes("await openLegacyRun"), true);
  assert.equal(component.includes("if (!clickLegacyRun"), false);
  assert.equal(component.includes("/cancel"), false);
  assert.equal(component.includes("/rerun"), false);
  assert.equal(bridge.includes("resolveLegacyOperationTarget"), true);

  for (const value of ["Все активные", "Все завершённые", "Пользователь", "С даты", "По дату", "Сначала долгие", "Обновить XYOps"]) {
    assert.equal(component.includes(value), true, value);
  }
  for (const value of ["buildOperationTimeline", "Длительность", "ожидание до этапа", "от старта"]) {
    assert.equal(component.includes(value), true, value);
  }

  assert.equal(model.includes("statusMatches"), true);
  assert.equal(model.includes("operationDurationMs"), true);
  assert.equal(model.includes("waitingMs"), true);
  assert.equal(layout.includes("import OperationExplorer"), true);
  assert.equal(layout.includes("<OperationExplorer />"), true);
  assert.equal(layout.includes("operation-explorer.css"), true);
  assert.equal(css.includes("operation-explorer-host > .data-table"), true);
  assert.equal(css.includes("operation-timeline-enhanced > .workflow-timeline"), true);
});
