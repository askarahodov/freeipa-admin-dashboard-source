import assert from "node:assert/strict";
import test from "node:test";

import {
  freeIpaDirectCall,
  freeIpaOperations,
  isFreeIpaOperation,
} from "../../worker/freeipa-action-runtime.ts";

test("FreeIPA action registry stays canonical for direct and routed operations", () => {
  assert.equal(freeIpaOperations.size, 10);
  for (const operation of ["user_add", "user_mod", "user_password", "user_enable", "user_disable", "user_del", "group_add", "group_del", "group_add_member", "group_remove_member"]) {
    assert.equal(isFreeIpaOperation(operation), true, operation);
  }
  assert.equal(isFreeIpaOperation("server_delete"), false);
});

test("direct FreeIPA call normalization keeps secrets out of persisted run values", () => {
  const call = freeIpaDirectCall("user_add", {
    username: "alice",
    firstName: "Alice",
    lastName: "Admin",
    email: "alice@example.test",
    password: "super-secret-password",
  });
  assert.equal(call.method, "user_add");
  assert.deepEqual(call.args, ["alice"]);
  assert.deepEqual(call.options, {
    givenname: "Alice",
    sn: "Admin",
    mail: "alice@example.test",
    userpassword: "super-secret-password",
  });
  assert.deepEqual(call.values, { uid: "alice", mail: "alice@example.test" });
  assert.equal(JSON.stringify(call.values).includes("super-secret-password"), false);
});

test("direct FreeIPA normalization preserves validation errors", () => {
  assert.throws(() => freeIpaDirectCall("user_disable", { username: "bad user" }), /Некорректное поле: логин/);
  assert.throws(() => freeIpaDirectCall("user_password", { username: "alice", password: "short" }), /не менее 8 символов/);
  assert.throws(() => freeIpaDirectCall("user_mod", { username: "alice" }), /хотя бы одно изменяемое поле/);
});
