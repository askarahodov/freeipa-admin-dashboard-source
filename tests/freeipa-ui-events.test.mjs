import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  FREEIPA_DIRECTORY_CHANGED_EVENT,
  FREEIPA_OPEN_ACTION_EVENT,
  announceFreeIpaDirectoryChanged,
  loadFreeIpaAccess,
  openFreeIpaAction,
} from "../freeipa-ui-events.ts";

function installWindowTarget() {
  const previousWindow = globalThis.window;
  const previousCustomEvent = globalThis.CustomEvent;
  const target = new EventTarget();

  globalThis.window = target;
  if (typeof globalThis.CustomEvent !== "function") {
    globalThis.CustomEvent = class CustomEvent extends Event {
      constructor(type, init = {}) {
        super(type);
        this.detail = init.detail;
      }
    };
  }

  return () => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousCustomEvent === undefined) delete globalThis.CustomEvent;
    else globalThis.CustomEvent = previousCustomEvent;
  };
}

test("enhanced FreeIPA UI opens the shared React action modal through a typed event", () => {
  const restore = installWindowTarget();
  try {
    const action = {
      operation: "user_mod",
      title: "Редактировать e2e-user",
      preset: { username: "e2e-user", email: "e2e@example.test" },
    };
    let received = null;
    window.addEventListener(FREEIPA_OPEN_ACTION_EVENT, (event) => {
      received = event.detail;
    });

    openFreeIpaAction(action);
    assert.deepEqual(received, action);
  } finally {
    restore();
  }
});

test("successful FreeIPA operations announce a directory refresh", () => {
  const restore = installWindowTarget();
  try {
    let refreshes = 0;
    window.addEventListener(FREEIPA_DIRECTORY_CHANGED_EVENT, () => {
      refreshes += 1;
    });

    announceFreeIpaDirectoryChanged();
    assert.equal(refreshes, 1);
  } finally {
    restore();
  }
});

test("FreeIPA UI permissions come from the server-side access contract", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "/api/integrations/status");
    assert.deepEqual(options, { cache: "no-store" });
    return {
      ok: true,
      async json() {
        return { access: { permissions: ["directory.read", "freeipa.write", "freeipa.delete"] } };
      },
    };
  };

  try {
    assert.deepEqual(await loadFreeIpaAccess(), { canWrite: true, canDelete: true });
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("layout and enhanced browsers no longer depend on legacy FreeIPA action bridges", async () => {
  const [layout, users, members] = await Promise.all([
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/FreeIpaUserBrowser.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/FreeIpaGroupMemberBrowser.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(layout, /FreeIpaDirectorySync|FreeIpaLegacyActionBridge/);
  assert.doesNotMatch(users, /clickLegacy|legacyCreateButton|lastFreeIpaToast/);
  assert.doesNotMatch(users, /if \(!active\) \{\s*setCanWrite/);
  assert.doesNotMatch(members, /legacyRemove|lastFreeIpaToast/);
  assert.match(users, /openFreeIpaAction/);
  assert.match(members, /openFreeIpaAction/);
});
