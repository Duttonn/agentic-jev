/**
 * Does this task need research outside the user's files before the agent acts? One Jev call over the request.
 *
 * A yes becomes a hint: look it up with whatever search, fetch or docs tools the agent has. jev names no tool, so
 * the hint fits any harness. JEV_RESEARCH_TOOLS, when set, adds the user's preferred tools to the hint.
 * Slash commands and short follow-ups ("ok", "do O2") are skipped in code, with no call.
 */
import { isFollowUp, type Ask } from "./compact.ts";

export const RESEARCH_QUESTIONS = {
  need: {
    type: "noul",
    instructions: "Does doing the task in `task` well depend on facts that must be looked up outside the user's own files: current versions or releases, a library's or service's docs or API, prices or availability, recent events, a third-party error message, or a page or video at a link the user gave?",
    criteria: {
      true: "Acting from memory risks stale or invented facts; a lookup should come first",
      false: "The task can be done from the user's files and general programming knowledge",
    },
  },
  kind: {
    type: "choice",
    instructions: "What should be looked up first for the task in `task`?",
    criteria: {
      link: "A page, video or file at a URL in the task",
      library_docs: "The docs or API reference of a library, framework, SDK or service",
      current_facts: "Facts that change over time: versions, releases, prices, availability, news",
      error_message: "A third-party error message or tool behaviour, best searched as written",
      nothing: "Nothing outside the user's files",
      other: "Something else",
    },
  },
} as const;

/** At or above this, the hint is given. 0.7 fits Jev; `npm run bench` gives the line for another backend. */
export const DEFAULT_RESEARCH_LINE = 0.7;
export const RESEARCH_LINE = Number(process.env.JEV_RESEARCH_LINE) || DEFAULT_RESEARCH_LINE;
// ponytail: a long paste is cut to its start, where the request usually is; split the prompt if that misses.
const MAX_TASK_CHARS = 6000;

const FIRST: Record<string, string> = {
  link: "the link the user gave",
  library_docs: "the official docs or API reference",
  current_facts: "current, dated sources",
  error_message: "the exact error message",
  other: "what the task depends on",
};

export interface ResearchVerdict {
  skipped?: string;
  answers?: Record<string, any>;
  /** What to tell the agent, or null when no lookup is needed. */
  hint?: string | null;
}

export async function needsResearch(task: string, ask: Ask): Promise<ResearchVerdict> {
  const t = task.trim();
  if (t.startsWith("/")) return { skipped: "slash command" };
  if (isFollowUp(t)) return { skipped: "short follow-up to the last turn" };
  const answers = await ask({ task: t.slice(0, MAX_TASK_CHARS) }, RESEARCH_QUESTIONS);
  const need = answers.need.noul as number;
  const kind = answers.kind.choice as string;
  if (need < RESEARCH_LINE || kind === "nothing") return { answers, hint: null };
  const tools = process.env.JEV_RESEARCH_TOOLS?.trim();
  return {
    answers,
    hint: `jev: this task likely depends on facts from outside the user's files (${kind}, ${need.toFixed(2)}). ` +
      `Before acting, look them up with the search, fetch or docs tools you have${tools ? ` (preferred: ${tools})` : ""}, ` +
      `starting with ${FIRST[kind] ?? FIRST.other}. Skip this if the conversation already holds the answer.`,
  };
}
