/**
 * Distribution summaries for path Monte Carlo sample arrays.
 */

import { calculateMean, calculateStdDev, calculateVarCornishFisher } from "./financialMath";
import { percentileType7 } from "./percentile";
import type { DistributionStats } from "@kiploks/engine-contracts";

/**
 * Adjusted Fisher-Pearson skewness G1 (sample), no outlier guard.
 * Differs from `financialMath.calculateSkewness`, which applies an outlier z-score guard and can return NaN.
 */
function sampleSkewness(xs: number[]): number {
  const n = xs.length;
  if (n < 3) return Number.NaN;
  const mean = calculateMean(xs);
  const std = calculateStdDev(xs, mean);
  if (!std || std < 1e-15) return Number.NaN;
  let sumZ3 = 0;
  for (const x of xs) {
    const z = (x - mean) / std;
    sumZ3 += z * z * z;
  }
  return (n / ((n - 1) * (n - 2))) * sumZ3;
}

/** Excess kurtosis (sample), no outlier guard. */
function sampleExcessKurtosis(xs: number[]): number {
  const n = xs.length;
  if (n < 4) return Number.NaN;
  const mean = calculateMean(xs);
  const std = calculateStdDev(xs, mean);
  if (!std || std < 1e-15) return Number.NaN;
  let sumZ4 = 0;
  for (const x of xs) {
    const z = (x - mean) / std;
    sumZ4 += z * z * z * z;
  }
  const f1 = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
  const f2 = (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
  return f1 * sumZ4 - f2;
}

/**
 * Historical VaR/CVaR at 95% confidence on a sample.
 * `var95` / `cvar95` are **positive** numbers meaning loss magnitude (for left-tail metrics on P&L-like series).
 */
export function computeDistributionStats(xs: number[]): DistributionStats {
  if (xs.length === 0) {
    return {
      mean: Number.NaN,
      std: Number.NaN,
      skewness: Number.NaN,
      kurtosis: Number.NaN,
      var95: Number.NaN,
      cvar95: Number.NaN,
    };
  }
  const mean = calculateMean(xs);
  const std = xs.length >= 2 ? calculateStdDev(xs, mean) : 0;
  const skewness = sampleSkewness(xs);
  const kurtosis = sampleExcessKurtosis(xs);

  const sorted = [...xs].sort((a, b) => a - b);
  const p5 = percentileType7(sorted, 0.05);
  const var95 = -p5;

  const tailValues = sorted.filter((x) => x <= p5);
  const cvar95 =
    tailValues.length > 0
      ? -(tailValues.reduce((a, b) => a + b, 0) / tailValues.length)
      : var95;

  const base: DistributionStats = { mean, std, skewness, kurtosis, var95, cvar95 };
  if (
    Number.isFinite(skewness) &&
    Number.isFinite(kurtosis) &&
    Number.isFinite(mean) &&
    Number.isFinite(std) &&
    std > 0
  ) {
    const cf = calculateVarCornishFisher(mean, std, skewness, kurtosis, 0.95);
    if (Number.isFinite(cf)) return { ...base, varCornishFisher95: cf };
  }
  return base;
}
