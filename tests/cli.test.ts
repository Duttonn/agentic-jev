/**
 * bin/jev end to end: ask with a command, no gate, files over a glob, stdin questions, watch, bad input, compact, setup.
 * Offline on the mock by default. JEV_LIVE=1 runs the same calls against real Jev and checks the answers.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import test from "node:test";

const BIN = fileURLToPath(new URL("../bin/jev", import.meta.url));
const SANDBOX = fileURLToPath(new URL("./fixtures/sandbox/", import.meta.url));
const FAKE_LAYA = fileURLToPath(new URL("./fixtures/fake-laya-serve.mjs", import.meta.url));
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
  assert.ok(r.calls >= 9 && Object.values(r.results).every((a: any) => typeof a.money.noul === "number"));
  if (LIVE) assert.ok(r.results["src/domain/billing.ts"].money.noul > 0.5 && r.results["src/auth/jwt.ts"].money.noul < 0.5, JSON.stringify(r.results));
});

test("files --top K judges every file and keeps the K best, best first", () => {
  const r = json(["files", "-q", MONEY, "src/**/*.ts", "--top", "3"]);
  const scores = Object.values(r.results).map((a: any) => a.money.noul);
  assert.ok(r.calls >= 9 && scores.length === 3);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
  if (LIVE) assert.ok(scores.every((s) => s > 0.5) && !("src/auth/jwt.ts" in r.results), JSON.stringify(r.results));
  assert.match(stderrOf(["files", "-q", KIND, "src/**/*.ts", "--top", "3"]), /must be a noul or a score/);
  assert.match(stderrOf(["files", "-q", MONEY, "src/**/*.ts", "--top", "0"]), /whole number above 0/);
});

test("output is one compact line by default, --full keeps types, probabilities and usage", () => {
  const out = run(["files", "-q", KIND, "src/**/*.ts"]);
  const full = run(["files", "-q", KIND, "src/**/*.ts", "--full"]);
  assert.equal(out.trim().split("\n").length, 1);
  assert.ok(!/"probabilities"|"type"/.test(out) && /"probabilities"/.test(full) && /"usage"/.test(full));
  assert.ok(out.length < full.length / 3, `${out.length} vs ${full.length}`);
  const a = json(["ask", "-q", KIND, "-s", "TypeError: cannot read properties of undefined"]).answers.kind;
  assert.deepEqual(Object.keys(a), ["choice", "confidence"]);
  assert.equal(a.confidence, Math.round(a.confidence * 100) / 100);
});

test("watch prints only when the answer changes, and --until stops on yes", () => {
  const DONE = JSON.stringify({ done: { type: "noul", instructions: "Does `output` say the deploy finished?" } });
  const marker = `${tmp}/deploy-${Date.now()}`;
  const lines = run(["watch", "-q", DONE, "-c", `test -f ${marker} && echo deploy finished || echo deploy still running; touch ${marker}`, "--every", "0.2", "--until"])
    .trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.at(-1).answers.done.noul >= 0.5);
  if (LIVE) assert.deepEqual(lines.map((l) => l.answers.done.noul >= 0.5), [false, true]);
  let quiet = "";
  try { execFileSync(BIN, ["watch", "-q", DONE, "-c", "echo deploy still running", "--every", "0.1", "--cwd", SANDBOX], { env, encoding: "utf8", timeout: 1500 }); } catch (e: any) { quiet = String(e.stdout); }
  assert.equal(quiet.trim().split("\n").length, 1, "one line, however many polls");
  assert.match(stderrOf(["watch", "-q", KIND, "-c", "true", "--until"]), /--until needs a noul/);
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

test("compact stays silent and makes no call on a short follow-up", async () => {
  const { isFollowUp } = await import("../src/compact.ts");
  for (const s of ["ok go O4", "continue", "fais O1 et O2", "vas-y", "yes, do A2"]) assert.ok(isFollowUp(s), s);
  for (const s of ["stop les bots, relance les automatiquement a 12h", "Now write a README for the blackjack project", "continue, aussi pourquoi le retrait automatique ne s'est pas active a 23h ?"]) assert.ok(!isFollowUp(s), s);
  const path = transcript("followup", ["Fix the failing proration test in src/domain/billing.ts so npm test passes.", "ok go O4"], 250_000);
  const v = json(["compact", "--transcript", path]);
  assert.deepEqual([v.tier, v.reason], ["silent", "short follow-up to the last turn"]);
});

test("research says when a task needs a lookup first, and its hook only speaks on a yes", () => {
  const ledger = () => readFileSync(`${tmp}/state/ledger.jsonl`, "utf8").trim().split("\n").length;
  const prompt = (p: string) => run(["research", "--hook", "claude-code"], JSON.stringify({ session_id: "t", hook_event_name: "UserPromptSubmit", prompt: p })).trim();
  const before = ledger();
  assert.equal(prompt("ok go O4") + prompt("/compact"), "", "follow-ups and slash commands pass through");
  assert.equal(ledger(), before, "and cost no call");
  const yes = json(["research", "-s", "Upgrade the project to the latest Expo SDK and fix whatever breaks"]);
  assert.ok(typeof yes.answers.need.noul === "number" && "hint" in yes);
  const hooked = prompt("Use the Stripe API to add subscription proration to checkout");
  if (hooked) assert.match(JSON.parse(hooked).hookSpecificOutput.additionalContext, /^jev: /);
  if (LIVE) {
    assert.match(yes.hint, /current, dated sources/);
    assert.equal(JSON.parse(hooked).hookSpecificOutput.hookEventName, "UserPromptSubmit");
    for (const s of ["Rename the variable tmp to buffer in src/parser.ts", "Add a link to https://example.com in the footer of index.html"]) assert.equal(json(["research", "-s", s]).hint, null, s);
    const tools = execFileSync(BIN, ["research", "-s", "Summarize https://github.com/disler/ten-levels-of-jev"], { env: { ...env, JEV_RESEARCH_TOOLS: "web_search" }, encoding: "utf8" });
    assert.match(JSON.parse(tools).hint, /preferred: web_search\).*the link the user gave/);
  }
});

