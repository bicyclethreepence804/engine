/**
 * Normalize a return-like value to decimal (0.01 = 1%).
 * Heuristic: |x| > 1 is treated as percent (x / 100).
 */
export function toDecimalReturn(value: unknown): number {
  const x = typeof value === "number" && Number.isFinite(value) ? value : Number.NaN;
  if (!Number.isFinite(x)) return Number.NaN;
  if (Math.abs(x) > 1) return x / 100;
  return x;
}
