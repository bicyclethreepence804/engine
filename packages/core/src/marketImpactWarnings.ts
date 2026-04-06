const ADV_WARN_THRESHOLD = 10_000;

/**
 * Layer 2.5: warnings when market impact CAGR or ADV assumptions are extreme.
 */
export function computeMarketImpactWarnings(
  marketImpactCagr: number,
  avgDailyVolume: number,
): string[] {
  const warnings: string[] = [];
  if (Number.isFinite(marketImpactCagr) && marketImpactCagr > 1) {
    warnings.push(
      `Market impact ${(marketImpactCagr * 100).toFixed(1)}% exceeds 100% of capital. Strategy not viable at this AUM. Verify ADV assumption (current: $${Number(avgDailyVolume).toLocaleString()}).`,
    );
  }
  if (Number.isFinite(avgDailyVolume) && avgDailyVolume < ADV_WARN_THRESHOLD) {
    warnings.push(
      `ADV $${Number(avgDailyVolume).toLocaleString()} is very low; model assumptions may not hold.`,
    );
  }
  return warnings;
}
