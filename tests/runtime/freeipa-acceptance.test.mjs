import assert from "node:assert/strict";
import test from "node:test";

import {
  createFreeIpaAcceptanceNames,
  executeFreeIpaMutationAcceptance,
  executeFreeIpaReadAcceptance,
} from "../../scripts/freeipa-acceptance-core.mjs";

function fakeFreeIpa({
  configured = true,
  reachable = true,
  loseUserCreateResponse = false,
  failCleanup = false,
} = {}) {
  const users = new Map([
    ["seeduser", { uid: "seeduser", email: "seed@example.test", active: true }],
  ]);
  const groups = new Map([
    ["seedgroup", { name: "seedgroup", members: new Set(["seeduser"]) }],
  ]);
  const calls = [];

  const userPayload = () => Array.from(users.values()).map((user) => ({
    uid: user.uid,
    email: user.email,
    active: user.active,
  }));
  const groupPayload = () => Array.from(groups.values()).map((group) => ({
    name: group.name,
    members: group.members.size,
    memberUids: Array.from(group.members),
  }));

  const request = async (pathname, options = {}) => {
    calls.push({ pathname, method: options.method ?? "GET", body: options.body });

    if (pathname === "/api/integrations/status") {
      return {
        status: 200,
        json: {
          mode: configured ? "live" : "unconfigured",
          freeipa: { configured, reachable },
        },
      };
    }

    if (pathname.startsWith("/api/integrations/users")) {
      const url = new URL(pathname, "http://acceptance.local");
      const query = String(url.searchParams.get("q") ?? "");
      const result = userPayload().filter((user) => !query || user.uid.includes(query));
      return { status: 200, json: { mode: "live", users: result } };
    }

    if (pathname === "/api/integrations/groups") {
      return { status: 200, json: { mode: "live", source: "group_find", groups: groupPayload() } };
    }

    if (pathname.startsWith("/api/integrations/groups/members")) {
      const url = new URL(pathname, "http://acceptance.local");
      const name = String(url.searchParams.get("group") ?? "");
      const group = groups.get(name);
      if (!group) return { status: 404, json: {} };
      return {
        status: 200,
        json: {
          mode: "live",
          members: Array.from(group.members).map((uid) => ({
            uid,
            email: users.get(uid)?.email ?? "",
          })),
        },
      };
    }

    if (pathname === "/api/integrations/freeipa/actions" && options.method === "POST") {
      const body = options.body ?? {};
      const username = String(body.username ?? "");
      const group = String(body.group ?? "");
      switch (body.operation) {
        case "group_add":
          groups.set(group, { name: group, members: new Set() });
          break;
        case "user_add":
          users.set(username, {
            uid: username,
            email: String(body.email ?? ""),
            active: true,
          });
          if (loseUserCreateResponse) {
            loseUserCreateResponse = false;
            throw new Error("connection lost after FreeIPA commit");
          }
          break;
        case "user_mod": {
          const user = users.get(username);
          if (!user) return { status: 502, json: {} };
          user.email = String(body.email ?? user.email);
          break;
        }
        case "group_add_member":
          groups.get(group)?.members.add(username);
          break;
        case "group_remove_member":
          groups.get(group)?.members.delete(username);
          break;
        case "user_del":
          if (failCleanup) return { status: 502, json: {} };
          users.delete(username);
          for (const item of groups.values()) item.members.delete(username);
          break;
        case "group_del":
          if (failCleanup) return { status: 502, json: {} };
          groups.delete(group);
          break;
        default:
          return { status: 400, json: {} };
      }
      return { status: 200, json: { ok: true, direct: true } };
    }

    return { status: 404, json: {} };
  };

  return {
    request,
    calls,
    users,
    groups,
  };
}

test("FreeIPA acceptance names are unique, bounded, and tied to the isolated project", () => {
  assert.deepEqual(createFreeIpaAcceptanceNames({
    projectName: "portal-accept-0123456789ab",
    suffix: "A1B2C3D4",
  }), {
    username: "portalaccept012345a1b2c3d4u",
    group: "portalaccept012345a1b2c3d4g",
  });
  assert.throws(
    () => createFreeIpaAcceptanceNames({ projectName: "production", suffix: "abcd" }),
    /acceptance_freeipa_project_invalid/u,
  );
});

