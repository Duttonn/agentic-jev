/**
 * jev: typed decisions for coding agents, from any shell. Levels 7, 8, 9 and 10 of disler/ten-levels-of-jev as one CLI.
 *
 *   jev ask     -q QUESTIONS [-s STATE] [-p PATH]... [-c COMMAND] [--cwd DIR]   one situation, one call
 *   jev files   -q QUESTIONS [-r] [--cwd DIR] PATH_OR_GLOB...                    the same questions of many files
 *   jev watch   -c COMMAND -q QUESTIONS [--every SECONDS] [--until]              poll, print only when the answer changes
 *   jev compact --transcript FILE | --hook claude-code                          should this session compact now?
 *   jev setup                                                                    store the API key (handled by bin/jev)
 *   jev install                                                                  install from a clone or npx (handled by bin/jev)
 *
 * Answers print as JSON. Every Jev call appends question ids, answers and usage (never the state) to
 * $JEV_STATE_DIR/ledger.jsonl, default ~/.local/state/jev.
 */
import { exec } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { jev } from "./core/client.ts";
import { askFiles } from "./levels/level09/index.ts";
import {
  ASK_JEV_DESCRIPTION, AskStateError, assembleState, emptyLedger, parseQuestions, record, summarize, type CommandOutput,
} from "./levels/level10/index.ts";
import { shouldCompact } from "./compact.ts";

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 200_000;
const STATE_DIR = process.env.JEV_STATE_DIR || join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "jev");

const USAGE = `jev ask     -q QUESTIONS [-s STATE] [-p PATH]... [-c COMMAND] [--cwd DIR]
jev files   -q QUESTIONS [-r] [--cwd DIR] PATH_OR_GLOB...
jev watch   -c COMMAND -q QUESTIONS [-s STATE] [-p PATH]... [--every SECONDS] [--until] [--cwd DIR]
jev compact --transcript FILE | --hook claude-code
jev setup
jev install
QUESTIONS: JSON, or - to read it from stdin.
Output: one line of JSON with two-decimal answers. --full adds the type tags, every option's probability, usage and model.

ask:${ASK_JEV_DESCRIPTION.replace("For many files judged separately use ask_jev_files instead.", "For many files judged separately use `jev files`.")}

files: the same questions of many files, one call per file in parallel. Globs and directories expand in code; node_modules,
.git, binaries and oversize files are dropped; 255 max. Write questions against \`content\` (the file's text); \`path\` is in the state.

watch: runs the command every --every seconds (default 30), asks the questions about \`output\`, and prints a line only
when an answer changes: a noul crossing 0.5, another choice, another score level. The first answer always prints.
--until stops once the first question, which must be a noul, reads yes. Run it in the background instead of polling.

compact: reads a Claude Code transcript and says whether to compact now, with a ready /compact line. --hook claude-code reads
a Stop hook payload on stdin and prints a systemMessage only when compacting is worth it.

setup: prompts for a TypeSafe (apikey_...) or OpenRouter (sk-or-...) key and stores it in ~/.config/jev/env, mode 600.

install: copies jev to ~/.local/share/jev, links it into ~/.local/bin and its skill into ~/.agents/skills, and runs
setup when no key is set. Works from a clone (bin/jev install) or from npx (npx github:Duttonn/agentic-jev install).`;

const { values: o, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    questions: { type: "string", short: "q" },
    state: { type: "string", short: "s" },
    path: { type: "string", short: "p", multiple: true },
    command: { type: "string", short: "c" },
    recursive: { type: "boolean", short: "r" },
    cwd: { type: "string" },
    transcript: { type: "string" },
    hook: { type: "string" },
    full: { type: "boolean" },
    every: { type: "string" },
    until: { type: "boolean" },
    help: { type: "boolean", short: "h" },
  },
});
const [mode, ...targets] = positionals;
if (o.help || !mode || (mode !== "compact" && !o.questions)) { console.log(USAGE); process.exit(o.help ? 0 : 2); }

const cwd = resolve(o.cwd ?? process.cwd());
let ledger = emptyLedger();

function append(file: string, line: string) {
  try { mkdirSync(STATE_DIR, { recursive: true }); appendFileSync(join(STATE_DIR, file), line + "\n"); } catch { /* the ledger is optional */ }
}

/** One Jev call, counted. The ledger keeps question ids and answers, never the state. */
async function decide(tool: string, state: any, questions: any) {
  const result = await jev.systemOne(state, questions);
  ledger = record(ledger, result.usage as any, Object.keys(result.answers).length);
  const answers = JSON.stringify(result.answers, (k, v) => (k === "probabilities" ? undefined : v));
  append("ledger.jsonl", `{"at":"${new Date().toISOString()}","tool":"${tool}","cwd":${JSON.stringify(cwd)},"questions":${JSON.stringify(Object.keys(questions))},"answers":${answers},"usage":${JSON.stringify(result.usage)}}`);
  return result;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** What the agent reads, about a sixth of --full: no type tags, no per-option probabilities, two decimals. */
function slim(answers: Record<string, any>) {
  const out: Record<string, unknown> = {};
  for (const [id, a] of Object.entries(answers)) {
    out[id] = a.type === "noul" ? { noul: r2(a.noul) }
      : a.type === "choice" ? { choice: a.choice, confidence: r2(a.confidence) }
      : { score: r2(a.score), confidence: r2(a.confidence), legend: a.legend };
  }
  return out;
}

const print = (value: unknown) => console.log(o.full ? JSON.stringify(value, null, 1) : JSON.stringify(value));
/** Drop empty fields from the summary of what was sent. */
const compactSummary = (s: Record<string, any>) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== null && !(Array.isArray(v) && !v.length)));

