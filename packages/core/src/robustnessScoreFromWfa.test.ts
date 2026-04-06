import { describe, expect, it } from "vitest";
import { calculateRobustnessScoreFromWfa } from "./robustnessScoreFromWfa";

describe("calculateRobustnessScoreFromWfa", () => {
  it("returns null when walkForwardAnalysis is missing", () => {
    const out = calculateRobustnessScoreFromWfa({} as never);
    expect(out).toBeNull();
  });

  it("returns blocked score for clearly bad WFA/risk profile", () => {
    const out = calculateRobustnessScoreFromWfa({
      walkForwardAnalysis: {
        periods: [
          { optimizationReturn: 0.1, validationReturn: -0.2 },
          { optimizationReturn: 0.08, validationReturn: -0.15 },
        ],
        failedWindows: { count: 2, total: 2 },
      },
      proBenchmarkMetrics: { windowsCount: 2, avgOosSharpe: -1, wfeDistribution: { median: -0.5 } },
      riskAnalysis: { metrics: { profitFactor: 0.6 }, kurtosis: 20, recoveryFactor: -0.5, sharpeRatio: -1 },
      parameterSensitivity: { parameters: [{ sensitivity: 0.9 }, { sensitivity: 0.8 }] },
      turnoverAndCostDrag: { annualTurnover: 50, avgNetProfitPerTradeBps: -10, breakevenSlippageBps: 1 },
    } as never);

    expect(out).not.toBeNull();
    expect(out?.overall).toBe(0);
    expect(out?.blockedByModule).toBeDefined();
  });

  it("marks stabilityNotComputed when parameterSensitivity is absent", () => {
    const out = calculateRobustnessScoreFromWfa({
      walkForwardAnalysis: {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.06 },
          { optimizationReturn: 0.12, validationReturn: 0.08 },
        ],
        failedWindows: { count: 0, total: 2 },
      },
      proBenchmarkMetrics: { windowsCount: 2, wfeDistribution: { median: 0.7 }, avgOosSharpe: 0.8 },
      riskAnalysis: { metrics: { profitFactor: 1.3 }, kurtosis: 3, recoveryFactor: 1.2, sharpeRatio: 1 },
      turnoverAndCostDrag: { annualTurnover: 4, avgNetProfitPerTradeBps: 25, breakevenSlippageBps: 30 },
    } as never);

    expect(out).not.toBeNull();
    expect(out?.stabilityNotComputed).toBe(true);
    expect(out?.modules?.stability).toBe(0);
    expect(out?.blockedByModules).toContain("stability");
  });

  it("blocks by execution when breakeven slippage is below 10bps", () => {
    const out = calculateRobustnessScoreFromWfa({
      walkForwardAnalysis: {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.08 },
          { optimizationReturn: 0.11, validationReturn: 0.07 },
        ],
        failedWindows: { count: 0, total: 2 },
        consistency: 1,
      },
      proBenchmarkMetrics: { windowsCount: 2, avgOosSharpe: 1.2, wfeDistribution: { median: 0.8 } },
      riskAnalysis: { metrics: { profitFactor: 1.6 }, kurtosis: 2, recoveryFactor: 1.8, sharpeRatio: 1.4 },
      parameterSensitivity: { parameters: [{ sensitivity: 0.1 }] },
      turnoverAndCostDrag: { annualTurnover: 5, avgNetProfitPerTradeBps: 20, breakevenSlippageBps: 2 },
    } as never);

    expect(out).not.toBeNull();
    expect((out?.modules?.execution ?? 100)).toBeLessThan(10);
    expect(out?.blockedByModules).toContain("execution");
    expect(out?.overall).toBe(0);
    expect(typeof out?.potentialOverall).toBe("number");
  });

  it("uses fallback WFE note when periods are missing", () => {
    const out = calculateRobustnessScoreFromWfa({
      walkForwardAnalysis: {
        wfe: 0.62,
        failedWindows: { count: 0, total: 1 },
      },
      proBenchmarkMetrics: { windowsCount: 1, avgOosSharpe: 0.9 },
      riskAnalysis: { metrics: { profitFactor: 1.4 }, kurtosis: 2, recoveryFactor: 1.1 },
      parameterSensitivity: { parameters: [{ sensitivity: 0.2 }] },
      turnoverAndCostDrag: { annualTurnover: 3, avgNetProfitPerTradeBps: 15, breakevenSlippageBps: 40 },
    } as never);

    expect(out).not.toBeNull();
    expect(String(out?.wfeNote)).toContain("No WFA periods");
  });

  it("returns non-blocked score and no blockedByModule on healthy profile", () => {
    const out = calculateRobustnessScoreFromWfa({
      walkForwardAnalysis: {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.09 },
          { optimizationReturn: 0.12, validationReturn: 0.1 },
          { optimizationReturn: 0.11, validationReturn: 0.09 },
        ],
        failedWindows: { count: 0, total: 3 },
        consistency: 0.9,
      },
      proBenchmarkMetrics: {
        windowsCount: 3,
        avgOosSharpe: 1.6,
        wfeDistribution: { median: 0.82 },
        parameterStabilityIndex: 0.2,
      },
      riskAnalysis: {
        metrics: { profitFactor: 1.8 },
        kurtosis: 2.5,
        recoveryFactor: 2.1,
        sharpeRatio: 1.5,
        edgeStabilityZScore: 2.2,
      },
      parameterSensitivity: { parameters: [{ sensitivity: 0.2 }, { sensitivity: 0.3 }] },
      turnoverAndCostDrag: { annualTurnover: 4, avgNetProfitPerTradeBps: 35, breakevenSlippageBps: 30 },
    } as never);

    expect(out).not.toBeNull();
    expect(out?.overall).toBeGreaterThan(0);
    expect(out?.blockedByModule).toBeUndefined();
    expect((out?.modules?.execution ?? 0) >= 10).toBe(true);
  });

  it("uses volatility-weighted WFE when curves match periods and have enough points", () => {
    const lowVolCurve = [1000, 1001, 1002, 1003, 1004, 1005].map((value, i) => ({
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      value,
    }));
    const highVolCurve = [1000, 1080, 990, 1070, 980, 1090].map((value, i) => ({
      date: `2024-02-${String(i + 1).padStart(2, "0")}`,
      value,
    }));
    const out = calculateRobustnessScoreFromWfa({
      walkForwardAnalysis: {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.06 },
          { optimizationReturn: 0.1, validationReturn: 0.09 },
        ],
        performanceTransfer: {
          windows: [{ oosEquityCurve: lowVolCurve }, { oosEquityCurve: highVolCurve }],
        },
        failedWindows: { count: 0, total: 2 },
        consistency: 0.85,
      },
      proBenchmarkMetrics: { windowsCount: 2, avgOosSharpe: 1.1, wfeDistribution: { median: 0.75 } },
      riskAnalysis: { metrics: { profitFactor: 1.5 }, kurtosis: 2.5, recoveryFactor: 1.4, sharpeRatio: 1.2 },
      parameterSensitivity: { parameters: [{ sensitivity: 0.2 }] },
      turnoverAndCostDrag: { annualTurnover: 4, avgNetProfitPerTradeBps: 25, breakevenSlippageBps: 30 },
    } as never);

    expect(out).not.toBeNull();
    expect(out?.wfeNote).toBeUndefined();
    const meanPlain = (0.06 / 0.1 + 0.09 / 0.1) / 2;
    const timeRobustness = out?.components?.timeRobustness ?? NaN;
    expect(Number.isFinite(timeRobustness)).toBe(true);
    expect(Math.abs(timeRobustness - meanPlain)).toBeGreaterThan(0.001);
  });

  it("falls back to mean WFE when per-window curves mismatch periods", () => {
    const out = calculateRobustnessScoreFromWfa({
      walkForwardAnalysis: {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.06 },
          { optimizationReturn: 0.1, validationReturn: 0.05 },
        ],
        performanceTransfer: {
          windows: [{ oosEquityCurve: [{ date: "2024-01-01", value: 1.0 }] }],
        },
        failedWindows: { count: 0, total: 2 },
      },
      proBenchmarkMetrics: { windowsCount: 2, avgOosSharpe: 0.8 },
      riskAnalysis: { metrics: { profitFactor: 1.3 }, kurtosis: 2, recoveryFactor: 1.1 },
      parameterSensitivity: { parameters: [{ sensitivity: 0.2 }] },
      turnoverAndCostDrag: { annualTurnover: 4, avgNetProfitPerTradeBps: 20, breakevenSlippageBps: 20 },
    } as never);

    expect(out).not.toBeNull();
    expect(String(out?.wfeNote)).toContain("mean WFE");
  });

  it("marks risk module as zero when profit factor < 1", () => {
    const out = calculateRobustnessScoreFromWfa({
      walkForwardAnalysis: {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.05 },
          { optimizationReturn: 0.1, validationReturn: 0.04 },
        ],
        failedWindows: { count: 0, total: 2 },
      },
      proBenchmarkMetrics: { windowsCount: 2, avgOosSharpe: 0.9 },
      riskAnalysis: { metrics: { profitFactor: 0.99 }, kurtosis: 2, recoveryFactor: 2 },
      parameterSensitivity: { parameters: [{ sensitivity: 0.1 }] },
      turnoverAndCostDrag: { annualTurnover: 3, avgNetProfitPerTradeBps: 20, breakevenSlippageBps: 20 },
    } as never);
    expect(out).not.toBeNull();
    expect(out?.modules?.risk).toBe(0);
    expect(out?.blockedByModules).toContain("risk");
  });

  it("reports note when no valid WFE windows can be computed", () => {
    const out = calculateRobustnessScoreFromWfa({
      walkForwardAnalysis: {
        periods: [
          { optimizationReturn: 0, validationReturn: 0.02 },
          { optimizationReturn: 0, validationReturn: 0.01 },
        ],
        failedWindows: { count: 0, total: 2 },
      },
      proBenchmarkMetrics: { windowsCount: 2, avgOosSharpe: 0.7 },
      riskAnalysis: { metrics: { profitFactor: 1.2 }, kurtosis: 2, recoveryFactor: 1.1 },
      parameterSensitivity: { parameters: [{ sensitivity: 0.2 }] },
      turnoverAndCostDrag: { annualTurnover: 4, avgNetProfitPerTradeBps: 20, breakevenSlippageBps: 25 },
    } as never);
    expect(out).not.toBeNull();
    expect(String(out?.wfeNote)).toContain("No valid WFE");
  });

  it("applies execution penalty branch for m4 in [10,20)", () => {
    const out = calculateRobustnessScoreFromWfa({
      walkForwardAnalysis: {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.08 },
          { optimizationReturn: 0.1, validationReturn: 0.08 },
          { optimizationReturn: 0.1, validationReturn: 0.08 },
        ],
        failedWindows: { count: 0, total: 3 },
        consistency: 0.9,
      },
      proBenchmarkMetrics: { windowsCount: 3, avgOosSharpe: 0.4, wfeDistribution: { median: 0.8 } },
      riskAnalysis: { metrics: { profitFactor: 1.4 }, kurtosis: 2.5, recoveryFactor: 1.4, edgeStabilityZScore: 1.2 },
      parameterSensitivity: { parameters: [{ sensitivity: 0.2 }] },
      turnoverAndCostDrag: { annualTurnover: 5, avgNetProfitPerTradeBps: 20, breakevenSlippageBps: 9 },
    } as never);
    expect(out).not.toBeNull();
    expect(typeof out?.modules?.execution).toBe("number");
    expect((out?.modules?.execution ?? -1) >= 0).toBe(true);
    expect((out?.overall ?? -1) >= 0).toBe(true);
  });
});
