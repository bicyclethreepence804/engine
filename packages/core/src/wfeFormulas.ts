/**
 * WFE / pro-benchmark tail metrics. Single implementation for core and the host metrics registry.
 */

/**
 * Empirical CVaR 95%: mean of worst 5% of returns (sorted ascending).
 * For N < 30 use empirical tail mean only (no k=1.5 scaling). Returns null when empty.
 */
export function calcWfeCvar95(returns: number[]): number | null {
  if (returns.length === 0) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const k = Math.max(1, Math.ceil(sorted.length * 0.05));
  const tail = sorted.slice(0, k);
  const mean = tail.reduce((s, x) => s + x, 0) / tail.length;
  return Number.isFinite(mean) ? mean : null;
}
