/** Scores for a yes/no question against labels: ranking quality, accuracy at a line, and the line that fits a split best. */

/** Probability that a random positive outscores a random negative. 1 is a perfect ranking, 0.5 is chance. */
export function auc(scores: number[], labels: boolean[]): number {
  const pos = scores.filter((_, i) => labels[i]), neg = scores.filter((_, i) => !labels[i]);
  if (!pos.length || !neg.length) return NaN;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

export const accuracy = (scores: number[], labels: boolean[], line: number) =>
  scores.filter((s, i) => (s >= line) === labels[i]).length / scores.length;

/** The line with the best accuracy, set halfway between two scores; on a tie, the one closest to 0.5. */
export function bestLine(scores: number[], labels: boolean[]): number {
  const sorted = [...new Set(scores)].sort((a, b) => a - b);
  const candidates = [0, ...sorted.slice(1).map((s, i) => (s + sorted[i]) / 2), 1.0001];
  let best = 0.5, bestAcc = -1;
  for (const c of candidates) {
    const a = accuracy(scores, labels, c);
    if (a > bestAcc || (a === bestAcc && Math.abs(c - 0.5) < Math.abs(best - 0.5))) [best, bestAcc] = [c, a];
  }
  return Math.round(best * 1000) / 1000;
}