/** Run a command for the state. The output is captured, never printed. */
function runCommand(command: string, dir: string): Promise<CommandOutput> {
  return new Promise((res) => {
    exec(command, { cwd: dir, timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_CHARS * 4, env: { ...process.env, CI: "1" } }, (err, stdout, stderr) => {
      const code = err && typeof (err as any).code === "number" ? (err as any).code : err ? null : 0;
      res({ command, exit_code: code, stdout: String(stdout).slice(0, MAX_OUTPUT_CHARS), stderr: String(stderr).slice(0, MAX_OUTPUT_CHARS) });
    });
  });
}

/** What counts as a change: a noul's side of 0.5, a choice, a score's level. Confidence drift is not a change. */
const verdictOf = (answers: Record<string, any>) =>
  JSON.stringify(Object.values(answers).map((a) => (a.type === "noul" ? a.noul >= 0.5 : a.type === "choice" ? a.choice : a.legend)));

/** Poll a command and print only the answers that changed, so a background watcher costs the agent nothing until it does. */
async function watch() {
  if (!o.command) throw new Error("watch needs -c COMMAND");
  const questions = parseQuestions(o.questions === "-" ? readFileSync(0, "utf8") : o.questions!);
  const first = Object.values(questions)[0] as any;
  if (o.until && first.type !== "noul") throw new Error("--until needs a noul as the first question");
  const every = Number(o.every ?? 30);
  if (!(every > 0)) throw new Error("--every needs a number of seconds above 0");
  let last = "";
  for (;;) {
    const { state } = await assembleState({ state: o.state, paths: o.path, command: o.command }, cwd, runCommand);
    const { answers } = await decide("watch", state, questions);
    const verdict = verdictOf(answers);
    if (verdict !== last) print({ at: new Date().toISOString(), answers: o.full ? answers : slim(answers) });
    last = verdict;
    if (o.until && (Object.values(answers)[0] as any).noul >= 0.5) return;
    await new Promise((r) => setTimeout(r, every * 1000));
  }
}

async function compact() {
  const ask = async (s: unknown, q: any) => (await decide("compact", s, q)).answers as Record<string, any>;
  if (o.hook !== undefined) {
    // A hook must never get in a turn's way: any failure is logged and the hook stays silent.
    try {
      if (o.hook !== "claude-code") throw new Error(`unknown hook "${o.hook}"; supported: claude-code`);
      const input = JSON.parse(readFileSync(0, "utf8"));
      if (input.stop_hook_active || !input.transcript_path) return;
      const v = await shouldCompact(input.transcript_path, input.last_assistant_message ?? "", ask);
      append("compact.log", `${new Date().toISOString()} ${input.session_id} ${Math.round(v.tokens / 1000)}k ${v.tier}: ${v.reason}`);
      if (v.message) console.log(JSON.stringify({ systemMessage: v.message }));
    } catch (err: any) {
      append("compact.log", `${new Date().toISOString()} error: ${err?.message ?? err}`);
    }
    return;
  }
  if (!o.transcript) throw new Error("compact needs --transcript FILE or --hook claude-code");
  const v = await shouldCompact(resolve(cwd, o.transcript), "", ask);
  print(o.full || !v.answers ? v : { ...v, answers: slim(v.answers) });
}

try {
  if (mode === "ask") {
    const questions = parseQuestions(o.questions === "-" ? readFileSync(0, "utf8") : o.questions!);
    // No gate on the command: jev runs as the calling agent's own shell, under that agent's permissions.
    const { state, summary } = await assembleState({ state: o.state, paths: o.path, command: o.command }, cwd, runCommand);
    const result = await decide("ask", state, questions);
    print(o.full
      ? { answers: result.answers, state_summary: summary, model: result.model, usage: result.usage, cost: summarize(ledger, 0) }
      : { answers: slim(result.answers), state_summary: compactSummary(summary), cost: summarize(ledger, 0) });
  } else if (mode === "files") {
    if (!targets.length) throw new Error("files needs at least one path or glob");
    const questionsJson = o.questions === "-" ? readFileSync(0, "utf8") : o.questions!;
    const result = await askFiles(targets, questionsJson, cwd, { recursive: o.recursive ?? false, decide: (s, q) => decide("files", s, q) });
    print(o.full
      ? { ...result, cost: summarize(ledger, 0) }
      : { results: Object.fromEntries(result.results.map((r) => [r.path, slim(r.answers)])), ...(result.skipped.length ? { skipped: result.skipped } : {}), calls: result.calls, cost: summarize(ledger, 0) });
  } else if (mode === "watch") {
    await watch();
  } else if (mode === "compact") {
    await compact();
  } else {
    throw new Error(`unknown command "${mode}"; use ask, files, watch, compact or setup`);
  }
} catch (err: any) {
  console.error(err instanceof AskStateError ? err.message : `jev ${mode}: ${err?.message ?? err}`);
  process.exit(1);
}
