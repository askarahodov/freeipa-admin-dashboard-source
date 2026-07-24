import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const component = fs.readFileSync(new URL("../app/PortalInteractionLayer.tsx", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("../app/portal-interaction-layer.css", import.meta.url), "utf8");
const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");

test("HTTP response states are classified consistently", () => {
  for (const status of [403, 408, 409, 429, 504]) assert.ok(component.includes(`status === ${status}`), String(status));
  for (const kind of ["forbidden", "timeout", "conflict", "rate-limit", "unavailable"]) assert.ok(component.includes(`\"${kind}\"`), kind);
  assert.ok(component.includes('response.headers.get("retry-after")'));
  assert.ok(component.includes("payload.retryAfter"));
});

test("feedback never exposes request query strings or outgoing request bodies", () => {
  assert.ok(component.includes("return url.pathname"));
  assert.ok(!component.includes("url.search"));
  assert.ok(!component.includes("init?.body"));
  assert.ok(!component.includes("request.clone().text"));
  assert.ok(component.includes("slice(0, 500)"));
});

test("all API calls receive shared loading and error observation", () => {
  assert.ok(component.includes('path.startsWith("/api/")'));
  assert.ok(component.includes("portal:request-start"));
  assert.ok(component.includes("portal:request-end"));
  assert.ok(component.includes("portal:request-error"));
  assert.ok(component.includes("portal-request-progress"));
});

test("dangerous actions use an accessible confirmation dialog", () => {
  for (const action of ["остановить задание", "запустить снова", "одобрить", "отклонить", "отменить заявку", "выполнить в xyops", "отключить пользователя", "удалить"]) {
    assert.ok(component.includes(action), action);
  }
  assert.ok(component.includes('role="alertdialog"'));
  assert.ok(component.includes('aria-modal="true"'));
  assert.ok(component.includes("requireReason: true"));
  assert.ok(component.includes("requireDeletePhrase: true"));
  assert.ok(component.includes('!== "УДАЛИТЬ"'));
});

test("confirmed clicks preserve existing server-side handlers", () => {
  assert.ok(component.includes("button.dataset.portalConfirmed"));
  assert.ok(component.includes("button.click()"));
  assert.ok(component.includes("window.confirm = () => true"));
  assert.ok(component.includes("window.prompt = () => reason"));
  assert.ok(!component.includes('fetch("/api/integrations/freeipa/actions"'));
  assert.ok(!component.includes('fetch("/api/integrations/catalog/run"'));
});

test("global styles and interaction layer are mounted in the root layout", () => {
  assert.ok(layout.includes('import "./portal-interaction-layer.css"'));
  assert.ok(layout.includes('import PortalInteractionLayer from "./PortalInteractionLayer"'));
  assert.ok(layout.includes("<PortalInteractionLayer />"));
  for (const selector of [".portal-feedback-card", ".portal-confirm-dialog", ".portal-request-progress", ".catalog-empty", ".settings-error"]) {
    assert.ok(styles.includes(selector), selector);
  }
});
