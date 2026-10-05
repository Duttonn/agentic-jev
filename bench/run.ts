/**
 * The criteria bench: jev's fixed questions against hand-labelled, general cases, on whatever backend JEV_BACKEND selects.
 *
 *   npm run bench -- [--name NAME]                       every family; results also go to bench/results/NAME.json
 *   npm run bench -- --agree DIR [--n 60]                validation: real prompts from Claude Code transcripts under DIR,
 *                                                        labelled by Jev (the teacher), against this backend
 *
 * Cases are split in two: `dev` picks a backend's line, `test` reports how that line holds on cases it never saw.
 * They are written for no one in particular, so a line tuned here is not tuned to one user. Transcripts only ever
 * validate; nothing is tuned on them, and no prompt text is printed.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { JevClient } from "../src/core/client.ts";
import { DEFAULT_RESEARCH_LINE, RESEARCH_LINE, RESEARCH_QUESTIONS } from "../src/research.ts";
import { RELEVANT } from "../src/filter.ts";
import { isFollowUp } from "../src/compact.ts";
import { accuracy, auc, bestLine } from "./metrics.ts";

const { values: o } = parseArgs({ options: { name: { type: "string" }, agree: { type: "string" }, n: { type: "string" } } });
const HERE = new URL(".", import.meta.url).pathname;
/** The backend under test. A local server answers one request at a time, so it gets more time and BENCH_CONCURRENCY=1. */
const jev = new JevClient({ timeoutMs: 120_000 });
const CONCURRENCY = Number(process.env.BENCH_CONCURRENCY) || 4;
const load = (family: string) => readFileSync(join(HERE, "cases", `${family}.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));

/** The triage question the skill tells agents to ask when a build or test fails. */
const TRIAGE = {
  kind: {
    type: "choice",
    instructions: "What kind of failure does `output` show?",
    criteria: {
      bug_in_code: "The code under test is wrong",
      wrong_test: "The test expects the wrong thing",
      environment: "Missing dependency, tool, service, config or network",
      flaky: "Timing or ordering: the same code sometimes passes",
      other: "No failure, or none of these",
    },
  },
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? NaN;

/** Run calls CONCURRENCY at a time; returns answers and the time each call took. */
async function askAll(client: JevClient, items: { state: unknown; questions: any }[]) {
  const out: { answers: Record<string, any>; ms: number }[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < items.length) {
      const i = next++;
      const t = performance.now();
      const r = await client.systemOne(items[i].state as any, items[i].questions);
      out[i] = { answers: r.answers, ms: performance.now() - t };
    }
  }));
  return out;
}

function keepAll(devS: number[], devL: boolean[], testS: number[], testL: boolean[]) {
  const line = Math.floor(Math.min(...devS.filter((_, i) => devL[i])) * 100) / 100;
  const kept = testS.filter((x, i) => testL[i] && x >= line).length, relevant = testL.filter(Boolean).length;
  const cut = testS.filter((x, i) => !testL[i] && x < line).length, off = testL.length - relevant;
  return { keep_all_line: line, test_relevant_kept: `${kept}/${relevant}`, test_off_topic_cut: `${cut}/${off}` };
}

/** AUC on every case; the line picked on dev; accuracy on test at 0.5, at the code's line, and at the dev line. */
function noulReport(cases: any[], scores: number[], labels: boolean[], codeLine?: number) {
  const pick = (split: string) => cases.map((c, i) => (c.split === split ? i : -1)).filter((i) => i >= 0);
  const [dev, test] = [pick("dev"), pick("test")];
  const s = (ix: number[]) => ix.map((i) => scores[i]), l = (ix: number[]) => ix.map((i) => labels[i]);
  const line = bestLine(s(dev), l(dev));
  return {
    auc: r2(auc(scores, labels)),
    test_at_0_5: r2(accuracy(s(test), l(test), 0.5)),
    ...(codeLine !== undefined ? { test_at_code_line: r2(accuracy(s(test), l(test), codeLine)), code_line: codeLine } : {}),
    dev_line: line,
    test_at_dev_line: r2(accuracy(s(test), l(test), line)),
    // For a filter, cutting a relevant item costs more than keeping an off-topic one: the highest line that keeps every
    // relevant dev case, and on test how many relevant cases it keeps and how many off-topic ones it cuts.
    ...keepAll(s(dev), l(dev), s(test), l(test)),
    yes_range: [r2(Math.min(...scores.filter((_, i) => labels[i]))), r2(Math.max(...scores.filter((_, i) => labels[i])))],
    no_range: [r2(Math.min(...scores.filter((_, i) => !labels[i]))), r2(Math.max(...scores.filter((_, i) => !labels[i])))],
  };
}

async function bench() {
  const research = load("research"), filter = load("filter"), triage = load("triage");
  const [ra, fa, ta] = await Promise.all([
    askAll(jev, research.map((c) => ({ state: { task: c.task }, questions: RESEARCH_QUESTIONS }))),
    askAll(jev, filter.map((c) => ({ state: { query: c.query, result: c.result }, questions: RELEVANT }))),
    askAll(jev, triage.map((c) => ({ state: { output: c.output }, questions: TRIAGE }))),
  ]);
  const needed = research.map((c, i) => [c, ra[i].answers.kind.choice] as const).filter(([c]) => c.need);
  const report = {
    backend: jev.provider,
    url: jev.provider === "laya" ? process.env.LAYA_URL : undefined,
    at: new Date().toISOString(),
    research_need: noulReport(research, ra.map((a) => a.answers.need.noul), research.map((c) => c.need), RESEARCH_LINE),
    research_kind: { accuracy: r2(needed.filter(([c, k]) => c.kind === k).length / needed.length), cases: needed.length },
    filter_relevant: noulReport(filter, fa.map((a) => a.answers.relevant.noul), filter.map((c) => c.relevant)),
    triage_kind: { accuracy: r2(triage.filter((c, i) => ta[i].answers.kind.choice === c.label).length / triage.length), cases: triage.length },
    median_ms: Math.round(median([...ra, ...fa, ...ta].map((a) => a.ms))),
    calls: ra.length + fa.length + ta.length,
  };
  console.log(JSON.stringify(report, null, 1));
  if (o.name) {
    mkdirSync(join(HERE, "results"), { recursive: true });
    writeFileSync(join(HERE, "results", `${o.name}.json`), JSON.stringify(report, null, 1) + "\n");
  }
}

const SECRETS = /\b(apikey_[A-Za-z0-9_]{16,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g;
const NOISE = /^(<command-|<local-command|<system-reminder>|<task-notification|Caveat:|\[Request interrupted|This session is being continued)/;

/** Typed requests from Claude Code transcripts: no slash commands, no short follow-ups, secrets masked. */
function prompts(dir: string): string[] {
  const files: string[] = [];
  const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith(".jsonl")) files.push(p); } };
  walk(dir);
  const seen = new Set<string>();
  for (const f of files) for (const line of readFileSync(f, "utf8").split("\n")) {
    let e: any; try { e = JSON.parse(line); } catch { continue; }
    const c = e?.type === "user" && !e.isMeta && e.message?.content;
    const text = typeof c === "string" ? c.trim() : "";
    if (text.length < 15 || text.length > 4000 || NOISE.test(text) || text.startsWith("/") || isFollowUp(text)) continue;
    seen.add(text.replace(SECRETS, "[secret]"));
  }
  return [...seen];
}

async function agree(dir: string, n: number) {
  if (jev.provider === "typesafe") throw new Error("--agree compares another backend with Jev: set JEV_BACKEND to it");
  const teacher = new JevClient({ provider: "typesafe" });
  const hash = (s: string) => createHash("sha1").update(s).digest("hex");
  const sample = prompts(dir).sort((a, b) => (hash(a) < hash(b) ? -1 : 1)).slice(0, n);
  const items = sample.map((task) => ({ state: { task }, questions: RESEARCH_QUESTIONS }));
  const [t, s] = await Promise.all([askAll(teacher, items), askAll(jev, items)]);
  const labels = t.map((a) => a.answers.need.noul >= DEFAULT_RESEARCH_LINE && a.answers.kind.choice !== "nothing");
  const scores = s.map((a) => a.answers.need.noul);
  const line = RESEARCH_LINE;
  console.log(JSON.stringify({
    backend: jev.provider, prompts: sample.length, teacher_yes: labels.filter(Boolean).length,
    auc_vs_teacher: r2(auc(scores, labels)), agreement_at_line: r2(accuracy(scores, labels, line)), line,
    best_line_here_for_reference_only: bestLine(scores, labels),
  }, null, 1));
}

await (o.agree ? agree(o.agree, Number(o.n) || 60) : bench());
