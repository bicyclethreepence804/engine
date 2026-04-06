import { describe, expect, it } from "vitest";
import {
  buildEquityCurveFromReturns,
  calculateAnnualizedVolatility,
  calculateAutocorrelationLag1,
  calculateBeta,
  calculateCagr,
  calculateCalmarRatio,
  calculateCorrelation,
  calculateCvar,
  calculateDurbinWatson,
  calculateEdgeHalfLifeFromAcf,
  calculateInformationRatio,
  calculateKurtosis,
  calculateKurtosisWinsorized,
  calculateMaxDrawdown,
  calculateMean,
  calculateNeweyWestTStat,
  calculateRollingCorrelationPeak,
  calculateSkewness,
  calculateStdDev,
  calculateTStat,
  calculateVar,
  calculateVarCornishFisher,
  normalizeReturnValue,
  roundTo,
  timeframeToMs,
} from "./financialMath";

describe("financialMath", () => {
  it("calculateMean and calculateStdDev edge cases", () => {
    expect(calculateMean([])).toBe(0);
    expect(calculateStdDev([1], 1)).toBe(0);
    expect(calculateStdDev([1, 3], 2)).toBeCloseTo(Math.sqrt(2), 10);
  });

  it("calculateCagr", () => {
    const t0 = Date.UTC(2020, 0, 1);
    const t1 = Date.UTC(2021, 0, 1);
    expect(Number.isNaN(calculateCagr(0, 100, t0, t1))).toBe(true);
    expect(Number.isNaN(calculateCagr(100, 100, t0, t0))).toBe(true);
    expect(calculateCagr(100, 121, t0, t1)).toBeGreaterThan(0);
  });

  it("calculateInformationRatio", () => {
    expect(calculateInformationRatio([0, 0, 0])).toBe(0);
    expect(calculateInformationRatio([0.1, -0.05, 0.02])).not.toBe(0);
  });

  it("calculateCorrelation", () => {
    expect(calculateCorrelation([1, 1], [2, 3])).toBe(0);
    expect(calculateCorrelation([1], [2])).toBe(0);
    expect(calculateCorrelation([1, 2, 3], [1, 2, 4])).toBeGreaterThan(0);
  });

  it("calculateAnnualizedVolatility", () => {
    expect(Number.isNaN(calculateAnnualizedVolatility([0.01], 252))).toBe(true);
    expect(Number.isNaN(calculateAnnualizedVolatility([0.01, 0.02], 0))).toBe(true);
    expect(calculateAnnualizedVolatility([0.01, -0.005, 0.02], 252)).toBeGreaterThan(0);
  });

  it("calculateBeta", () => {
    expect(Number.isNaN(calculateBeta([0.1], [0.05]))).toBe(true);
    expect(Number.isNaN(calculateBeta([0.01, 0.02], [0, 0]))).toBe(true);
    expect(calculateBeta([0.02, 0.04], [0.01, 0.02])).toBeCloseTo(2, 5);
  });

  it("calculateCalmarRatio", () => {
    expect(Number.isNaN(calculateCalmarRatio(0.1, 0))).toBe(true);
    expect(calculateCalmarRatio(0.2, -0.1)).toBeCloseTo(2, 10);
  });

  it("calculateRollingCorrelationPeak", () => {
    const a = [0.01, 0.02, -0.01, 0.03, 0.01];
    const b = [0.02, 0.01, 0.01, 0.02, 0.03];
    const dayMs = 86_400_000;
    const sliding = calculateRollingCorrelationPeak(a, b, dayMs, 1);
    expect(Number.isFinite(sliding)).toBe(true);
    const short = calculateRollingCorrelationPeak([0.1, 0.2], [0.05, 0.15], dayMs, 365);
    expect(Number.isFinite(short)).toBe(true);
    expect(Number.isNaN(calculateRollingCorrelationPeak(a, b, 0, 10))).toBe(true);
  });

  it("timeframeToMs", () => {
    expect(timeframeToMs(undefined)).toBeNull();
    expect(timeframeToMs("")).toBeNull();
    expect(timeframeToMs("15m")).toBe(15 * 60 * 1000);
    expect(timeframeToMs("2h")).toBe(2 * 60 * 60 * 1000);
    expect(timeframeToMs("1d")).toBe(24 * 60 * 60 * 1000);
    expect(timeframeToMs("1w")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(timeframeToMs("bad")).toBeNull();
    expect(timeframeToMs("0h")).toBeNull();
  });

  it("buildEquityCurveFromReturns uses index when timestamp missing", () => {
    const curve = buildEquityCurveFromReturns([0.1, -0.05], 100, []);
    expect(curve).toHaveLength(2);
    expect(curve[0]?.timestamp).toBe(0);
    expect(curve[1]?.balance).toBeCloseTo(100 * 1.1 * 0.95, 10);
  });

  it("calculateMaxDrawdown", () => {
    expect(Number.isNaN(calculateMaxDrawdown([]))).toBe(true);
    expect(calculateMaxDrawdown([{ balance: 100 }, { balance: 80 }, { balance: 90 }])).toBeCloseTo(20, 10);
    expect(calculateMaxDrawdown([{ balance: 0 }, { balance: 0 }])).toBe(0);
  });

  it("calculateSkewness", () => {
    expect(Number.isNaN(calculateSkewness([1, 2]))).toBe(true);
    const flat = [1, 1, 1, 1];
    expect(Number.isNaN(calculateSkewness(flat))).toBe(true);
    const skewOutlierSample = Array.from({ length: 200 }, () => 0).concat([1e9]);
    expect(Number.isNaN(calculateSkewness(skewOutlierSample))).toBe(true);
    expect(Number.isFinite(calculateSkewness([1, 2, 3, 4, 5]))).toBe(true);
  });

  it("calculateKurtosis and winsorized", () => {
    expect(Number.isNaN(calculateKurtosis([1, 2, 3]))).toBe(true);
    expect(Number.isNaN(calculateKurtosisWinsorized([1, 2, 3, 4], 0))).toBe(true);
    expect(Number.isNaN(calculateKurtosisWinsorized([1, 2, 3, 4], 0.6))).toBe(true);
    expect(Number.isFinite(calculateKurtosisWinsorized([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(true);
    const kurtOutlierSample = Array.from({ length: 200 }, () => 0).concat([1e9]);
    expect(Number.isNaN(calculateKurtosis(kurtOutlierSample))).toBe(true);
  });

  it("calculateNeweyWestTStat", () => {
    const tiny = calculateNeweyWestTStat([0.01]);
    expect(Number.isNaN(tiny.tStat)).toBe(true);
    const out = calculateNeweyWestTStat([0, 0, 0, 10], 1, { maxZ: 1 });
    expect(Number.isNaN(out.tStat)).toBe(true);
    const ok = calculateNeweyWestTStat([0.01, -0.005, 0.02, 0.01]);
    expect(Number.isFinite(ok.mean)).toBe(true);
    expect(ok.lags).toBeGreaterThan(0);
  });

  it("calculateTStat", () => {
    expect(Number.isNaN(calculateTStat([1, 2]))).toBe(true);
    expect(Number.isNaN(calculateTStat([1, 1, 1]))).toBe(true);
    expect(Number.isFinite(calculateTStat([0.1, 0.2, 0.15]))).toBe(true);
  });

  it("calculateVar and calculateCvar", () => {
    expect(Number.isNaN(calculateVar([], 0.95))).toBe(true);
    const xs = [-0.05, -0.02, 0.01, 0.02, 0.03];
    expect(Number.isFinite(calculateVar(xs, 0.95))).toBe(true);
    expect(Number.isFinite(calculateCvar(xs, 0.95))).toBe(true);
  });

  it("calculateVarCornishFisher", () => {
    expect(Number.isNaN(calculateVarCornishFisher(0, 0, 0, 0, 0.95))).toBe(true);
    expect(calculateVarCornishFisher(0, 1, 0, 0, 0.95)).toBeGreaterThanOrEqual(0);
  });

  it("calculateDurbinWatson and calculateAutocorrelationLag1", () => {
    expect(Number.isNaN(calculateDurbinWatson([1]))).toBe(true);
    expect(calculateDurbinWatson([0, 0, 0])).toBe(Number.NaN);
    expect(Number.isFinite(calculateDurbinWatson([1, 2, 1, 2]))).toBe(true);
    expect(Number.isNaN(calculateAutocorrelationLag1([1, 2]))).toBe(true);
    expect(Number.isFinite(calculateAutocorrelationLag1([0.1, -0.05, 0.02, 0.01]))).toBe(true);
  });

  it("calculateEdgeHalfLifeFromAcf", () => {
    expect(calculateEdgeHalfLifeFromAcf([0.1, 0.1, 0.1]).periods).toBe(Number.NaN);
    const neg = calculateEdgeHalfLifeFromAcf([0.1, -0.2, 0.05]);
    expect(neg.periods).toBe(Number.NaN);
    const rhoHi = calculateEdgeHalfLifeFromAcf([0.01, 0.009, 0.008, 0.007]);
    expect(rhoHi.rho1).toBeGreaterThan(0);
    expect(rhoHi.rho1).toBeLessThan(1);
    expect(Number.isFinite(rhoHi.periods)).toBe(true);
  });

  it("normalizeReturnValue and roundTo", () => {
    expect(typeof normalizeReturnValue(0.1)).toBe("number");
    expect(roundTo(Number.NaN, 2)).toBe(0);
    expect(roundTo(1.2345, 2)).toBeCloseTo(1.23, 10);
  });
});
