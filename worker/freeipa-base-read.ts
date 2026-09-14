import { freeIpaRpc, type FreeIpaRpcEnv } from "./freeipa-rpc.ts";

export type FreeIpaBaseReadEnv = FreeIpaRpcEnv & {
  DEMO_MODE?: string;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function firstValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function boolValue(value: unknown): boolean {
  const raw = firstValue(value);
  if (typeof raw === "boolean") return raw;
  return ["true", "1", "yes", "on"].includes(String(raw ?? "").toLowerCase());
}

async function usersResponse(env: FreeIpaBaseReadEnv, ipaUrl: string | null): Promise<Response> {
  if (boolValue(env.DEMO_MODE)) return json({ mode: "demo", users: [] });
  if (!ipaUrl || !env.IPA_USERNAME || !env.IPA_PASSWORD) return json({ mode: "unconfigured", users: [] });
  try {
    const list = await freeIpaRpc(env, ipaUrl, "user_find", [""], { all: true, sizelimit: 0 });
    const users = list.map((entry) => ({
      uid: String(firstValue(entry.uid) ?? ""),
      name: String(firstValue(entry.cn) ?? firstValue(entry.displayname) ?? firstValue(entry.uid) ?? ""),
      firstName: String(firstValue(entry.givenname) ?? ""),
      lastName: String(firstValue(entry.sn) ?? ""),
      email: String(firstValue(entry.mail) ?? ""),
      active: !boolValue(entry.nsaccountlock),
      groups: Array.isArray(entry.memberof_group) ? entry.memberof_group.length : 0,
      groupNames: (Array.isArray(entry.memberof_group) ? entry.memberof_group : entry.memberof_group ? [entry.memberof_group] : []).map(String).filter(Boolean),
    })).filter((user) => user.uid);
    return json({ mode: "live", users });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "FreeIPA request failed" }, 502);
  }
}

async function groupsResponse(env: FreeIpaBaseReadEnv, ipaUrl: string | null): Promise<Response> {
  if (boolValue(env.DEMO_MODE)) return json({ mode: "demo", groups: [] });
  if (!ipaUrl || !env.IPA_USERNAME || !env.IPA_PASSWORD) return json({ mode: "unconfigured", groups: [] });
  let groupFindError: unknown = null;
  try {
    const list = await freeIpaRpc(env, ipaUrl, "group_find", [""], { all: true, sizelimit: 0 });
    const groups = list.map((entry) => ({
      name: String(firstValue(entry.cn) ?? ""),
      description: String(firstValue(entry.description) ?? "Без описания"),
      members: Array.isArray(entry.member_user) ? entry.member_user.length : 0,
      memberUids: (Array.isArray(entry.member_user) ? entry.member_user : entry.member_user ? [entry.member_user] : []).map(String).filter(Boolean),
      type: firstValue(entry.gidnumber) ? "POSIX" : "Non-POSIX",
    })).filter((group) => group.name);
    if (groups.length) return json({ mode: "live", source: "group_find", groups });
  } catch (error) {
    groupFindError = error;
  }
  try {
    const users = await freeIpaRpc(env, ipaUrl, "user_find", [""], { all: true, sizelimit: 0 });
    const membersByGroup = new Map<string, Set<string>>();
    for (const entry of users) {
      const uid = String(firstValue(entry.uid) ?? "");
      const memberships = Array.isArray(entry.memberof_group) ? entry.memberof_group : entry.memberof_group ? [entry.memberof_group] : [];
      for (const value of new Set(memberships.map(String).filter(Boolean))) {
        const members = membersByGroup.get(value) ?? new Set<string>();
        if (uid) members.add(uid);
        membersByGroup.set(value, members);
      }
    }
    const groups = Array.from(membersByGroup, ([name, memberUids]) => ({ name, description: "Получено из членства пользователей", members: memberUids.size, memberUids: Array.from(memberUids).sort(), type: "Directory" }))
      .sort((left, right) => left.name.localeCompare(right.name));
    return json({ mode: "live", source: "user_membership", degraded: true, groups });
  } catch {
    return json({ error: groupFindError instanceof Error ? groupFindError.message : "FreeIPA group_find and membership fallback failed" }, 502);
  }
}

export async function handleFreeIpaBaseRead(request: Request, env: FreeIpaBaseReadEnv, ipaUrl: string | null): Promise<Response | null> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/api/integrations/users") return usersResponse(env, ipaUrl);
  if (request.method === "GET" && url.pathname === "/api/integrations/groups") return groupsResponse(env, ipaUrl);
  return null;
}
