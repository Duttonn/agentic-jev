import test, { beforeEach, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { setImmediate as nextTurn } from "node:timers/promises";
import {
  ContractError, JevClient, validateResponse,
  type JevClientOptions, type JevEvent, type JevProvider,
} from "../src/core/client.ts";
import { choice, noul, score } from "../src/core/helpers.ts";
import {
  QuestionValidationError, validateQuestions,
  type Questions, type State, type SystemOneResponse,
} from "../src/core/types.ts";

const questions = { q: noul("Is this urgent?") };
const endpoints = {
  typesafe: "https://api.typesafe.ai/v1/systemone",
  openrouter: "https://openrouter.ai/api/alpha/decisions",
};

// Each test file has its own process. Never inspect or use ambient credentials,
// and deny all fetches unless this test supplies an entirely offline stub.
beforeEach((t) => {
  for (const key of ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "JEV_BACKEND"]) delete process.env[key];
  process.env.NODE_TEST_CONTEXT = "child-v8";
  process.env.JEV_LIVE = "0";
  assert.ok("mock" in t, "beforeEach requires a test context");
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unstubbed fetch forbidden"); });
});

function productionEnv() {
  delete process.env.NODE_TEST_CONTEXT;
}

function payload(): SystemOneResponse {
  return {
    model: "jev-pinned-response",
    answers: { q: { type: "noul", noul: 0.75 } },
    usage: { input_tokens: 1000, output_tokens: 200 },
  };
}

function ok(value: unknown = payload()): Response {
  return new Response(JSON.stringify(value), { status: 200 });
}

function live(opts: JevClientOptions = {}): JevClient {
  return new JevClient({ provider: "typesafe", apiKey: "dummy-typesafe", retryDelayMs: 0, ...opts });
}

function stub(t: TestContext, implementation: typeof fetch = async () => ok()) {
  return t.mock.method(globalThis, "fetch", implementation);
}

