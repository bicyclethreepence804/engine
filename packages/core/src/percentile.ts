/**
 * Canonical percentile implementation - Hyndman and Fan Type 7.
 */
export function percentileType7(R: number[], p: number): number {
  if (R.length === 0) return Number.NaN;
  if (R.length === 1) return R[0];
  const sorted = [...R].sort((a, b) => a - b);
  const N = sorted.length;
  const h = (N - 1) * p;
  const lower = Math.floor(h);
  const upper = Math.min(lower + 1, N - 1);
  return sorted[lower] + (h - lower) * (sorted[upper] - sorted[lower]);
}
