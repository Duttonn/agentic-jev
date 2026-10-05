/**
 * Should this session compact now? Level 7 of disler/ten-levels-of-jev over a Claude Code transcript.
 *
 * Code reads the context size from the transcript. Below the notice line nothing is asked. Above it, the four
 * Level 7 questions go to Jev in one call and code decides the tier. When a tier is earned, a second call picks
 * the turn where the live work starts, and the verdict carries a ready `/compact <instructions>` line.
 *
 * Lines are context tokens (input + cache read + cache write of the last request). With a known auto-compact
 * window W they sit at W/6, W/3 and 7W/12; without one at 100k, 200k and 350k. JEV_COMPACT_LINES overrides both.
 */
import { closeSync, fstatSync, openSync, readFileSync, readSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { COMPACT_QUESTIONS, cutPointInstructions, cutPointQuestion, decideTier, type CompactAnswers, type Lines, type Tier } from "./levels/level07/index.ts";

export type Ask = (state: unknown, questions: any) => Promise<Record<string, any>>;

export interface Verdict {
  tokens: number;
  window: number | null;
  lines: Lines;
  tier: Tier;
  reason: string;
  answers?: CompactAnswers;
  /** The `/compact ...` line to run, when a tier is earned. */
  compact?: string;
  /** What a hook shows the user, when a tier is earned. */
  message?: string;
}

const NOISE = /^(<command-|<local-command|<system-reminder>|<task-notification|<teammate-message|Caveat:|\[Request interrupted)/;
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 3) + "..." : t; };
const parse = (l: string) => { try { return JSON.parse(l); } catch { return null; } };
const textOf = (c: any): string =>
  typeof c === "string" ? c.trim() : Array.isArray(c) ? c.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("\n").trim() : "";

/** JEV_COMPACT_WINDOW, else Claude Code's autoCompactWindow setting, else unknown. */
export function compactWindow(): number | null {
  const env = Number(process.env.JEV_COMPACT_WINDOW);
  if (env > 0) return env;
  try { return JSON.parse(readFileSync(join(homedir(), ".claude/settings.json"), "utf8")).autoCompactWindow || null; } catch { return null; }
}

export function compactLines(window: number | null): Lines {
  const env = process.env.JEV_COMPACT_LINES?.split(",").map(Number);
  if (env?.length === 3 && env.every((n) => n > 0)) return { notice: env[0], recommend: env[1], request: env[2] };
  return window ? { notice: window / 6, recommend: window / 3, request: (window * 7) / 12 } : { notice: 100_000, recommend: 200_000, request: 350_000 };
}

/** The context size of the last main-thread request, read from the transcript's tail only. */
export function contextTokens(path: string): number {
  const fd = openSync(path, "r");
  const size = fstatSync(fd).size, n = Math.min(size, 2_000_000), buf = Buffer.alloc(n);
  readSync(fd, buf, 0, n, size - n);
  closeSync(fd);
  const lines = buf.toString("utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = parse(lines[i]);
    if (o?.type === "system" && o.subtype === "compact_boundary") return o.compactMetadata?.postTokens ?? 0;
    const u = o?.type === "assistant" && !o.isSidechain ? o.message?.usage : null;
    if (u) return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  }
  return 0;
}

/** The user's prompts since the last compaction, the summary it left, and the tools of the current turn. */
export function readSession(path: string) {
  let prompts: string[] = [], summary = "", tools: string[] = [];
  for (const l of readFileSync(path, "utf8").split("\n")) {
    const o = parse(l);
    if (!o || o.isSidechain) continue;
    if (o.type === "system" && o.subtype === "compact_boundary") { prompts = []; summary = ""; tools = []; continue; }
    const c = o.message?.content;
    if (o.type === "user" && o.isCompactSummary) { summary = textOf(c); continue; }
    if (o.type === "assistant" && Array.isArray(c)) for (const b of c) if (b?.type === "tool_use") tools.push(b.name);
    if (o.type !== "user" || o.isMeta) continue;
    const t = textOf(c);
    if (t && !NOISE.test(t)) { prompts.push(t); tools = []; }
  }
  return { prompts, summary, tools: [...new Set(tools)] };
}

/**
 * A go-ahead ("ok", "continue", "vas-y") or a pick from options the agent just offered ("do O2", "fais A1 et A3")
 * continues the last turn, so compacting there would cut what it points to. Code decides, no call. Limit: 60 chars.
 */
const FOLLOW_UP = /^(ok|okay|oui|yes|yep|sure|go|go on|vas[- ]?y|continue|carry on|next|do it|fais|fait|lets go|let's go)\b|\b[A-Z]\d{1,2}\b/i;
export const isFollowUp = (request: string) => request.trim().length <= 60 && FOLLOW_UP.test(request.trim());

const HEAD: Record<string, string> ={ notice: "compacting is optional", recommend: "compacting recommended", request: "compact before continuing" };

export async function shouldCompact(transcriptPath: string, lastAssistantMessage: string, ask: Ask): Promise<Verdict> {
  const tokens = contextTokens(transcriptPath);
  const window = compactWindow();
  const lines = compactLines(window);
  const quiet = (reason: string): Verdict => ({ tokens, window, lines, tier: "silent", reason });
  if (tokens < lines.notice) return quiet("below the notice line"); // numbers in code first: no call below the line
  const { prompts, summary, tools } = readSession(transcriptPath);
  if (prompts.length < 2) return quiet("first request, nothing to move on from");
  if (isFollowUp(prompts.at(-1)!)) return quiet("short follow-up to the last turn"); // "ok go O4" leans on what came before

  const usage = { tokens, pct: window ? (tokens / window) * 100 : 0 };
  const state = {
    current_request: clip(prompts.at(-1)!, 600),
    previous_work: [...prompts.slice(0, -1).slice(-30).map((p) => clip(p, 200)), summary ? `Summary so far: ${clip(summary, 400)}` : ""].filter(Boolean).join("\n"),
    recent_turn: clip(lastAssistantMessage || `(tool calls only: ${tools.join(", ") || "none"})`, 600),
    tools_this_turn: tools,
  };
  const answers = (await ask(state, COMPACT_QUESTIONS)) as CompactAnswers;
  const d = decideTier(answers, usage, true, lines, state);
  if (d.tier === "silent") return { tokens, window, lines, tier: d.tier, reason: d.reason, answers };

  // The last 200 prompts only, under Jev's 255-option cap; anything older is summarized either way.
  const turns = prompts.map((p, index) => ({ index, request: clip(p, 120) })).slice(-200);
  const cut = cutPointInstructions(turns, (await ask({ turns }, cutPointQuestion(turns))).live_from);
  const compact = `/compact ${cut.instructions}`;
  const size = `${Math.round(tokens / 1000)}k tokens` + (window ? `, ${Math.round(usage.pct)}% of the ${Math.round(window / 1000)}k auto-compact window` : "");
  return { tokens, window, lines, tier: d.tier, reason: d.reason, answers, compact, message: `jev: ${HEAD[d.tier]}. ${size}. ${d.reason}\n${compact}` };
}
