import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as l8 from "../src/levels/level08/index.ts";
import type { Questions, State } from "../src/core/types.ts";

const SANDBOX = fileURLToPath(new URL("./fixtures/sandbox/", import.meta.url));

/** A decide that records what it was sent and answers with fixed values. */
function fake(answer: Record<string, unknown>) {
  const calls: { state: State; questions: Questions }[] = [];
  const decide = async (state: State, questions: Questions) => { calls.push({ state, questions }); return { answers: { answer } as any, usage: { input_tokens: 10, output_tokens: 2 } }; };
  return { calls, decide };
}

test("L8: readFileState hands back the path and the text", async () => {
  const s = await l8.readFileState("src/auth/session.ts", SANDBOX);
  assert.equal(s.path, "src/auth/session.ts");
  assert.match(s.content, /export function validate/);
});

test("L8: missing, binary, and oversized files are refused with the path", async () => {
  await assert.rejects(l8.readFileState("src/nope.ts", SANDBOX), /not found: src\/nope\.ts/);
  const dir = await mkdtemp(join(tmpdir(), "jev-"));
  await writeFile(join(dir, "blob.bin"), Buffer.from([0x89, 0x50, 0x00, 0x47, 0x0d, 0x0a]));
  await assert.rejects(l8.readFileState("blob.bin", dir), /binary/);
  await writeFile(join(dir, "big.txt"), "x".repeat(l8.MAX_FILE_CHARS + 1));
  await assert.rejects(l8.readFileState("big.txt", dir), /too large/);
});

test("L8 A: the bool tool sends the file as content and returns a boolean plus the noul", async () => {
  const { calls, decide } = fake({ type: "noul", noul: 0.91 });
  const r = await l8.askFileBool("src/auth/session.ts", "Does `content` validate tokens?", SANDBOX, { yes: "It checks a token", no: "No token handling" }, decide);
  assert.equal(r.answer, true);
  assert.equal(r.noul, 0.91);
  assert.equal((calls[0].state as any).path, "src/auth/session.ts");
  assert.match((calls[0].state as any).content, /validate/);
  assert.equal((calls[0].questions.answer as any).criteria.true, "It checks a token");
});

test("L8 B: the choice tool adds an exit option when the agent leaves none", async () => {
  const { calls, decide } = fake({ type: "choice", choice: "http_handler", confidence: 0.8, probabilities: { http_handler: 0.8, other: 0.2 } });
  const r = await l8.askFileChoice("src/http/invoices.ts", "Which layer is `content`?", { http_handler: "Routes", data_access: "Storage" }, SANDBOX, decide);
  assert.equal(r.choice, "http_handler");
  assert.deepEqual(Object.keys((calls[0].questions.answer as any).criteria), ["http_handler", "data_access", "other"]);
});

test("L8 C: the score tool returns the nearest level in words", async () => {
  const levels = ["Isolated", "Some callers", "Security sensitive"];
  const { decide } = fake({ type: "score", score: 1.8, confidence: 0.7, legend: { "0": levels[0], "1": levels[1], "2": levels[2] }, probabilities: { "0": 0.1, "1": 0.2, "2": 0.7 } });
  const r = await l8.askFileScore("src/domain/plans.ts", "How risky is a refactor of `content`?", levels, SANDBOX, decide);
  assert.equal(r.top, 2);
  assert.equal(r.nearest, "Security sensitive");
});

test("L8: on the mock, all three tools return their declared shapes", async () => {
  const b = await l8.askFileBool("src/auth/session.ts", "Does `content` validate tokens?", SANDBOX);
  assert.equal(typeof b.answer, "boolean");
  const c = await l8.askFileChoice("src/http/invoices.ts", "Which layer is `content`?", { http_handler: "Routes", domain_logic: "Rules", data_access: "Storage" }, SANDBOX);
  assert.ok(["http_handler", "domain_logic", "data_access", "other"].includes(c.choice));
  const s = await l8.askFileScore("src/domain/plans.ts", "How risky is a refactor of `content`?", ["Low", "Medium", "High"], SANDBOX);
  assert.ok(s.score >= 0 && s.score <= 2);
});
