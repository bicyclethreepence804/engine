import { toDecimalReturn } from "./normalize";
import { percentileType7 } from "./percentile";

export function calculateMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calculateStdDev(values: number[], mean: number): number {
  if (values.length < 2) return 0;
  const variance =
    values.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function calculateCagr(
  startValue: number,
  endValue: number,
  startTime: number,
  endTime: number,
): number {
  if (startValue <= 0 || endValue <= 0 || endTime <= startTime) return Number.NaN;
  const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
  const years = (endTime - startTime) / msPerYear;
  if (years <= 0) return Number.NaN;
  return Math.pow(endValue / startValue, 1 / years) - 1;
}

export function calculateInformationRatio(excessReturns: number[]): number {
  const mean = calculateMean(excessReturns);
  const stdDev = calculateStdDev(excessReturns, mean);
  if (!stdDev || Number.isNaN(stdDev)) return 0;
  return mean / stdDev;
}

export function calculateCorrelation(seriesA: number[], seriesB: number[]): number {
  const length = Math.min(seriesA.length, seriesB.length);
  if (length < 2) return 0;
  const a = seriesA.slice(0, length);
  const b = seriesB.slice(0, length);
  const meanA = calculateMean(a);
  const meanB = calculateMean(b);
  let numerator = 0;
  let denomA = 0;
  let denomB = 0;
  for (let i = 0; i < length; i++) {
    const deltaA = a[i] - meanA;
    const deltaB = b[i] - meanB;
    numerator += deltaA * deltaB;
    denomA += deltaA * deltaA;
    denomB += deltaB * deltaB;
  }
  const denominator = Math.sqrt(denomA * denomB);
  if (!denominator) return 0;
  return numerator / denominator;
}

export function calculateAnnualizedVolatility(returns: number[], periodsPerYear: number): number {
  if (returns.length < 2 || periodsPerYear <= 0) return Number.NaN;
  const mean = calculateMean(returns);
  const stdDev = calculateStdDev(returns, mean);
  return stdDev * Math.sqrt(periodsPerYear);
}

export function calculateBeta(strategyReturns: number[], benchmarkReturns: number[]): number {
  const length = Math.min(strategyReturns.length, benchmarkReturns.length);
  if (length < 2) return Number.NaN;
  const strategy = strategyReturns.slice(0, length);
  const benchmark = benchmarkReturns.slice(0, length);
  const meanStrategy = calculateMean(strategy);
  const meanBenchmark = calculateMean(benchmark);
  let cov = 0;
  let varBenchmark = 0;
  for (let i = 0; i < length; i++) {
    const deltaStrategy = strategy[i] - meanStrategy;
    const deltaBenchmark = benchmark[i] - meanBenchmark;
    cov += deltaStrategy * deltaBenchmark;
    varBenchmark += deltaBenchmark * deltaBenchmark;
  }
  if (varBenchmark === 0) return Number.NaN;
  return cov / varBenchmark;
}

export function calculateCalmarRatio(cagr: number, maxDrawdown: number): number {
  if (!Number.isFinite(cagr) || !Number.isFinite(maxDrawdown) || maxDrawdown === 0) {
    return Number.NaN;
  }
  return cagr / Math.abs(maxDrawdown);
}

export function calculateRollingCorrelationPeak(
  strategyReturns: number[],
  benchmarkReturns: number[],
  timeframeMs: number,
  windowDays: number,
): number {
  const length = Math.min(strategyReturns.length, benchmarkReturns.length);
  if (length < 2 || timeframeMs <= 0) return Number.NaN;
  const windowSize = Math.max(2, Math.floor((windowDays * 24 * 60 * 60 * 1000) / timeframeMs));
  if (length < windowSize) return calculateCorrelation(strategyReturns, benchmarkReturns);

  let peak = -Infinity;
  for (let i = 0; i <= length - windowSize; i++) {
    const sliceA = strategyReturns.slice(i, i + windowSize);
    const sliceB = benchmarkReturns.slice(i, i + windowSize);
    const corr = calculateCorrelation(sliceA, sliceB);
    if (corr > peak) peak = corr;
  }
  return peak === -Infinity ? Number.NaN : peak;
}

export function timeframeToMs(timeframe: string | undefined): number | null {
  if (!timeframe) return null;
  const match = String(timeframe).match(/^(\d+)([mhdw])$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!value || Number.isNaN(value)) return null;
  const unit = match[2].toLowerCase();
  const unitMs =
    unit === "m"
      ? 60 * 1000
      : unit === "h"
        ? 60 * 60 * 1000
        : unit === "d"
          ? 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000;
  return value * unitMs;
}

export function buildEquityCurveFromReturns(
  returns: number[],
  startValue: number,
  timestamps: number[],
): Array<{ timestamp: number; balance: number }> {
  const equityCurve: Array<{ timestamp: number; balance: number }> = [];
  let balance = startValue;
  for (let i = 0; i < returns.length; i++) {
    balance *= 1 + returns[i];
    equityCurve.push({ timestamp: timestamps[i] ?? i, balance });
  }
  return equityCurve;
}

export function calculateMaxDrawdown(equityCurve: Array<{ balance: number }>): number {
  if (equityCurve.length === 0) return Number.NaN;
  let peak = equityCurve[0].balance;
  let maxDrawdown = 0;
  for (const point of equityCurve) {
    if (point.balance > peak) peak = point.balance;
    const drawdown = peak > 0 ? ((peak - point.balance) / peak) * 100 : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  return maxDrawdown;
}

const MOMENTS_STD_EPSILON = 1e-10;
const MOMENTS_OUTLIER_Z = 10;

export function calculateSkewness(values: number[]): number {
  if (values.length < 3) return Number.NaN;
  const mean = calculateMean(values);
  const std = calculateStdDev(values, mean);
  if (!std || std < MOMENTS_STD_EPSILON) return Number.NaN;
  const n = values.length;
  const maxAbsZ = Math.max(...values.map((value) => Math.abs((value - mean) / std)));
  if (maxAbsZ > MOMENTS_OUTLIER_Z) return Number.NaN;
  const sumZ3 = values.reduce((sum, value) => sum + Math.pow((value - mean) / std, 3), 0);
  const rawThird = sumZ3 / n;
  const fisherFactor = n / ((n - 1) * (n - 2));
  return fisherFactor * rawThird;
}

export function calculateKurtosis(values: number[]): number {
  if (values.length < 4) return Number.NaN;
  const mean = calculateMean(values);
  const std = calculateStdDev(values, mean);
  if (!std || std < MOMENTS_STD_EPSILON) return Number.NaN;
  const n = values.length;
  const maxAbsDev = Math.max(...values.map((r) => Math.abs(r - mean)));
  if (maxAbsDev > std * MOMENTS_OUTLIER_Z) return Number.NaN;
  const sumZ4 = values.reduce((sum, value) => sum + Math.pow((value - mean) / std, 4), 0);
  const factor1 = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
  const factor2 = (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
  return factor1 * sumZ4 - factor2;
}

export function calculateKurtosisWinsorized(values: number[], tailPct = 0.01): number {
  if (values.length < 4 || tailPct <= 0 || tailPct >= 0.5) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const n = values.length;
  const lowIdx = Math.max(0, Math.floor(n * tailPct) - 1);
  const highIdx = Math.min(n - 1, Math.ceil(n * (1 - tailPct)));
  const lowCap = sorted[lowIdx] ?? sorted[0];
  const highCap = sorted[highIdx] ?? sorted[n - 1];
  const winsorized = values.map((v) => (v < lowCap ? lowCap : v > highCap ? highCap : v));
  return calculateKurtosis(winsorized);
}

export function calculateNeweyWestTStat(
  returns: number[],
  lags?: number,
  options?: { maxZ?: number },
): { tStat: number; stdError: number; mean: number; lags: number } {
  const n = returns.length;
  if (n < 2) return { tStat: Number.NaN, stdError: Number.NaN, mean: Number.NaN, lags: 0 };

  const mean = calculateMean(returns);
  const residuals = returns.map((r) => r - mean);
  const resStd = calculateStdDev(residuals, 0);
  const maxZ = options?.maxZ ?? 10;
  if (resStd > MOMENTS_STD_EPSILON && maxZ < Infinity) {
    const maxAbsRes = Math.max(...residuals.map((r) => Math.abs(r)));
    if (maxAbsRes > maxZ * resStd) return { tStat: Number.NaN, stdError: Number.NaN, mean, lags: 0 };
  }

  let sigmaSq = residuals.reduce((s, res) => s + res * res, 0) / n;
  const L = lags ?? Math.max(1, Math.min(10, Math.floor(4 * Math.pow(n / 100, 2 / 9))));
  for (let l = 1; l <= L; l++) {
    let autocov = 0;
    for (let t = l; t < n; t++) autocov += residuals[t] * residuals[t - l];
    autocov /= n;
    const weight = 1 - l / (L + 1);
    sigmaSq += 2 * weight * autocov;
  }
  sigmaSq = Math.max(0, sigmaSq);
  const stdError = Math.sqrt(sigmaSq / n);
  const tStat = stdError > MOMENTS_STD_EPSILON ? mean / stdError : Number.NaN;
  return { tStat, stdError, mean, lags: L };
}

export function calculateTStat(excessReturns: number[]): number {
  if (excessReturns.length < 3) return Number.NaN;
  const mean = calculateMean(excessReturns);
  const std = calculateStdDev(excessReturns, mean);
  if (!std) return Number.NaN;
  return mean / (std / Math.sqrt(excessReturns.length));
}

export function calculateVar(values: number[], confidence = 0.95): number {
  if (values.length === 0) return Number.NaN;
  const p = 1 - confidence;
  return percentileType7(values, p);
}

export function calculateCvar(values: number[], confidence = 0.95): number {
  if (values.length === 0) return Number.NaN;
  const p = 1 - confidence;
  const p5 = percentileType7(values, p);
  const tail = values.filter((v) => v <= p5);
  if (tail.length === 0) return Number.NaN;
  return tail.reduce((sum, v) => sum + v, 0) / tail.length;
}

export function calculateVarCornishFisher(
  mean: number,
  std: number,
  skewness: number,
  kurtosis: number,
  confidence = 0.95,
): number {
  if (!Number.isFinite(std) || std <= 0) return Number.NaN;
  const z = -1.645;
  const z2 = z * z;
  const z3 = z2 * z;
  const zCf =
    z +
    ((z2 - 1) * skewness) / 6 +
    ((z3 - 3 * z) * kurtosis) / 24 -
    ((2 * z3 - 5 * z) * skewness * skewness) / 36;
  const q = mean + zCf * std;
  const loss = -q;
  return loss > 0 ? loss : 0;
}

export function calculateDurbinWatson(values: number[]): number {
  if (values.length < 2) return Number.NaN;
  let numerator = 0;
  let denominator = 0;
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    numerator += diff * diff;
  }
  for (const value of values) denominator += value * value;
  return denominator ? numerator / denominator : Number.NaN;
}

export function calculateAutocorrelationLag1(values: number[]): number {
  if (values.length < 3) return Number.NaN;
  const seriesA = values.slice(1);
  const seriesB = values.slice(0, -1);
  return calculateCorrelation(seriesA, seriesB);
}

export function calculateEdgeHalfLifeFromAcf(returns: number[]): { periods: number; rho1: number } {
  const rho1 = calculateAutocorrelationLag1(returns);
  if (!Number.isFinite(rho1) || rho1 <= 0 || rho1 >= 1) return { periods: Number.NaN, rho1 };

  const ln05 = Math.log(0.5);
  const lnRho = Math.log(rho1);
  if (!Number.isFinite(lnRho) || lnRho >= 0) return { periods: Number.NaN, rho1 };
  const periods = -ln05 / Math.abs(lnRho);
  return { periods, rho1 };
}

export function normalizeReturnValue(value: number): number {
  return toDecimalReturn(value);
}

export function roundTo(value: number, decimals: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
