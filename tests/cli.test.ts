/**
 * bin/jev end to end: ask with a command, no gate, files over a glob, stdin questions, bad input, compact, setup.
 * Offline on the mock by default. JEV_LIVE=1 runs the same calls against real Jev and checks the answers.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const BIN = fileURLToPath(new URL("../bin/jev", import.meta.url));
const SANDBOX = fileURLToPath(new URL("./fixtures/sandbox/", import.meta.url));
const LIVE = process.env.JEV_LIVE === "1";
const tmp = mkdtempSync(`${tmpdir()}/jev-test-`);
const env: NodeJS.ProcessEnv = { ...process.env, JEV_STATE_DIR: `${tmp}/state`, JEV_COMPACT_WINDOW: "600000", ...(LIVE ? {} : { JEV_BACKEND: "mock" }) };
delete env.NODE_TEST_CONTEXT;

const run = (args: string[], input?: string) => execFileSync(BIN, [...args, "--cwd", SANDBOX], { env, input, encoding: "utf8" });
const json = (args: string[], input?: string) => JSON.parse(run(args, input));
const stderrOf = (args: string[]) => { try { run(args); return ""; } catch (e: any) { return String(e.stderr); } };

const KIND = JSON.stringify({ kind: { type: "choice", instructions: "What kind of failure is `output`?", criteria: { bug_in_code: "The code under test is wrong", wrong_test: "The test expects the wrong thing", environment: "Missing deps, config, network", other: "None of these, or no failure" } } });
const MONEY = JSON.stringify({ money: { type: "noul", instructions: "Does `content` compute money amounts?" } });

test("ask runs the command in code and returns only the answer", () => {
  const r = json(["ask", "-q", KIND, "-c", "npm test"]);
  assert.ok(r.answers.kind.choice, "a declared option comes back");
  assert.match(r.state_summary.output, /^npm test, exit 1/);
  if (LIVE) assert.equal(r.answers.kind.choice, "bug_in_code");
});

test("ask runs any command without a gate: one Jev call, the command really ran", () => {
  const ledger = () => { try { return readFileSync(`${tmp}/state/ledger.jsonl`, "utf8").trim().split("\n").length; } catch { return 0; } };
  const before = ledger();
  const marker = `${tmp}/ran-${Date.now()}`;
  const r = json(["ask", "-q", MONEY, "-c", `touch ${marker} && rm -f ${marker}.none && echo done`]);
  assert.match(r.state_summary.output, /exit 0/);
  assert.ok(statSync(marker).isFile(), "the command ran");
  assert.equal(ledger() - before, 1, "no gate call before the answer");
});

test("files judges every file in parallel, questions from stdin", () => {
  const r = json(["files", "-q", "-", "src/**/*.ts"], MONEY);
  assert.ok(r.calls >= 9 && r.results.every((x: any) => typeof x.answers.money.noul === "number"));
  if (LIVE) {
    const by = Object.fromEntries(r.results.map((x: any) => [x.path, x.answers.money.noul]));
    assert.ok(by["src/domain/billing.ts"] > 0.5 && by["src/auth/jwt.ts"] < 0.5, JSON.stringify(by));
  }
});

test("bad input fails with a message, not a call", () => {
  assert.match(stderrOf(["ask", "-q", "{not json"]), /not valid JSON/);
  assert.match(stderrOf(["ask", "-q", MONEY]), /nothing to judge/);
  assert.match(stderrOf(["nope", "-q", MONEY]), /unknown command/);
});

function transcript(name: string, prompts: string[], tokens: number) {
  const path = `${tmp}/${name}.jsonl`;
  const lines = prompts.flatMap((p) => [
    { type: "user", message: { role: "user", content: p } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Edit" }], usage: { input_tokens: 2, cache_read_input_tokens: tokens - 1002, cache_creation_input_tokens: 1000 } } },
  ]);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return path;
}
const hook = (path: string, last: string) =>
  run(["compact", "--hook", "claude-code"], JSON.stringify({ session_id: "t", transcript_path: path, stop_hook_active: false, last_assistant_message: last })).trim();

test("compact stays silent and makes no call below the notice line", () => {
  const path = transcript("below", ["Fix the proration test", "Now write the blackjack README"], 50_000);
  assert.equal(hook(path, "Done."), "");
  const v = json(["compact", "--transcript", path]);
  assert.deepEqual([v.tier, v.reason, v.lines.notice], ["silent", "below the notice line", 100_000]);
});

test("compact recommends compacting on a task switch, not mid task", () => {
  const switched = hook(transcript("switched", ["Fix the failing proration test in src/domain/billing.ts so npm test passes.", "Now write a README for the unrelated blackjack simulator project in ~/Projects/Blackjack."], 250_000), "README written to Blackjack/README.md and committed.");
  const same = hook(transcript("same", ["Fix the failing proration test in src/domain/billing.ts so npm test passes.", "Also handle the zero-day edge case in the same proration function."], 250_000), "Edited billing.ts; next I update the two tests that cover zero-day proration.");
  for (const out of [switched, same]) if (out) assert.ok(JSON.parse(out).systemMessage.startsWith("jev: "));
  if (LIVE) {
    assert.match(JSON.parse(switched).systemMessage, /^jev: compacting recommended\. 250k tokens.*\n\/compact The live work starts at "Now write a README/s);
    assert.equal(same, "");
  }
});

test("setup stores the key with mode 600 and picks the provider from its prefix", () => {
  const config = `${tmp}/config/env`;
  const setup = (key: string) => execFileSync(BIN, ["setup"], { env: { ...env, JEV_CONFIG: config }, input: key + "\n", encoding: "utf8" });
  setup("apikey_test");
  assert.equal(readFileSync(config, "utf8"), "TYPESAFE_API_KEY=apikey_test\n");
  assert.equal(statSync(config).mode & 0o777, 0o600);
  setup("sk-or-test");
  assert.equal(readFileSync(config, "utf8"), "OPENROUTER_API_KEY=sk-or-test\n");
});

test("every call lands in the ledger, without the state", () => {
  const lines = readFileSync(`${tmp}/state/ledger.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.length > 0 && lines.every((l) => l.questions && l.answers && !("state" in l)));
});
