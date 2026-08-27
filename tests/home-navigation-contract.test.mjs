import assert from "node:assert/strict";
import test from "node:test";

import {
  HOME_PAGE_PATHS,
  buildHomePath,
  resolveHomeLocation,
} from "../app/shell/home-navigation.ts";

const sections = [
  { category: "Infrastructure", slug: "infrastructure" },
  { category: "Базы данных", slug: "bazy-dannyh" },
];

test("home navigation preserves canonical page paths", () => {
  assert.deepEqual(HOME_PAGE_PATHS, {
    overview: "/",
    automation: "/automation",
    users: "/users",
    groups: "/groups",
    operations: "/operations",
    approvals: "/approvals",
    audit: "/audit",
    settings: "/settings",
    showcase: "/showcase",
  });
});

test("location resolution is deterministic and normalizes trailing slashes", () => {
  assert.deepEqual(resolveHomeLocation("/", sections), { page: "overview", automationCategory: "all" });
  assert.deepEqual(resolveHomeLocation("/users/", sections), { page: "users", automationCategory: "all" });
  assert.deepEqual(resolveHomeLocation("/groups", sections), { page: "groups", automationCategory: "all" });
  assert.deepEqual(resolveHomeLocation("/showcase/", sections), { page: "showcase", automationCategory: "all" });
  assert.deepEqual(resolveHomeLocation("/unknown", sections), { page: "overview", automationCategory: "all" });
});

test("automation locations resolve known generated sections without leaking them into global navigation", () => {
  assert.deepEqual(resolveHomeLocation("/automation", sections), { page: "automation", automationCategory: "all" });
  assert.deepEqual(resolveHomeLocation("/automation/infrastructure", sections), { page: "automation", automationCategory: "Infrastructure" });
  assert.deepEqual(resolveHomeLocation("/automation/bazy-dannyh/", sections), { page: "automation", automationCategory: "Базы данных" });
  assert.deepEqual(resolveHomeLocation("/automation/unknown", sections), { page: "automation", automationCategory: "all" });
});

test("path building preserves existing automation category behavior", () => {
  assert.equal(buildHomePath("overview", "all", sections), "/");
  assert.equal(buildHomePath("operations", "all", sections), "/operations");
  assert.equal(buildHomePath("showcase", "all", sections), "/showcase");
  assert.equal(buildHomePath("automation", "Infrastructure", sections), "/automation/infrastructure");
  assert.equal(buildHomePath("automation", "missing", sections), "/automation");
  assert.equal(buildHomePath("users", "Infrastructure", sections), "/users");
});
