import test from "node:test";
import assert from "node:assert/strict";
import { MockJev, flattenState } from "../src/core/mock.ts";
import { JevClient } from "../src/core/client.ts";
import { choice, noul, score } from "../src/core/helpers.ts";
import { LIMITS, validateQuestions, QuestionValidationError } from "../src/core/types.ts";

test("mock noul returns a probability in [0,1] and exact answer shape", () => {
  const mock = new MockJev();
  const res = mock.systemOne({
    state: "The integration is down and we are losing sales. Please help immediately.",
    questions: { is_urgent: noul("Does this convey urgency?") },
  });
  assert.equal(res.answers.is_urgent.type, "noul");
  assert.ok(res.answers.is_urgent.noul > 0 && res.answers.is_urgent.noul <= 1);
  assert.ok(res.usage.input_tokens > 0);
});

test("mock choice probabilities sum to ~1 and choice is a defined option", () => {
  const mock = new MockJev();
  const res = mock.systemOne({
    state: "The API returns 500 errors on the invoices endpoint",
    questions: {
      department: choice("Which team handles this?", {
        billing: "Charges, invoices, refunds",
        technical: "API bugs, outages, endpoints returning 500 errors",
      }),
    },
  });
  const a = res.answers.department;
  assert.equal(a.type, "choice");
  assert.ok(["billing", "technical"].includes(a.choice));
  const sum = Object.values(a.probabilities).reduce((x, y) => x + y, 0);
  assert.ok(Math.abs(sum - 1) < 0.01, `probabilities sum to ${sum}`);
  assert.ok(a.confidence >= 0 && a.confidence <= 1);
});

test("mock score returns legend, weighted score within level range, confidence", () => {
  const mock = new MockJev();
  const levels = ["Calm", "Frustrated", "Very angry"];
  const res = mock.systemOne({
    state: "I am very angry, this is unacceptable, I will cancel",
    questions: { frustration: score("How frustrated?", levels) },
  });
  const a = res.answers.frustration;
  assert.equal(a.type, "score");
  assert.deepEqual(a.legend, { "0": "Calm", "1": "Frustrated", "2": "Very angry" });
  assert.ok(a.score >= 0 && a.score <= 2);
  assert.ok(a.confidence > 0.3, "angry text should land confidently on a level");
});

test("mock is deterministic: identical request, identical answer", () => {
  const mock = new MockJev();
  const req = {
    state: { ticket: "export crashes in safari" },
    questions: { category: choice("What kind of ticket?", { bug: "Something is broken, crashes", other: null }) },
  };
  const a = JSON.stringify(mock.systemOne(req));
  const b = JSON.stringify(mock.systemOne(req));
  assert.equal(a, b);
});

test("flattenState handles string, object, and array states", () => {
  assert.equal(flattenState("plain"), "plain");
  assert.ok(flattenState({ a: 1 }).includes("a"));
  assert.ok(flattenState([1, 2]).startsWith("["));
});

test("JevClient without a provider uses the mock backend", async () => {
  const client = new JevClient({ provider: "mock" });
  assert.equal(client.isLive, false);
  const res = await client.systemOne("hello", { q: noul("Is this greeting polite?") });
  assert.equal(res.answers.q.type, "noul");
});

test("validateQuestions enforces the 255-option Choice cap", () => {
  const criteria = Object.fromEntries(Array.from({ length: LIMITS.MAX_CHOICE_OPTIONS + 1 }, (_, i) => [`o${i}`, null]));
  assert.throws(
    () => validateQuestions({ too_big: choice("Pick one.", criteria) }),
    QuestionValidationError
  );
});

test("validateQuestions enforces score level bounds and rejects empty instructions", () => {
  assert.throws(() => validateQuestions({ s: score("Rate.", ["only one level"]) }), QuestionValidationError);
  assert.throws(() => validateQuestions({ s: score("", ["a", "b"]) }), QuestionValidationError);
  assert.throws(() => validateQuestions({ n: noul("") }), QuestionValidationError);
  // A valid question map passes.
  assert.doesNotThrow(() => validateQuestions({ n: noul("Is this fine?"), c: choice("Pick.", { a: null, b: "desc" }), s: score("Rate.", ["low", "high"]) }));
});
