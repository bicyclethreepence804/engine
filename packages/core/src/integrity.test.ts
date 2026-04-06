import { describe, expect, it } from "vitest";
import { runIntegrityJudge } from "./integrity";

describe("runIntegrityJudge", () => {
  it("returns valid for sparse neutral report", () => {
    const out = runIntegrityJudge({} as never);
    expect(out.isValid).toBe(true);
    expect(out.issues).toHaveLength(0);
  });

  it("emits issues for contradictory metrics", () => {
    const out = runIntegrityJudge({
      results: { totalTrades: 12, totalReturn: 0.4 },
      robustnessScore: { overall: 80 },
      benchmarkComparison: { netEdgeBps: -5 },
      riskAnalysis: { maxDrawdown: 0 },
      walkForwardAnalysis: {
        periods: [
          { validationReturn: -0.1 },
          { validationReturn: -0.2 },
        ],
      },
      proBenchmarkMetrics: {
        wfaPassProbability: 0.8,
        wfeDistribution: { median: 2 },
        sumOos: 0.1,
      },
    } as never);

    expect(out.isValid).toBe(false);
    expect(out.issues.length).toBeGreaterThan(0);
  });

  it("flags Luck Factor when single-window context and negative net edge with positive return", () => {
    const out = runIntegrityJudge({
      results: { totalReturn: 0.05, totalTrades: 5 },
      benchmarkComparison: { netEdgeBps: -3 },
      walkForwardAnalysis: { periods: [{ validationReturn: 0.01 }] },
    } as never);
    expect(out.issues.some((i) => i.message.includes("Luck Factor"))).toBe(true);
  });

  it("flags max drawdown unit mismatch for multi-window WFA", () => {
    const out = runIntegrityJudge({
      results: { totalReturn: 0.1, totalTrades: 20 },
      riskAnalysis: { maxDrawdown: -1.2 },
      walkForwardAnalysis: {
        periods: [{ validationReturn: 0.01 }, { validationReturn: 0.02 }],
      },
    } as never);
    expect(out.issues.some((i) => i.message.includes("MaxDrawdown units inconsistent"))).toBe(true);
  });

  it("flags drawdown exceeding total return when not multi-window WFA", () => {
    const out = runIntegrityJudge({
      results: { totalReturn: 0.1, totalTrades: 20 },
      riskAnalysis: { maxDrawdown: -0.25 },
      walkForwardAnalysis: { periods: [] },
    } as never);
    expect(out.issues.some((i) => i.message.includes("exceeds total return"))).toBe(true);
  });

  it("flags retention and optimization gain paradox", () => {
    const out = runIntegrityJudge({
      proBenchmarkMetrics: {
        oosRetention: 0.5,
        optimizationGain: -0.1,
        sumIs: 0.2,
      },
    } as never);
    expect(out.issues.some((i) => i.message.includes("Retention/Gain Paradox"))).toBe(true);
  });

  it("warns on high robustness with very low trade count", () => {
    const out = runIntegrityJudge({
      results: { totalTrades: 5 },
      robustnessScore: { overall: 55 },
    } as never);
    expect(out.issues.some((i) => i.message.includes("Insignificant Data"))).toBe(true);
  });

  it("treats non-array WFA periods as zero length", () => {
    const out = runIntegrityJudge({
      walkForwardAnalysis: { periods: "x" as unknown as [] },
    } as never);
    expect(out.isValid).toBe(true);
  });

  it("uses benchmark strategy CAGR for Luck Factor when total return is absent", () => {
    const out = runIntegrityJudge({
      benchmarkComparison: { netEdgeBps: -4, strategyCAGR: 12 },
      walkForwardAnalysis: { periods: [{ validationReturn: 0.01 }] },
    } as never);
    expect(out.issues.some((i) => i.message.includes("Luck Factor"))).toBe(true);
  });

  it("detects Bayesian anomaly using validation_return field", () => {
    const out = runIntegrityJudge({
      walkForwardAnalysis: {
        periods: [{ validation_return: -0.1 }, { validation_return: -0.05 }],
      },
      proBenchmarkMetrics: { wfaPassProbability: 0.5 },
    } as never);
    expect(out.issues.some((i) => i.message.includes("Bayesian Anomaly"))).toBe(true);
  });

  it("does not flag Bayesian anomaly when some windows pass", () => {
    const out = runIntegrityJudge({
      walkForwardAnalysis: {
        periods: [{ validationReturn: -0.1 }, { validationReturn: 0.05 }],
      },
      proBenchmarkMetrics: { wfaPassProbability: 0.9 },
    } as never);
    expect(out.issues.some((i) => i.message.includes("Bayesian Anomaly"))).toBe(false);
  });

  it("does not flag Bayesian anomaly when all windows fail but pass probability is low", () => {
    const out = runIntegrityJudge({
      walkForwardAnalysis: {
        periods: [{ validationReturn: -0.1 }, { validationReturn: -0.05 }],
      },
      proBenchmarkMetrics: { wfaPassProbability: 0.15 },
    } as never);
    expect(out.issues.some((i) => i.message.includes("Bayesian Anomaly"))).toBe(false);
  });

  it("warns on low N with high WFA pass probability", () => {
    const out = runIntegrityJudge({
      results: { totalTrades: 10 },
      proBenchmarkMetrics: { wfaPassProbability: 0.71 },
    } as never);
    expect(out.issues.some((i) => i.message.includes("Insufficient sample size"))).toBe(true);
  });
});