test("FreeIPA read acceptance requires live configured reachable users and groups", async () => {
  const fake = fakeFreeIpa();
  assert.deepEqual(await executeFreeIpaReadAcceptance({ request: fake.request }), {
    outcome: "passed",
    users: 1,
    groups: 1,
  });

  const unconfigured = fakeFreeIpa({ configured: false });
  await assert.rejects(
    () => executeFreeIpaReadAcceptance({ request: unconfigured.request }),
    /acceptance_freeipa_not_configured/u,
  );

  const unreachable = fakeFreeIpa({ reachable: false });
  await assert.rejects(
    () => executeFreeIpaReadAcceptance({ request: unreachable.request }),
    /acceptance_freeipa_unreachable/u,
  );
});

test("FreeIPA mutation acceptance verifies update and membership then deletes all acceptance objects", async () => {
  const fake = fakeFreeIpa();
  const result = await executeFreeIpaMutationAcceptance({
    request: fake.request,
    projectName: "portal-accept-0123456789ab",
    suffix: "a1b2c3d4",
    temporaryPassword: "Temporary-Password-2026",
  });

  assert.deepEqual(result, {
    outcome: "passed",
    crud: "verified",
    membership: "verified",
    cleanup: "verified",
  });
  assert.deepEqual(Array.from(fake.users.keys()), ["seeduser"]);
  assert.deepEqual(Array.from(fake.groups.keys()), ["seedgroup"]);

  const actions = fake.calls
    .filter((call) => call.pathname === "/api/integrations/freeipa/actions")
    .map((call) => call.body.operation);
  assert.deepEqual(actions, [
    "group_add",
    "user_add",
    "user_mod",
    "group_add_member",
    "group_remove_member",
    "user_del",
    "group_del",
  ]);
});

test("ambiguous FreeIPA create response is reconciled and cleaned before the primary error surfaces", async () => {
  const fake = fakeFreeIpa({ loseUserCreateResponse: true });

  await assert.rejects(
    () => executeFreeIpaMutationAcceptance({
      request: fake.request,
      projectName: "portal-accept-0123456789ab",
      suffix: "deadbeef",
      temporaryPassword: "Temporary-Password-2026",
    }),
    /connection lost after FreeIPA commit/u,
  );

  assert.deepEqual(Array.from(fake.users.keys()), ["seeduser"]);
  assert.deepEqual(Array.from(fake.groups.keys()), ["seedgroup"]);
});

test("FreeIPA cleanup failure overrides the primary result and remains release-blocking", async () => {
  const fake = fakeFreeIpa({ failCleanup: true });

  await assert.rejects(
    () => executeFreeIpaMutationAcceptance({
      request: fake.request,
      projectName: "portal-accept-0123456789ab",
      suffix: "cafebabe",
      temporaryPassword: "Temporary-Password-2026",
    }),
    /acceptance_freeipa_cleanup_failed/u,
  );
});

test("FreeIPA object collision fails before any mutation and never deletes pre-existing objects", async () => {
  const fake = fakeFreeIpa();
  const names = createFreeIpaAcceptanceNames({
    projectName: "portal-accept-0123456789ab",
    suffix: "11223344",
  });
  fake.users.set(names.username, { uid: names.username, email: "existing@example.test", active: true });

  await assert.rejects(
    () => executeFreeIpaMutationAcceptance({
      request: fake.request,
      projectName: "portal-accept-0123456789ab",
      suffix: "11223344",
      temporaryPassword: "Temporary-Password-2026",
    }),
    /acceptance_freeipa_name_collision/u,
  );

  assert.equal(fake.users.has(names.username), true);
  assert.equal(
    fake.calls.some((call) => call.pathname === "/api/integrations/freeipa/actions"),
    false,
  );
});
