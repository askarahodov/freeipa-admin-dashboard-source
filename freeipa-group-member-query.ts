import type { FreeIpaDirectoryUser } from "./freeipa-user-query";

export type FreeIpaDirectoryGroup = {
  name: string;
  description: string;
  members: number;
  memberUids: string[];
  type: string;
};

export type FreeIpaGroupMember = {
  uid: string;
  name: string;
  email: string;
  active: boolean | null;
};

export type FreeIpaGroupMemberStatus = "all" | "active" | "disabled" | "unknown";
export type FreeIpaGroupMemberSort = "uid" | "name" | "email" | "status";
export type FreeIpaGroupMemberDirection = "asc" | "desc";

export type FreeIpaGroupMemberQuery = {
  q: string;
  status: FreeIpaGroupMemberStatus;
  sort: FreeIpaGroupMemberSort;
  direction: FreeIpaGroupMemberDirection;
  page: number;
  pageSize: number;
};

export type FreeIpaGroupMemberQueryResult = {
  group: FreeIpaDirectoryGroup;
  members: FreeIpaGroupMember[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    from: number;
    to: number;
  };
  filters: FreeIpaGroupMemberQuery;
  summary: {
    total: number;
    active: number;
    disabled: number;
    unknown: number;
    filtered: number;
  };
};

const allowedPageSizes = [10, 25, 50, 100] as const;
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function positiveInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function allowedPageSize(value: string | null): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return allowedPageSizes.includes(parsed as (typeof allowedPageSizes)[number]) ? parsed : 25;
}

export function normalizeFreeIpaGroupMemberQuery(searchParams: URLSearchParams): FreeIpaGroupMemberQuery {
  const statusValue = searchParams.get("status");
  const sortValue = searchParams.get("sort");
  const directionValue = searchParams.get("direction");
  return {
    q: cleanText(searchParams.get("q"), 160),
    status: statusValue === "active" || statusValue === "disabled" || statusValue === "unknown" ? statusValue : "all",
    sort: sortValue === "name" || sortValue === "email" || sortValue === "status" ? sortValue : "uid",
    direction: directionValue === "desc" ? "desc" : "asc",
    page: positiveInteger(searchParams.get("page"), 1, 100_000),
    pageSize: allowedPageSize(searchParams.get("pageSize")),
  };
}

function normalizeGroup(group: FreeIpaDirectoryGroup): FreeIpaDirectoryGroup {
  const memberUids = Array.from(new Set((Array.isArray(group.memberUids) ? group.memberUids : [])
    .map((uid) => cleanText(uid, 160))
    .filter(Boolean)));
  return {
    name: cleanText(group.name, 160),
    description: cleanText(group.description, 1024),
    members: Math.max(memberUids.length, Number(group.members) || 0),
    memberUids,
    type: cleanText(group.type, 120),
  };
}

function normalizeMember(uid: string, user: FreeIpaDirectoryUser | undefined): FreeIpaGroupMember {
  return {
    uid: cleanText(uid, 160),
    name: cleanText(user?.name || uid, 240),
    email: cleanText(user?.email, 320),
    active: user ? user.active === true : null,
  };
}

function searchText(member: FreeIpaGroupMember): string {
  return [member.uid, member.name, member.email].join("\u0000").toLocaleLowerCase("ru");
}

function statusRank(value: boolean | null): number {
  return value === true ? 0 : value === false ? 1 : 2;
}

function comparePrimary(left: FreeIpaGroupMember, right: FreeIpaGroupMember, sort: FreeIpaGroupMemberSort): number {
  if (sort === "status") return statusRank(left.active) - statusRank(right.active);
  return collator.compare(String(left[sort] ?? ""), String(right[sort] ?? ""));
}

export function queryFreeIpaGroupMembers(groupInput: FreeIpaDirectoryGroup, users: FreeIpaDirectoryUser[], query: FreeIpaGroupMemberQuery): FreeIpaGroupMemberQueryResult {
  const group = normalizeGroup(groupInput);
  const usersByUid = new Map(users
    .filter((user) => user && typeof user.uid === "string" && user.uid)
    .map((user) => [cleanText(user.uid, 160), user]));
  const normalizedMembers = group.memberUids.map((uid) => normalizeMember(uid, usersByUid.get(uid)));
  const q = query.q.toLocaleLowerCase("ru");
  const filtered = normalizedMembers.filter((member) => {
    if (q && !searchText(member).includes(q)) return false;
    if (query.status === "active" && member.active !== true) return false;
    if (query.status === "disabled" && member.active !== false) return false;
    if (query.status === "unknown" && member.active !== null) return false;
    return true;
  });

  filtered.sort((left, right) => {
    const primary = comparePrimary(left, right, query.sort);
    if (primary !== 0) return query.direction === "desc" ? -primary : primary;
    return collator.compare(left.uid, right.uid);
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / query.pageSize));
  const page = Math.min(query.page, totalPages);
  const offset = (page - 1) * query.pageSize;
  const members = filtered.slice(offset, offset + query.pageSize);

  return {
    group,
    members,
    pagination: {
      page,
      pageSize: query.pageSize,
      total: filtered.length,
      totalPages,
      from: members.length ? offset + 1 : 0,
      to: members.length ? offset + members.length : 0,
    },
    filters: { ...query, page },
    summary: {
      total: normalizedMembers.length,
      active: normalizedMembers.filter((member) => member.active === true).length,
      disabled: normalizedMembers.filter((member) => member.active === false).length,
      unknown: normalizedMembers.filter((member) => member.active === null).length,
      filtered: filtered.length,
    },
  };
}
