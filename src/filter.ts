/**
 * Keep the search results that answer the query. Exa's web search returns about ten results, each with its
 * highlights, joined by "\n\n---\n\n" and opening with "Title: ". Jev scores every result against the query in
 * parallel. Every result at or above the line stays whole; the others shrink to their title and URL, so a fetch can
 * still bring one back. When nothing falls under the line, the output is left as it is. Any other text too.
 */
import type { Ask } from "./compact.ts";

export const SEPARATOR = "\n\n---\n\n";
/**
 * At or above this a result stays whole. Cutting a relevant result costs more than keeping an off-topic one, so the line
 * keeps every relevant dev case of `npm run bench` (keep_all_line, 0.11 for Jev, rounded down); on its test cases it kept
 * 8 of 8 relevant results and cut 7 of 8 off-topic ones. JEV_FILTER_LINE sets another backend's.
 */
export const DEFAULT_FILTER_LINE = 0.1;
export const FILTER_LINE = Number(process.env.JEV_FILTER_LINE) || DEFAULT_FILTER_LINE;

export const RELEVANT = {
  relevant: {
    type: "noul",
    instructions: "Does the search result in `result` help answer the query in `query`?",
    criteria: {
      true: "It holds information the query asks for",
      false: "It is off topic, or only repeats the query's words",
    },
  },
} as const;

export interface Filtered { text: string; kept: number; total: number; scores: number[] }

/** null when the text is not a list of results, or when every result is relevant, so there is nothing to cut. */
export async function filterResults(query: string, text: string, ask: Ask, line = FILTER_LINE): Promise<Filtered | null> {
  const blocks = text.split(SEPARATOR);
  if (blocks.length < 2 || !blocks.every((b) => b.startsWith("Title: "))) return null;
  const scores = await Promise.all(blocks.map(async (result) => (await ask({ query, result }, RELEVANT)).relevant.noul as number));
  const order = blocks.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  // The best result always stays whole, even under the line: shrinking everything would leave the agent nothing to read.
  const kept = Math.max(1, order.filter((i) => scores[i] >= line).length);
  if (kept === blocks.length) return null;
  const titleAndUrl = (b: string) => b.split("\n").slice(0, 2).map((l) => l.replace(/^(Title|URL): /, "")).join(" ");
  const rest = order.slice(kept).map((i) => `- ${titleAndUrl(blocks[i])} (${scores[i].toFixed(2)})`);
  return {
    text: `${order.slice(0, kept).map((i) => blocks[i]).join(SEPARATOR)}${SEPARATOR}` +
      `jev kept the ${kept} of ${blocks.length} results relevant to the query, best first. The others, off topic, by score:\n${rest.join("\n")}`,
    kept,
    total: blocks.length,
    scores: order.map((i) => scores[i]),
  };
}
