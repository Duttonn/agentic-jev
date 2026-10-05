/** The bench's metrics: ranking quality, accuracy at a line, and the line that fits best. */
import assert from "node:assert/strict";
import test from "node:test";
import { accuracy, auc, bestLine } from "../bench/metrics.ts";

test("auc is 1 for a perfect ranking, 0.5 for ties, 0 when reversed", () => {
  assert.equal(auc([0.9, 0.8, 0.2, 0.1], [true, true, false, false]), 1);
  assert.equal(auc([0.5, 0.5], [true, false]), 0.5);
  assert.equal(auc([0.1, 0.9], [true, false]), 0);
});

test("bestLine sits between the two groups when they separate, and accuracy agrees", () => {
  const scores = [0.84, 0.75, 0.5, 0.2, 0.1, 0.05], labels = [true, true, true, false, false, false];
  const line = bestLine(scores, labels);
  assert.ok(line > 0.2 && line <= 0.5, String(line));
  assert.equal(accuracy(scores, labels, line), 1);
  assert.equal(accuracy(scores, labels, 0.7), 5 / 6, "0.5 is a yes the 0.7 line misses");
});
