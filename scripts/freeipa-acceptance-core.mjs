function boundedResponse(response, expectedStatus, code) {
  if (!response || Number(response.status) !== expectedStatus) throw new Error(code);
  return response.json && typeof response.json === "object" && !Array.isArray(response.json)
    ? response.json
    : {};
}

function liveUsers(payload) {
  if (payload.mode !== "live" || !Array.isArray(payload.users)) {
    throw new Error("acceptance_freeipa_users_read_failed");
  }
  return payload.users;
}

function liveGroups(payload) {
  if (payload.mode !== "live" || !Array.isArray(payload.groups)) {
    throw new Error("acceptance_freeipa_groups_read_failed");
  }
  return payload.groups;
}

function normalizeSuffix(value) {
  const suffix = String(value ?? "").toLowerCase().replace(/[^a-z0-9]/gu, "").slice(0, 12);
  if (suffix.length < 4) throw new Error("acceptance_freeipa_suffix_invalid");
  return suffix;
}

export function createFreeIpaAcceptanceNames({ projectName, suffix } = {}) {
  const match = String(projectName ?? "").match(/^portal-accept-([0-9a-f]{12})$/u);
  if (!match) throw new Error("acceptance_freeipa_project_invalid");
  const unique = normalizeSuffix(suffix);
  const prefix = `portalaccept${match[1].slice(0, 6)}${unique}`.slice(0, 27);
  return Object.freeze({
    username: `${prefix}u`.slice(0, 30),
    group: `${prefix}g`.slice(0, 48),
  });
}

async function readStatus(request) {
  const response = await request("/api/integrations/status", { method: "GET" });
  const payload = boundedResponse(response, 200, "acceptance_freeipa_status_failed");
  if (payload.mode !== "live" || payload.freeipa?.configured !== true) {
    throw new Error("acceptance_freeipa_not_configured");
  }
  if (payload.freeipa?.reachable !== true) {
    throw new Error("acceptance_freeipa_unreachable");
  }
  return payload;
}

async function readUsers(request, query = "") {
  const response = await request(`/api/integrations/users${query}`, { method: "GET" });
  return liveUsers(boundedResponse(response, 200, "acceptance_freeipa_users_read_failed"));
}

async function readGroups(request, query = "") {
  const response = await request(`/api/integrations/groups${query}`, { method: "GET" });
  return liveGroups(boundedResponse(response, 200, "acceptance_freeipa_groups_read_failed"));
}

async function action(request, body, code) {
  const response = await request("/api/integrations/freeipa/actions", {
    method: "POST",
    body,
  });
  const payload = boundedResponse(response, 200, code);
  if (payload.ok !== true || payload.direct !== true) throw new Error(code);
}

async function userState(request, username) {
  const users = await readUsers(
    request,
    `?q=${encodeURIComponent(username)}&page=1&pageSize=10`,
  );
  return users.find((item) => item?.uid === username) ?? null;
}

async function groupState(request, group) {
  const groups = await readGroups(request);
  return groups.find((item) => item?.name === group) ?? null;
}

async function groupMembers(request, group) {
  const response = await request(
    `/api/integrations/groups/members?group=${encodeURIComponent(group)}&page=1&pageSize=100`,
    { method: "GET" },
  );
  const payload = boundedResponse(response, 200, "acceptance_freeipa_members_read_failed");
  if (payload.mode !== "live" || !Array.isArray(payload.members)) {
    throw new Error("acceptance_freeipa_members_read_failed");
  }
  return payload.members;
}

async function reconcileDelete({ request, kind, name }) {
  const exists = async () => kind === "user"
    ? Boolean(await userState(request, name))
    : Boolean(await groupState(request, name));
  let present;
  try {
    present = await exists();
  } catch {
    present = true;
  }
  if (!present) return;

  try {
    await action(
      request,
      kind === "user"
        ? { operation: "user_del", username: name }
        : { operation: "group_del", group: name },
      "acceptance_freeipa_cleanup_action_failed",
    );
  } catch {
    try {
      if (!await exists()) return;
    } catch {
      // Ambiguous deletion remains release-blocking below.
    }
    throw new Error("acceptance_freeipa_cleanup_failed");
  }

  try {
    if (await exists()) throw new Error("acceptance_freeipa_cleanup_failed");
  } catch (error) {
    if (error instanceof Error && error.message === "acceptance_freeipa_cleanup_failed") throw error;
    throw new Error("acceptance_freeipa_cleanup_failed");
  }
}

