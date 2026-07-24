export type FreeIpaDirectoryUser = {
  uid: string;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  active: boolean;
  groups: number;
  groupNames: string[];
};

export type FreeIpaUserStatus = "all" | "active" | "disabled";
export type FreeIpaUserSort = "uid" | "name" | "email" | "groups" | "status";
export type FreeIpaSortDirection = "asc" | "desc";

export type FreeIpaUserQuery = {
  q: string;
  status: FreeIpaUserStatus;
  group: string;
  sort: FreeIpaUserSort;
  direction: FreeIpaSortDirection;
  page: number;
  pageSize: number;
};

export type FreeIpaUserQueryResult = {
  users: FreeIpaDirectoryUser[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    from: number;
    to: number;
  };
  filters: FreeIpaUserQuery & { availableGroups: string[] };
  summary: {
    total: number;
    active: number;
    disabled: number;
    filtered: number;
  };
};

const allowedPageSizes = [10, 25, 50, 100] as const;
const collator = new Intl.Collator("ru", { sensitivity: "base", numeric: true });

function cleanText(value: string | null, maxLength: number): string {
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

export function normalizeFreeIpaUserQuery(searchParams: URLSearchParams): FreeIpaUserQuery {
  const statusValue = searchParams.get("status");
  const sortValue = searchParams.get("sort");
  const directionValue = searchParams.get("direction");

  return {
    q: cleanText(searchParams.get("q"), 160),
    status: statusValue === "active" || statusValue === "disabled" ? statusValue : "all",
    group: cleanText(searchParams.get("group"), 120),
    sort: sortValue === "name" || sortValue === "email" || sortValue === "groups" || sortValue === "status" ? sortValue : "uid",
    direction: directionValue === "desc" ? "desc" : "asc",
    page: positiveInteger(searchParams.get("page"), 1, 100_000),
    pageSize: allowedPageSize(searchParams.get("pageSize")),
  };
}

function userSearchText(user: FreeIpaDirectoryUser): string {
  return [user.uid, user.name, user.firstName, user.lastName, user.email, ...user.groupNames]
    .join("\u0000")
    .toLocaleLowerCase("ru");
}

function comparePrimary(left: FreeIpaDirectoryUser, right: FreeIpaDirectoryUser, sort: FreeIpaUserSort): number {
  if (sort === "groups") return left.groups - right.groups;
  if (sort === "status") return Number(right.active) - Number(left.active);
  return collator.compare(String(left[sort] ?? ""), String(right[sort] ?? ""));
}

export function queryFreeIpaUsers(users: FreeIpaDirectoryUser[], query: FreeIpaUserQuery): FreeIpaUserQueryResult {
  const normalizedUsers = users
    .filter((user) => user && typeof user.uid === "string" && user.uid)
    .map((user) => ({
      ...user,
      uid: cleanText(user.uid, 160),
      name: cleanText(user.name, 240),
      firstName: cleanText(user.firstName, 160),
      lastName: cleanText(user.lastName, 160),
      email: cleanText(user.email, 320),
      groups: Math.max(0, Number(user.groups) || 0),
      groupNames: Array.from(new Set((Array.isArray(user.groupNames) ? user.groupNames : []).map((group) => cleanText(group, 120)).filter(Boolean))).sort(collator.compare),
      active: user.active === true,
    }));

  const availableGroups = Array.from(new Set(normalizedUsers.flatMap((user) => user.groupNames))).sort(collator.compare);
  const q = query.q.toLocaleLowerCase("ru");
  const group = query.group.toLocaleLowerCase("ru");
  const filtered = normalizedUsers.filter((user) => {
    if (q && !userSearchText(user).includes(q)) return false;
    if (query.status === "active" && !user.active) return false;
    if (query.status === "disabled" && user.active) return false;
    if (group && !user.groupNames.some((value) => value.toLocaleLowerCase("ru") === group)) return false;
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
  const pageUsers = filtered.slice(offset, offset + query.pageSize);

  return {
    users: pageUsers,
    pagination: {
      page,
      pageSize: query.pageSize,
      total: filtered.length,
      totalPages,
      from: pageUsers.length ? offset + 1 : 0,
      to: pageUsers.length ? offset + pageUsers.length : 0,
    },
    filters: { ...query, page, availableGroups },
    summary: {
      total: normalizedUsers.length,
      active: normalizedUsers.filter((user) => user.active).length,
      disabled: normalizedUsers.filter((user) => !user.active).length,
      filtered: filtered.length,
    },
  };
}
