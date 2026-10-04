import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as l9 from "../src/levels/level09/index.ts";
import type { Questions, State } from "../src/core/types.ts";

const SANDBOX = fileURLToPath(new URL("./fixtures/sandbox/", import.meta.url));
const Q = JSON.stringify({ touches_auth: { type: "noul", instructions: "Does `content` handle authentication?" } });

test("L9: malformed question blocks fail before any file is read", () => {
  assert.throws(() => l9.parseQuestions("{not json"), /not valid JSON/);
  assert.throws(() => l9.parseQuestions("[]"), /object keyed by question id/);
  assert.throws(() => l9.parseQuestions(JSON.stringify({ q: { type: "choice", instructions: "x", criteria: {} } })), /no options/);
});

test("L9: parallel keeps order and never exceeds the cap in flight", async () => {
  let inFlight = 0, peak = 0;
  const out = await l9.parallel([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return n * 2;
  });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12, 14]);
  assert.ok(peak <= 3 && peak >= 2, `peak ${peak}`);
});

test("L9 B: globs and directories expand, skip dirs and junk drop with a reason, the cap holds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev9-"));
  await mkdir(join(dir, "src"));
  await mkdir(join(dir, "node_modules", "dep"), { recursive: true });
  await writeFile(join(dir, "src", "a.ts"), "export const a = 1;");
  await writeFile(join(dir, "src", "b.ts"), "export const b = 2;");
  await writeFile(join(dir, "src", "logo.png"), "png");
  await writeFile(join(dir, "src", "empty.ts"), "");
  await writeFile(join(dir, "node_modules", "dep", "index.js"), "module.exports = 1;");
  const expanded = await l9.expandPatterns(["src", "node_modules/**/*.js", "missing.ts"], dir, false);
  const { files, skipped } = await l9.pruneFiles(expanded, dir, 1);
  assert.deepEqual(files, ["src/a.ts"]);
  const reasons = Object.fromEntries(skipped.map((s) => [s.path, s.reason]));
  assert.match(reasons["src/logo.png"], /binary/);
  assert.match(reasons["src/empty.ts"], /empty/);
  assert.match(reasons["node_modules/dep/index.js"], /skipped directory/);
  assert.match(reasons["missing.ts"], /not found/);
  assert.match(reasons["src/b.ts"], /over the 1 file cap/);
});

test("L9 A: one call per file with every question, results per path, in parallel", async () => {
  const calls: State[] = [];
  const decide = async (state: State, questions: Questions) => { calls.push(state); return { answers: { touches_auth: { type: "noul", noul: 0.5 } } as any }; };
  const r = await l9.askFiles(["src/auth/session.ts", "src/auth/jwt.ts", "src/http/routes.ts"], Q, SANDBOX, { decide });
  assert.equal(r.calls, 3);
  assert.deepEqual(r.results.map((x) => x.path), ["src/auth/jwt.ts", "src/auth/session.ts", "src/http/routes.ts"]);
  assert.ok(calls.every((s) => typeof (s as any).content === "string"));
});

test("L9 A: a recursive glob over the sandbox source answers every file on the mock", async () => {
  const r = await l9.askFiles(["src/**/*.ts"], Q, SANDBOX, { concurrency: 4 });
  assert.ok(r.calls >= 8, `calls ${r.calls}`);
  assert.ok(r.results.every((x) => typeof (x.answers.touches_auth as any).noul === "number"));
});

test("L9 C: the first pick is keyed by path with an exit, and a weak pick returns null", async () => {
  const cands = [{ path: "src/domain/billing.ts", note: "proration" }, { path: "src/db/users.ts" }];
  const q = l9.pickQuestion("Which file first?", cands);
  assert.deepEqual(Object.keys(q.pick.criteria), ["src/domain/billing.ts", "src/db/users.ts", "none"]);
  const strong = await l9.pickFirstFile("Which file first?", cands, async () => ({ answers: { pick: { type: "choice", choice: "src/domain/billing.ts", confidence: 0.9, probabilities: {} } } as any }));
  assert.equal(strong.path, "src/domain/billing.ts");
  const weak = await l9.pickFirstFile("Which file first?", cands, async () => ({ answers: { pick: { type: "choice", choice: "src/db/users.ts", confidence: 0.2, probabilities: {} } } as any }));
  assert.equal(weak.path, null);
  const none = await l9.pickFirstFile("Which file first?", [], async () => { throw new Error("must not call"); });
  assert.equal(none.path, null);
});
