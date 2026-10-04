/**
 * Level 10, option C: the spend ledger.
 * Every ask_jev call is counted against the agent's own turn cost, so the session can say what the habit cost and what it replaced. Numbers in code: nothing here asks Jev anything.
 */

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
  cost?: number;
}

/** Jev's list price per input token when the endpoint reports no cost. Output is free. */
export const JEV_INPUT_USD_PER_M = 0.042;

export interface Ledger {
  calls: number;
  questions: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export const emptyLedger = (): Ledger => ({ calls: 0, questions: 0, inputTokens: 0, outputTokens: 0, usd: 0 });

export function record(ledger: Ledger, usage: JevUsage | undefined, questionCount: number): Ledger {
  const input = usage?.input_tokens ?? 0;
  const output = usage?.output_tokens ?? 0;
  return {
    calls: ledger.calls + 1,
    questions: ledger.questions + questionCount,
    inputTokens: ledger.inputTokens + input,
    outputTokens: ledger.outputTokens + output,
    usd: ledger.usd + (usage?.cost ?? (input * JEV_INPUT_USD_PER_M) / 1e6),
  };
}

/** One line the agent, or the window, can print at the end of a task. */
export function summarize(ledger: Ledger, agentUsd: number): string {
  if (ledger.calls === 0) return "No Jev calls this session.";
  const ratio = ledger.usd > 0 ? Math.round(agentUsd / ledger.usd) : 0;
  return `${ledger.calls} Jev call${ledger.calls === 1 ? "" : "s"}, ${ledger.questions} question${ledger.questions === 1 ? "" : "s"}, $${ledger.usd.toFixed(6)}` +
    (ratio ? `, the agent's own spend was ${ratio}x that` : "");
}
