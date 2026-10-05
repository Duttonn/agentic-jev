/**
 * Keep the search results that answer the query. Exa's web search returns about ten results, each with its
 * highlights, joined by "\n\n---\n\n" and opening with "Title: ". Jev scores every result against the query in
 * parallel. The best K stay whole, unless they score under FLOOR; the others shrink to their title and URL, so a fetch
 * can still bring one back.
 * Any other text is left as it is.
 */
import type { Ask } from "./compact.ts";

export const SEPARATOR = "\n\n---\n\n";
export const KEEP = 5;
/** Below this a result is off topic, even inside the top K. */
export const FLOOR = 0.05;

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

/** null when the text is not a list of more than `keep` results, so there is nothing to cut. */
export async function filterResults(query: string, text: string, ask: Ask, keep = KEEP): Promise<Filtered | null> {
  const blocks = text.split(SEPARATOR);
  if (blocks.length <= keep || !blocks.every((b) => b.startsWith("Title: "))) return null;
  const scores = await Promise.all(blocks.map(async (result) => (await ask({ query, result }, RELEVANT)).relevant.noul as number));
  const order = blocks.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const kept = Math.max(1, order.slice(0, keep).filter((i) => scores[i] >= FLOOR).length);
  const titleAndUrl = (b: string) => b.split("\n").slice(0, 2).map((l) => l.replace(/^(Title|URL): /, "")).join(" ");
  const rest = order.slice(kept).map((i) => `- ${titleAndUrl(blocks[i])} (${scores[i].toFixed(2)})`);
  return {
    text: `${order.slice(0, kept).map((i) => blocks[i]).join(SEPARATOR)}${SEPARATOR}` +
      `jev kept the ${kept} of ${blocks.length} results most relevant to the query, best first. The others, by relevance:\n${rest.join("\n")}`,
    kept,
    total: blocks.length,
    scores: order.map((i) => scores[i]),
  };
}
