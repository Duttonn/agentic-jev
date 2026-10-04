import test from "node:test";
import assert from "node:assert/strict";
import { login, validate } from "../src/auth/session.ts";

test("login issues a token the validator accepts", () => {
  const token = login("dana@example.com", "hunter2");
  assert.ok(token);
  const session = validate(token!);
  assert.equal(session?.email, "dana@example.com");
});

test("wrong password issues nothing", () => {
  assert.equal(login("dana@example.com", "nope"), null);
});
