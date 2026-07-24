import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

test("group member browser reuses legacy mutations and paginated API", () => {
  const component = fs.readFileSync(new URL("../app/FreeIpaGroupMemberBrowser.tsx", import.meta.url), "utf8");
  const wrapper = fs.readFileSync(new URL("../worker/freeipa-group-member-entry.ts", import.meta.url), "utf8");
  const layout = fs.readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
  const vite = fs.readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

  for (const value of ["/api/integrations/groups/members", "status", "sort", "direction", "pageSize", "Без карточки", "legacyRemove"]) {
    assert.equal(component.includes(value), true, value);
  }
  assert.equal(component.includes("/api/integrations/freeipa/actions"), false);
  assert.equal(component.includes("button.danger-link"), true);
  assert.equal(wrapper.includes("/api/integrations/groups"), true);
  assert.equal(wrapper.includes("/api/integrations/users"), true);
  assert.equal(wrapper.includes("queryFreeIpaGroupMembers"), true);
  assert.equal(layout.includes("<FreeIpaGroupMemberBrowser />"), true);
  assert.equal(vite.includes("worker/freeipa-group-member-entry.ts"), true);
});