export async function executeFreeIpaReadAcceptance({ request } = {}) {
  if (typeof request !== "function") throw new Error("acceptance_freeipa_request_invalid");
  await readStatus(request);
  const users = await readUsers(request);
  const groups = await readGroups(request);
  return Object.freeze({
    outcome: "passed",
    users: Number(users.length),
    groups: Number(groups.length),
  });
}

export async function executeFreeIpaMutationAcceptance({
  request,
  projectName,
  suffix,
  temporaryPassword,
} = {}) {
  if (typeof request !== "function") throw new Error("acceptance_freeipa_request_invalid");
  if (typeof temporaryPassword !== "string" || temporaryPassword.length < 12) {
    throw new Error("acceptance_freeipa_temporary_password_invalid");
  }

  await executeFreeIpaReadAcceptance({ request });
  const names = createFreeIpaAcceptanceNames({ projectName, suffix });
  const initialUser = await userState(request, names.username);
  const initialGroup = await groupState(request, names.group);
  if (initialUser || initialGroup) throw new Error("acceptance_freeipa_name_collision");

  const initialEmail = `${names.username}@example.test`;
  const updatedEmail = `${names.username}.updated@example.test`;
  let groupCreateAttempted = false;
  let userCreateAttempted = false;
  let primaryError = null;
  let cleanupError = null;

  try {
    groupCreateAttempted = true;
    await action(request, {
      operation: "group_add",
      group: names.group,
      description: "Portal production acceptance test",
    }, "acceptance_freeipa_group_create_failed");

    userCreateAttempted = true;
    await action(request, {
      operation: "user_add",
      username: names.username,
      firstName: "Portal",
      lastName: "Acceptance",
      email: initialEmail,
      password: temporaryPassword,
    }, "acceptance_freeipa_user_create_failed");

    await action(request, {
      operation: "user_mod",
      username: names.username,
      firstName: "Portal",
      lastName: "Acceptance",
      email: updatedEmail,
    }, "acceptance_freeipa_user_update_failed");

    const updated = await userState(request, names.username);
    if (!updated || updated.email !== updatedEmail) {
      throw new Error("acceptance_freeipa_user_update_verify_failed");
    }

    await action(request, {
      operation: "group_add_member",
      group: names.group,
      username: names.username,
    }, "acceptance_freeipa_membership_add_failed");

    const withMembership = await groupMembers(request, names.group);
    if (!withMembership.some((member) => member?.uid === names.username)) {
      throw new Error("acceptance_freeipa_membership_add_verify_failed");
    }

    await action(request, {
      operation: "group_remove_member",
      group: names.group,
      username: names.username,
    }, "acceptance_freeipa_membership_remove_failed");

    const withoutMembership = await groupMembers(request, names.group);
    if (withoutMembership.some((member) => member?.uid === names.username)) {
      throw new Error("acceptance_freeipa_membership_remove_verify_failed");
    }
  } catch (error) {
    primaryError = error;
  } finally {
    if (userCreateAttempted) {
      try {
        await reconcileDelete({ request, kind: "user", name: names.username });
      } catch {
        cleanupError = new Error("acceptance_freeipa_cleanup_failed");
      }
    }
    if (groupCreateAttempted) {
      try {
        await reconcileDelete({ request, kind: "group", name: names.group });
      } catch {
        cleanupError = new Error("acceptance_freeipa_cleanup_failed");
      }
    }
  }

  if (cleanupError) throw cleanupError;
  if (primaryError) throw primaryError;

  return Object.freeze({
    outcome: "passed",
    crud: "verified",
    membership: "verified",
    cleanup: "verified",
  });
}
