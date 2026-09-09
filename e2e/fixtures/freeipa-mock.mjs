import { createServer } from "node:http";

const host = process.env.FREEIPA_MOCK_HOST || "0.0.0.0";
const port = Number(process.env.FREEIPA_MOCK_PORT || 3901);
const expectedUser = process.env.FREEIPA_MOCK_USERNAME || "e2e-freeipa-manager";
const expectedPassword = process.env.FREEIPA_MOCK_PASSWORD || "e2e-freeipa-password";
const sessionCookie = "ipa_session=e2e-session";

const users = new Map([
  ["seeduser", { uid: "seeduser", givenname: "Seed", sn: "User", mail: "seeduser@example.test", locked: false, groups: new Set(["seedgroup"]) }],
]);
const groups = new Map([
  ["seedgroup", { name: "seedgroup", description: "Seed E2E group", members: new Set(["seeduser"]), posix: true }],
]);

function send(response, status, body, headers = {}) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function values(value) {
  return Array.isArray(value) ? value.map(String) : value == null ? [] : [String(value)];
}

function userEntry(user) {
  return {
    uid: [user.uid],
    cn: [`${user.givenname} ${user.sn}`.trim()],
    displayname: [`${user.givenname} ${user.sn}`.trim()],
    givenname: [user.givenname],
    sn: [user.sn],
    mail: user.mail ? [user.mail] : [],
    nsaccountlock: user.locked,
    memberof_group: Array.from(user.groups).sort(),
  };
}

function groupEntry(group) {
  return {
    cn: [group.name],
    description: [group.description || "Без описания"],
    member_user: Array.from(group.members).sort(),
    ...(group.posix ? { gidnumber: ["10000"] } : {}),
  };
}

function rpcError(message, code = 4001) {
  return { error: { code, message }, result: null, id: 0 };
}

function rpcSuccess(result = []) {
  return { error: null, result: { result, count: result.length, truncated: false }, id: 0 };
}

function applyRpc(method, args, options) {
  const id = String(args?.[0] ?? "").trim();
  if (method === "user_find") return rpcSuccess(Array.from(users.values(), userEntry));
  if (method === "group_find") return rpcSuccess(Array.from(groups.values(), groupEntry));

  if (method === "user_add") {
    if (!id || users.has(id)) return rpcError(`user ${id || "<empty>"} already exists`);
    const givenname = String(options.givenname ?? "").trim();
    const sn = String(options.sn ?? "").trim();
    if (!givenname || !sn) return rpcError("givenname and sn are required");
    const user = { uid: id, givenname, sn, mail: String(options.mail ?? ""), locked: false, groups: new Set() };
    users.set(id, user);
    return rpcSuccess([userEntry(user)]);
  }

  if (method === "user_mod") {
    const user = users.get(id);
    if (!user) return rpcError(`user ${id} not found`, 4002);
    if (options.givenname !== undefined) user.givenname = String(options.givenname);
    if (options.sn !== undefined) user.sn = String(options.sn);
    if (options.mail !== undefined) user.mail = String(options.mail);
    return rpcSuccess([userEntry(user)]);
  }

  if (method === "user_enable" || method === "user_disable") {
    const user = users.get(id);
    if (!user) return rpcError(`user ${id} not found`, 4002);
    user.locked = method === "user_disable";
    return rpcSuccess([userEntry(user)]);
  }

  if (method === "user_del") {
    const user = users.get(id);
    if (!user) return rpcError(`user ${id} not found`, 4002);
    for (const groupName of user.groups) groups.get(groupName)?.members.delete(id);
    users.delete(id);
    return rpcSuccess([]);
  }

  if (method === "group_add") {
    if (!id || groups.has(id)) return rpcError(`group ${id || "<empty>"} already exists`);
    const group = { name: id, description: String(options.description ?? ""), members: new Set(), posix: true };
    groups.set(id, group);
    return rpcSuccess([groupEntry(group)]);
  }

  if (method === "group_del") {
    const group = groups.get(id);
    if (!group) return rpcError(`group ${id} not found`, 4002);
    for (const uid of group.members) users.get(uid)?.groups.delete(id);
    groups.delete(id);
    return rpcSuccess([]);
  }

  if (method === "group_add_member" || method === "group_remove_member") {
    const group = groups.get(id);
    if (!group) return rpcError(`group ${id} not found`, 4002);
    for (const uid of values(options.user)) {
      const user = users.get(uid);
      if (!user) return rpcError(`user ${uid} not found`, 4002);
      if (method === "group_add_member") {
        group.members.add(uid);
        user.groups.add(id);
      } else {
        group.members.delete(uid);
        user.groups.delete(id);
      }
    }
    return rpcSuccess([groupEntry(group)]);
  }

  return rpcError(`unsupported method ${method}`, 4003);
}

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (request.method === "GET" && ["/", "/health", "/ipa/ui/"].includes(url.pathname)) {
      return send(response, 200, { ok: true, users: users.size, groups: groups.size });
    }

    if (request.method === "POST" && url.pathname === "/ipa/session/login_password") {
      const form = new URLSearchParams(await readBody(request));
      if (form.get("user") !== expectedUser || form.get("password") !== expectedPassword) {
        return send(response, 401, { error: "invalid credentials" });
      }
      return send(response, 200, "", { "set-cookie": `${sessionCookie}; Path=/ipa; HttpOnly; SameSite=Lax` });
    }

    if (request.method === "POST" && url.pathname === "/ipa/session/json") {
      if (!String(request.headers.cookie || "").includes(sessionCookie)) return send(response, 401, rpcError("invalid session"));
      let payload;
      try { payload = JSON.parse(await readBody(request)); }
      catch { return send(response, 400, rpcError("invalid JSON")); }
      const method = String(payload.method || "");
      const params = Array.isArray(payload.params) ? payload.params : [];
      const args = Array.isArray(params[0]) ? params[0] : [""];
      const options = params[1] && typeof params[1] === "object" && !Array.isArray(params[1]) ? params[1] : {};
      return send(response, 200, applyRpc(method, args, options));
    }

    return send(response, 404, { error: "not found" });
  })().catch((error) => send(response, 500, { error: error instanceof Error ? error.message : "mock failure" }));
});

server.listen(port, host, () => {
  console.log(`FreeIPA E2E mock listening on http://${host}:${port}`);
});