test("setup stores a key with mode 600, picks the provider from its prefix, and keeps the other settings", () => {
  const config = `${tmp}/config/env`;
  const setup = (input: string) => execFileSync(BIN, ["setup"], { env: { ...env, JEV_CONFIG: config }, input, encoding: "utf8" });
  setup("apikey_test\n");
  assert.equal(readFileSync(config, "utf8"), "TYPESAFE_API_KEY=apikey_test\nJEV_BACKEND=typesafe\n");
  assert.equal(statSync(config).mode & 0o777, 0o600);
  setup("1\nsk-or-test\n");
  assert.equal(readFileSync(config, "utf8"), "TYPESAFE_API_KEY=apikey_test\nOPENROUTER_API_KEY=sk-or-test\nJEV_BACKEND=openrouter\n");
  assert.match(String((() => { try { setup("9\n"); } catch (e: any) { return e.stderr; } })()), /unknown choice/);
});

const fakeLaya = (port: number, extra: NodeJS.ProcessEnv = {}) => {
  const child = spawn(process.execPath, [FAKE_LAYA], { env: { ...process.env, LAYA_PORT: String(port), ...extra }, stdio: "ignore" });
  return { stop: () => child.kill() };
};
const waitFor = async (check: () => boolean, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (check()) return true;
  return false;
};
const port = () => 20000 + Math.floor(Math.random() * 20000);

test("laya backend speaks the Jev wire, asks for the full 8192-token window, and sends a key only when set", async () => {
  const p = port();
  const server = fakeLaya(p, { LAYA_API_KEY: "team-key" });
  const lenv = { ...env, JEV_BACKEND: "laya", LAYA_URL: `http://127.0.0.1:${p}` };
  const ask = (e: NodeJS.ProcessEnv, extra: string[] = []) => execFileSync(BIN, ["ask", "-s", "hello", "-q", MONEY, "--cwd", SANDBOX, ...extra], { env: e, encoding: "utf8" });
  try {
    await waitFor(() => { try { ask({ ...lenv, LAYA_API_KEY: "team-key" }); return true; } catch { return false; } });
    const full = JSON.parse(ask({ ...lenv, LAYA_API_KEY: "team-key" }, ["--full"]));
    assert.equal(full.answers.money.noul, 0.9);
    assert.equal(full.usage.max_len_seen, 8192);
    assert.match(full.cost, /\$0\.000000/);
    assert.throws(() => ask(lenv), /laya HTTP 401/);
  } finally { server.stop(); }
  assert.throws(() => ask(lenv), /Laya is not reachable at http:\/\/127\.0\.0\.1/);
});

test("local laya starts on an agent's first call and stops once no agent is left", async () => {
  const p = port();
  const state = `${tmp}/laya-life`;
  const lenv = { ...env, JEV_BACKEND: "laya", JEV_LAYA_LOCAL: "1", JEV_LAYA_SERVE: FAKE_LAYA, LAYA_URL: `http://127.0.0.1:${p}`, JEV_STATE_DIR: state, JEV_LAYA_LINGER_MS: "500", JEV_LAYA_CHECK_MS: "200" };
  const status = () => JSON.parse(execFileSync(BIN, ["laya", "status"], { env: lenv, encoding: "utf8" }));
  assert.equal(execFileSync(BIN, ["laya", "start", "--hook", "claude-code"], { env: { ...lenv, JEV_LAYA_LOCAL: "0" }, encoding: "utf8" }), "", "silent, and nothing starts for other backends");
  assert.equal(status().supervisor, null);
  // A short-lived agent: this node process runs jev, then exits.
  const agent = `require("child_process").execFileSync(${JSON.stringify(BIN)}, ["ask", "-s", "hello", "-q", ${JSON.stringify(MONEY)}], { stdio: "inherit" })`;
  const out = execFileSync(process.execPath, ["-e", agent], { env: lenv, encoding: "utf8" });
  assert.equal(JSON.parse(out).answers.money.noul, 0.9, "the first call waited for the server");
  assert.ok(await waitFor(() => status().supervisor === null), "stopped after the agent exited");
  assert.equal(status().healthy, false);
});

test("install copies jev to a stable home, links the cli and the skill, and survives no key", () => {
  const home = `${tmp}/home`;
  const ienv = { ...env, HOME: home, JEV_CONFIG: `${home}/.config/jev/env` };
  delete ienv.XDG_DATA_HOME;
  const out = execFileSync(BIN, ["install"], { env: ienv, input: "", encoding: "utf8" });
  assert.match(out, /key: {3}none yet/);
  const installed = execFileSync(`${home}/.local/bin/jev`, ["--help"], { env: ienv, encoding: "utf8" });
  assert.match(installed, /^jev ask/);
  assert.ok(statSync(`${home}/.local/share/jev/src/cli.ts`).isFile() && statSync(`${home}/.agents/skills/jev/SKILL.md`).isFile());
  assert.throws(() => statSync(`${home}/.local/share/jev/tests`), "tests and fixtures are not copied");
  execFileSync(`${home}/.local/bin/jev`, ["install"], { env: ienv, input: "", encoding: "utf8" }); // running it again from the installed copy is a no-op relink
});

test("every call lands in the ledger, without the state", () => {
  const lines = readFileSync(`${tmp}/state/ledger.jsonl`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(lines.length > 0 && lines.every((l) => l.questions && l.answers && !("state" in l)));
});
