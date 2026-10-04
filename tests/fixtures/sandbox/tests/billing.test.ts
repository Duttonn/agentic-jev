import test from "node:test";
import assert from "node:assert/strict";
import { prorate, canExport, monthlyCents } from "../src/domain/billing.ts";

test("monthly price per plan", () => {
  assert.equal(monthlyCents("free"), 0);
  assert.equal(monthlyCents("team"), 4900);
});

test("free plans cannot export", () => {
  assert.equal(canExport("free"), false);
  assert.equal(canExport("team"), true);
});

test("proration rounds to the nearest cent", () => {
  // 4900 * 8 / 31 = 1264.52, nearest cent is 1265
  assert.equal(prorate("team", 8, 31), 1265);
});