for (const [name, typesafe, openrouter, expected] of [
  ["both keys prefer TypeSafe", "dummy-ts", "dummy-or", "typesafe"],
  ["TypeSafe only", "dummy-ts", "", "typesafe"],
  ["OpenRouter only", "", "dummy-or", "openrouter"],
  ["blank TypeSafe is ignored", "  ", "dummy-or", "openrouter"],
  ["keys are trimmed", "  dummy-ts  ", "dummy-or", "typesafe"],
] as const) {
  test(`provider selection: ${name}`, async (t) => {
    productionEnv();
    process.env.TYPESAFE_API_KEY = typesafe;
    process.env.OPENROUTER_API_KEY = openrouter;
    const fetch = stub(t);
    const client = new JevClient();
    assert.equal(client.provider, expected);
    assert.equal(client.isLive, true);
    await client.systemOne("urgent", questions);
    const [url, init] = fetch.mock.calls[0].arguments;
    assert.equal(url, endpoints[expected]);
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${expected === "typesafe" ? typesafe.trim() : openrouter.trim()}`);
  });
}

for (const blank of [undefined, "", "  \t  "]) {
  test(`production with missing/blank keys fails closed (${JSON.stringify(blank)})`, () => {
    productionEnv();
    if (blank !== undefined) {
      process.env.TYPESAFE_API_KEY = blank;
      process.env.OPENROUTER_API_KEY = blank;
    }
    assert.throws(() => new JevClient(), /No Jev credentials/);
  });
}

test("explicit provider wins; valid JEV_BACKEND overrides key precedence", () => {
  productionEnv();
  process.env.TYPESAFE_API_KEY = "dummy-ts";
  process.env.OPENROUTER_API_KEY = "dummy-or";
  process.env.JEV_BACKEND = "openrouter";
  assert.equal(new JevClient().provider, "openrouter");
  assert.equal(new JevClient({ provider: "typesafe" }).provider, "typesafe");
  assert.equal(new JevClient({ provider: "mock" }).provider, "mock");
  process.env.JEV_BACKEND = "mock";
  assert.equal(new JevClient().provider, "mock");
  process.env.JEV_BACKEND = "typesafe";
  assert.equal(new JevClient().provider, "typesafe");
  process.env.JEV_BACKEND = "  ";
  assert.equal(new JevClient().provider, "typesafe");
  process.env.JEV_BACKEND = "not-a-provider";
  assert.throws(() => new JevClient(), /Unknown JEV backend/);
  assert.equal(new JevClient({ provider: "mock" }).provider, "mock");
  assert.throws(() => new JevClient({ provider: "invalid" as JevProvider }), /Unknown JEV backend/);
});

test("explicit missing/blank provider key fails rather than falling back", () => {
  productionEnv();
  process.env.OPENROUTER_API_KEY = "dummy-or";
  process.env.TYPESAFE_API_KEY = "  ";
  assert.throws(() => new JevClient({ provider: "typesafe" }), /TYPESAFE_API_KEY/);
  process.env.JEV_BACKEND = "typesafe";
  assert.throws(() => new JevClient(), /TYPESAFE_API_KEY/);
  process.env.TYPESAFE_API_KEY = "dummy-ts";
  assert.throws(() => new JevClient({ provider: "typesafe", apiKey: " " }), /nonblank/);
});

test("apiKey requires an explicit live opts.provider, even with env selection or test isolation", async (t) => {
  process.env.JEV_BACKEND = "openrouter";
  for (const provider of [undefined, "mock"] as const) {
    assert.throws(() => new JevClient({ provider, apiKey: "dummy" }), /explicit live opts.provider/);
  }
  productionEnv();
  assert.throws(() => new JevClient({ apiKey: "dummy" }), /explicit live opts.provider/);
  const fetch = stub(t);
  await new JevClient({ provider: "openrouter", apiKey: " dummy-explicit " }).systemOne("x", questions);
  assert.equal(new Headers(fetch.mock.calls[0].arguments[1]?.headers).get("authorization"), "Bearer dummy-explicit");
});

test("node:test isolation beats all ambient keys/backends; explicit and JEV_LIVE opt-ins still work", async () => {
  process.env.TYPESAFE_API_KEY = "dummy-ts";
  process.env.OPENROUTER_API_KEY = "dummy-or";
  for (const backend of ["openrouter", "typesafe", "invalid"]) {
    process.env.JEV_BACKEND = backend;
    const client = new JevClient();
    assert.equal(client.provider, "mock");
    assert.equal((await client.systemOne("x", questions)).meta.cost.source, "mock");
  }
  assert.equal(new JevClient({ provider: "openrouter" }).provider, "openrouter");
  process.env.JEV_BACKEND = "openrouter";
  process.env.JEV_LIVE = "1";
  assert.equal(new JevClient().provider, "openrouter");
  delete process.env.JEV_BACKEND;
  assert.equal(new JevClient().provider, "typesafe");
});

for (const provider of ["typesafe", "openrouter"] as const) {
  test(`${provider}: env mutations cannot change provider, credentials, endpoint or model`, async (t) => {
    productionEnv();
    process.env[provider === "typesafe" ? "TYPESAFE_API_KEY" : "OPENROUTER_API_KEY"] = "dummy-original";
    const fetch = stub(t);
    const client = new JevClient();
    await client.systemOne("first", questions);
    process.env.TYPESAFE_API_KEY = "dummy-replaced-ts";
    process.env.OPENROUTER_API_KEY = "dummy-replaced-or";
    process.env.JEV_BACKEND = provider === "typesafe" ? "openrouter" : "typesafe";
    await client.systemOne("second", questions);
    delete process.env.TYPESAFE_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    await client.systemOne("third", questions);
    assert.equal(client.provider, provider);
    for (const call of fetch.mock.calls) {
      const [url, init] = call.arguments;
      assert.equal(url, endpoints[provider]);
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer dummy-original");
      assert.equal(JSON.parse(init?.body as string).model, provider === "typesafe" ? "jev-latest" : "~typesafe/jev-latest");
    }
  });
}

test("custom endpoint, constructor model, per-call model and observer API remain compatible", async (t) => {
  const fetch = stub(t);
  const client = live({ baseUrl: "https://example.invalid/decisions", model: "jev-pinned" });
  const events: JevEvent[] = [];
  const unsubscribe = client.on((event) => events.push(event));
  const first = await client.systemOne({ text: "x" }, questions);
  unsubscribe();
  const second = await client.systemOne(["y"], questions, { model: "jev-override" });
  assert.equal(first.meta.requestedModel, "jev-pinned");
  assert.equal(first.meta.resolvedModel, "jev-pinned-response");
  assert.equal(second.meta.requestedModel, "jev-override");
  assert.equal(first.meta.attempts, 1);
  assert.ok(first.meta.elapsedMs >= 0);
  assert.equal(client.calls, 2);
  assert.deepEqual(events.map((event) => event.kind), ["request", "response"]);
  assert.equal(fetch.mock.calls[0].arguments[0], "https://example.invalid/decisions");
  assert.deepEqual(JSON.parse(fetch.mock.calls[0].arguments[1]?.body as string), {
    model: "jev-pinned", state: { text: "x" }, questions,
  });
});

test("raw retains exact wire text, unknown fields and provider meta/raw without enrichment or aliases", async (t) => {
  const original = {
    ...payload(),
    answers: { q: { type: "noul", noul: 0.75, explanation: { opaque: ["preserve"] } } },
    usage: { input_tokens: 1000, output_tokens: 200, cost: 0, extra: "usage-extension" },
    extension: { nested: true },
    meta: { providerField: "untouched" },
    raw: { providerField: "also untouched" },
  };
  const text = " \n" + JSON.stringify(original, null, 3) + "\n  ";
  const fetch = stub(t, async () => new Response(text));
  const state = { text: "before" };
  const qs = { q: { ...noul("Is this urgent?"), extension: { opaque: true } } };
  const client = live();
  client.on((event) => {
    if (event.kind === "request") {
      state.text = "changed by observer";
      qs.q.instructions = "changed by observer";
    }
  });
  const result = await client.systemOne(state, qs);
  assert.equal(result.raw.requestText, fetch.mock.calls[0].arguments[1]?.body);
  assert.deepEqual(result.raw.request, JSON.parse(result.raw.requestText));
  assert.deepEqual(result.raw.request.state, { text: "before" });
  assert.equal(result.raw.request.questions.q.instructions, "Is this urgent?");
  assert.deepEqual(JSON.parse(result.raw.requestText).questions.q.extension, { opaque: true });
  assert.equal(result.raw.responseText, text);
  assert.deepEqual(result.raw.response, original);
  assert.deepEqual(result.extension, original.extension);
  assert.deepEqual(result.answers.q, original.answers.q);
  assert.deepEqual(result.meta.cost, { amount: 0, source: "reported" });
  result.usage.input_tokens = 99;
  assert.equal(result.answers.q.type, "noul");
  result.answers.q.noul = 0.1;
  assert.deepEqual(result.raw.response, original);
  assert.ok(!JSON.stringify(result.raw).includes("dummy-typesafe"));
});

test("mock has the same raw contract and zero mock cost without network", async () => {
  const result = await new JevClient({ provider: "mock", pricing: { inputPerMillion: 9, outputPerMillion: 9 } })
    .systemOne("x", questions);
  assert.deepEqual(result.raw.response, JSON.parse(result.raw.responseText));
  assert.deepEqual(result.raw.request, JSON.parse(result.raw.requestText));
  assert.equal(Object.hasOwn(result.raw.response, "meta"), false);
  assert.deepEqual(result.meta.cost, { amount: 0, source: "mock" });
});

for (const status of [429, 502, 503, 529]) {
  test(`HTTP ${status} retries up to three attempts on the identical transport`, async (t) => {
    let calls = 0;
    const failures: Response[] = [];
    const fetch = stub(t, async () => {
      if (++calls === 3) return ok();
      const failure = new Response("retry", { status });
      failures.push(failure);
      return failure;
    });
    const result = await live().systemOne("x", questions);
    assert.equal(result.meta.attempts, 3);
    assert.equal(fetch.mock.callCount(), 3);
    assert.ok(failures.every((failure) => failure.bodyUsed));
    const [url, init] = fetch.mock.calls[0].arguments;
    for (const call of fetch.mock.calls) {
      assert.equal(call.arguments[0], url);
      assert.equal(call.arguments[1]?.body, init?.body);
      assert.equal(call.arguments[1]?.signal, init?.signal);
      assert.deepEqual(call.arguments[1]?.headers, init?.headers);
    }
  });

  test(`HTTP ${status} exhaustion fails after exactly three attempts`, async (t) => {
    const fetch = stub(t, async () => new Response("retry", { status }));
    await assert.rejects(live().systemOne("x", questions), new RegExp(`typesafe HTTP ${status}`));
    assert.equal(fetch.mock.callCount(), 3);
  });
}

for (const status of [400, 401, 402, 403, 404, 408, 422, 500, 504]) {
  test(`HTTP ${status} does not retry, fall back to another key, or switch endpoints`, async (t) => {
    productionEnv();
    process.env.TYPESAFE_API_KEY = "dummy-ts";
    process.env.OPENROUTER_API_KEY = "dummy-or";
    const response = new Response("failure", { status });
    const fetch = stub(t, async () => response);
    const client = new JevClient();
    await assert.rejects(client.systemOne("x", questions), new RegExp(`typesafe HTTP ${status}`));
    assert.equal(fetch.mock.callCount(), 1);
    assert.equal(fetch.mock.calls[0].arguments[0], endpoints.typesafe);
    assert.equal(client.provider, "typesafe");
    assert.equal(response.bodyUsed, true);
  });
}

test("network errors propagate once without retry or fallback", async (t) => {
  const failure = new TypeError("offline network failure");
  const fetch = stub(t, async () => { throw failure; });
  await assert.rejects(live().systemOne("x", questions), (error) => error === failure);
  assert.equal(fetch.mock.callCount(), 1);
});

const now = Date.UTC(2030, 0, 1);
for (const [header, delay] of [
  [null, 500], ["", 500], ["garbage", 500], ["-1", 500], ["NaN", 500],
  ["Infinity", 500], ["1e3", 500], ["Mon nonsense", 500], ["9".repeat(400), 500],
  ["0", 500], ["0.75", 750], ["2", 2000], ["999999", 8000],
  [new Date(now + 4000).toUTCString(), 4000], [new Date(now - 4000).toUTCString(), 500],
] as const) {
  test(`Retry-After ${JSON.stringify(header)?.slice(0, 80)} produces a finite, bounded delay`, async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now });
    t.mock.method(Math, "random", () => 0);
    let calls = 0;
    stub(t, async () => ++calls === 1
      ? new Response("retry", { status: 429, headers: header === null ? {} : { "retry-after": header } })
      : ok());
    const pending = live({ retryDelayMs: 500 }).systemOne("x", questions);
    await nextTurn();
    assert.equal(calls, 1);
    t.mock.timers.tick(delay - 1);
    await nextTurn();
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    assert.equal((await pending).meta.attempts, 2);
  });
}

test("default backoff doubles with jitter and removes sleep listeners on success", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(Math, "random", () => 0.5);
  let signal: AbortSignal;
  let calls = 0;
  stub(t, async (_url, init) => {
    signal = init!.signal!;
    assert.equal(getEventListeners(signal, "abort").length, 0);
    return ++calls === 3 ? ok() : new Response("retry", { status: 503 });
  });
  const pending = live({ retryDelayMs: undefined }).systemOne("x", questions);
  await nextTurn();
  assert.equal(getEventListeners(signal!, "abort").length, 1);
  t.mock.timers.tick(549);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await nextTurn();
  assert.equal(calls, 2);
  t.mock.timers.tick(1099);
  assert.equal(calls, 2);
  t.mock.timers.tick(1);
  await pending;
  assert.equal(calls, 3);
  assert.equal(getEventListeners(signal!, "abort").length, 0);
  t.mock.timers.tick(30_000);
  assert.equal(signal!.aborted, false, "successful calls clear the deadline timer");
});

for (const provider of ["mock", "typesafe"] as const) {
  test(`${provider}: already-aborted calls reject before request events or transport`, async (t) => {
    const fetch = stub(t);
    const client = provider === "mock" ? new JevClient({ provider }) : live();
    const events: JevEvent[] = [];
    client.on((event) => events.push(event));
    const reason = new Error("caller cancelled");
    await assert.rejects(client.systemOne("x", questions, { signal: AbortSignal.abort(reason) }), (error) => error === reason);
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(client.calls, 0);
    assert.deepEqual(events, []);
  });
}

function abortableFetch(t: TestContext) {
  return stub(t, async (_url, init) => new Promise<Response>((_resolve, reject) => {
    const signal = init!.signal!;
    signal.throwIfAborted();
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
}

test("caller abort during fetch propagates its reason without retries", async (t) => {
  const fetch = abortableFetch(t);
  const controller = new AbortController();
  const reason = new Error("stop now");
  const pending = live().systemOne("x", questions, { signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(fetch.mock.callCount(), 1);
});

test("default timeout is 30s and aborts an in-flight fetch", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const fetch = abortableFetch(t);
  const pending = live().systemOne("x", questions);
  const rejection = assert.rejects(pending, { name: "TimeoutError" });
  const signal = fetch.mock.calls[0].arguments[1]!.signal!;
  t.mock.timers.tick(29_999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejection;
  assert.equal(signal.aborted, true);
  assert.equal(fetch.mock.callCount(), 1);
});

test("timeout covers response body consumption, not just headers", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  stub(t, async (_url, init) => new Response(new ReadableStream({
    start(controller) {
      init!.signal!.addEventListener("abort", () => controller.error(init!.signal!.reason), { once: true });
    },
  })));
  const pending = live({ timeoutMs: 100 }).systemOne("x", questions);
  const rejection = assert.rejects(pending, { name: "TimeoutError" });
  await nextTurn();
  t.mock.timers.tick(100);
  await rejection;
});

test("timeout is a total retry budget and cleans up backoff listeners", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(Math, "random", () => 0);
  const fetch = stub(t, async () => new Response("retry", { status: 503 }));
  const pending = live({ timeoutMs: 1000, retryDelayMs: 600 }).systemOne("x", questions);
  const rejection = assert.rejects(pending, { name: "TimeoutError" });
  await nextTurn();
  t.mock.timers.tick(600);
  await nextTurn();
  assert.equal(fetch.mock.callCount(), 2);
  const signal = fetch.mock.calls[0].arguments[1]!.signal!;
  assert.equal(getEventListeners(signal, "abort").length, 1);
  t.mock.timers.tick(400);
  await rejection;
  assert.equal(getEventListeners(signal, "abort").length, 0);
  t.mock.timers.tick(8000);
  assert.equal(fetch.mock.callCount(), 2);
});

test("caller abort during backoff cleans up its listener and prevents another attempt", async (t) => {
  const fetch = stub(t, async () => new Response("retry", { status: 429 }));
  const controller = new AbortController();
  const reason = new Error("cancel backoff");
  const pending = live({ retryDelayMs: 1000 }).systemOne("x", questions, { signal: controller.signal });
  await nextTurn();
  const signal = fetch.mock.calls[0].arguments[1]!.signal!;
  assert.equal(getEventListeners(signal, "abort").length, 1);
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(getEventListeners(signal, "abort").length, 0);
  assert.equal(fetch.mock.callCount(), 1);
});

test("abort just before sleep rejects immediately, even when the abort event was already fired", async (t) => {
  const controller = new AbortController();
  const reason = new Error("cancel while discarding response");
  const fetch = stub(t, async () => new Response(new ReadableStream({
    cancel() { controller.abort(reason); },
  }), { status: 429 }));
  await assert.rejects(live({ retryDelayMs: 8000 }).systemOne("x", questions, { signal: controller.signal }), (error) => error === reason);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(getEventListeners(fetch.mock.calls[0].arguments[1]!.signal!, "abort").length, 0);
});

for (const reported of [0, 0.0123]) {
  test(`valid reported cost ${reported} wins over estimates`, async (t) => {
    const response = payload();
    response.usage.cost = reported;
    stub(t, async () => ok(response));
    const result = await live({ pricing: { inputPerMillion: 2, outputPerMillion: 6 } }).systemOne("x", questions);
    assert.deepEqual(result.meta.cost, { amount: reported, source: "reported" });
  });
}

for (const invalid of [undefined, null, -1, "0.5", false, {}, Infinity, NaN]) {
  test(`missing/invalid cost ${String(invalid)} uses only caller pricing or unknown`, async (t) => {
    const response = payload();
    response.usage.cost = invalid;
    stub(t, async () => ok(response));
    const unknown = await live().systemOne("x", questions);
    assert.deepEqual(unknown.meta.cost, { amount: null, source: "unknown" });
    const estimated = await live({ pricing: { inputPerMillion: 2, outputPerMillion: 6 } }).systemOne("x", questions);
    assert.deepEqual(estimated.meta.cost, { amount: 0.0032, source: "estimated" });
  });
}

test("pricing is snapshotted, zero rates are valid, and unrepresentable estimates remain unknown", async (t) => {
  stub(t);
  const pricing = { inputPerMillion: 2, outputPerMillion: 6 };
  const client = live({ pricing });
  pricing.inputPerMillion = 999;
  assert.deepEqual((await client.systemOne("x", questions)).meta.cost, { amount: 0.0032, source: "estimated" });
  assert.deepEqual((await live({ pricing: { inputPerMillion: 0, outputPerMillion: 0 } }).systemOne("x", questions)).meta.cost,
    { amount: 0, source: "estimated" });
  const response = payload();
  response.usage.input_tokens = Number.MAX_SAFE_INTEGER;
  stub(t, async () => ok(response));
  const result = await live({ pricing: { inputPerMillion: Number.MAX_VALUE, outputPerMillion: 0 } }).systemOne("x", questions);
  assert.deepEqual(result.meta.cost, { amount: null, source: "unknown" });
});

test("invalid timeout, backoff and pricing options fail at construction", () => {
  for (const timeoutMs of [0, -1, 1.5, NaN, Infinity, 2_147_483_648]) {
    assert.throws(() => live({ timeoutMs }), /timeoutMs/);
  }
  for (const retryDelayMs of [-1, NaN, Infinity]) assert.throws(() => live({ retryDelayMs }), /retryDelayMs/);
  for (const pricing of [null, {}, { inputPerMillion: 1 }, { inputPerMillion: -1, outputPerMillion: 1 },
    { inputPerMillion: 1, outputPerMillion: NaN }, { inputPerMillion: Infinity, outputPerMillion: 1 }]) {
    assert.throws(() => live({ pricing } as JevClientOptions), /pricing/);
  }
});

for (const value of [null, [], {}, { ...payload(), model: " " }, { ...payload(), answers: {} },
  { ...payload(), answers: { q: { type: "choice" } } }, { ...payload(), answers: { q: { type: "noul", noul: 2 } } },
  { ...payload(), usage: undefined }, { ...payload(), usage: [] },
  { ...payload(), usage: { input_tokens: "1", output_tokens: 2 } },
  { ...payload(), usage: { input_tokens: -1, output_tokens: 2 } },
  { ...payload(), usage: { input_tokens: 1, output_tokens: 0.5 } },
  { ...payload(), usage: { input_tokens: 1, output_tokens: Number.MAX_SAFE_INTEGER + 1 } },
]) {
  test(`invalid response is a non-retryable contract error: ${JSON.stringify(value)}`, async (t) => {
    const fetch = stub(t, async () => ok(value));
    await assert.rejects(live().systemOne("x", questions), ContractError);
    assert.equal(fetch.mock.callCount(), 1);
  });
}

test("invalid JSON is a non-retryable contract error", async (t) => {
  const fetch = stub(t, async () => new Response("not JSON"));
  await assert.rejects(live().systemOne("x", questions), ContractError);
  assert.equal(fetch.mock.callCount(), 1);
});

test("usage validates nonfinite counts and permits zero counts", () => {
  const response = payload();
  for (const count of [NaN, Infinity, -Infinity]) {
    response.usage.input_tokens = count;
    assert.throws(() => validateResponse(response, questions), ContractError);
  }
  response.usage = { input_tokens: 0, output_tokens: 0 };
  assert.doesNotThrow(() => validateResponse(response, questions));
});

const scoreQuestions = { q: score("Rate urgency", ["low", "high"]) };
const scoreAnswer = {
  type: "score", score: 0.75, confidence: 0.75,
  probabilities: { "0": 0.25, "1": 0.75 }, legend: { "0": "low", "1": "high" },
};
for (const patch of [
  { legend: undefined }, { legend: ["low", "high"] }, { legend: { "0": "low" } },
  { legend: { "0": "high", "1": "low" } }, { legend: { "0": "low", "1": "high", "2": "extra" } },
  { legend: { "0": "low", "1": 1 } }, { score: -1 }, { score: 2 }, { score: "0.75" },
  { confidence: 2 }, { probabilities: { "0": 0.1, "1": 0.1 } },
  { probabilities: { "0": 0.25, "wrong": 0.75 } }, { probabilities: { "0": -0.25, "1": 1.25 } },
]) {
  test(`score contract rejects malformed legend/distribution: ${JSON.stringify(patch)}`, async (t) => {
    const fetch = stub(t, async () => ok({ ...payload(), answers: { q: { ...scoreAnswer, ...patch } } }));
    await assert.rejects(live().systemOne("x", scoreQuestions), ContractError);
    assert.equal(fetch.mock.callCount(), 1);
  });
}

test("choice and score valid answers remain unchanged; choices must be declared", async (t) => {
  const qs = { ...scoreQuestions, route: choice("Route", { a: null, b: "Other" }) };
  const response = { ...payload(), answers: {
    q: scoreAnswer,
    route: { type: "choice", choice: "a", probabilities: { a: 0.75, b: 0.25 }, confidence: 0.75 },
  } };
  stub(t, async () => ok(response));
  const result = await live().systemOne("x", qs);
  assert.deepEqual(result.answers, response.answers);
  response.answers.route.choice = "undeclared";
  assert.throws(() => validateResponse(response, qs), ContractError);
});

for (const malformed of [
  null, [], {}, { q: null }, { q: [] }, { q: { instructions: "hi" } },
  { q: { type: "unknown", instructions: "hi" } }, { q: { type: "noul", instructions: 1 } },
  { q: { type: "noul", instructions: " " } }, { q: { type: "noul", instructions: [] } },
  { q: { type: "noul", instructions: "hi", criteria: { true: 1 } } },
  { q: { type: "choice", instructions: "hi" } }, { q: { type: "choice", instructions: "hi", criteria: [] } },
  { q: { type: "choice", instructions: "hi", criteria: { a: 1 } } },
  { q: { type: "score", instructions: "hi", criteria: "abc" } },
  { q: { type: "score", instructions: "hi", criteria: ["a", 1] } },
  { q: { type: "score", instructions: "hi", criteria: ["a", " "] } },
]) {
  test(`runtime question validation rejects before transport: ${JSON.stringify(malformed)}`, async (t) => {
    const fetch = stub(t);
    assert.throws(() => validateQuestions(malformed), QuestionValidationError);
    const client = live();
    await assert.rejects(client.systemOne("x", malformed as Questions), QuestionValidationError);
    assert.equal(fetch.mock.callCount(), 0);
    assert.equal(client.calls, 0);
  });
}

test("runtime state, model and serialization errors reject before transport", async (t) => {
  const fetch = stub(t);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  for (const state of [null, undefined, 42, true, new Date(), cycle, { bigint: 1n }, { toJSON: () => null }]) {
    await assert.rejects(live().systemOne(state as State, questions), QuestionValidationError);
  }
  for (const model of ["", " ", 123]) {
    await assert.rejects(live().systemOne("x", questions, { model: model as string }), QuestionValidationError);
  }
  assert.equal(fetch.mock.callCount(), 0);
});


test("nonfinite cost parsed from JSON is preserved but never reported as valid", async (t) => {
  const text = JSON.stringify(payload()).replace('"input_tokens":1000', '"cost":1e999,"input_tokens":1000');
  stub(t, async () => new Response(text));
  const result = await live().systemOne("x", questions);
  assert.equal(result.raw.responseText, text);
  assert.equal(result.raw.response.usage.cost, Infinity);
  assert.deepEqual(result.meta.cost, { amount: null, source: "unknown" });
});


test("malformed choice values consistently produce ContractError", () => {
  const qs = { q: choice("Route", { a: null, b: null }) };
  for (const value of [null, 1, { toString: null }]) {
    const response = { ...payload(), answers: { q: {
      type: "choice", choice: value, probabilities: { a: 0.75, b: 0.25 }, confidence: 0.75,
    } } };
    assert.throws(() => validateResponse(response, qs), ContractError);
  }
});
