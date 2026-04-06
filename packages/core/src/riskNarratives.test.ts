import { describe, expect, it } from "vitest";
import { buildRiskNarratives } from "./riskNarratives";

describe("buildRiskNarratives", () => {
  it("returns empty object when core metrics are missing", () => {
    const out = buildRiskNarratives({} as never);
    expect(out).toEqual({});
  });

  it("builds caution/fail narratives for contradictory profile", () => {
    const out = buildRiskNarratives({
      sharpeRatio: 1.2,
      maxDrawdown: -0.15,
      expectedShortfall95: -0.1,
      var: -0.05,
      skewness: -1.2,
      kurtosis: 6,
      recoveryFactor: -0.5,
      sortinoRatio: 0.8,
      metrics: {
        winRate: 0.8,
        profitFactor: 0.9,
      },
      edgeStabilityZScore: 0.5,
      durbinWatson: 1.1,
      oosWindowCount: 3,
      totalTrades: 100,
      payoffRatio: 0.1,
      tailRatio: 0.2,
    } as never);

    expect(typeof out.riskVerdict).toBe("string");
    expect(String(out.riskVerdict)).toContain("FAIL");
    expect(String(out.riskAttribution)).toContain("High period win rate");
    expect(String(out.diagnosticNote)).toContain("Payoff Ratio");
  });

  it("marks single-window sample as insufficient", () => {
    const out = buildRiskNarratives({
      sharpeRatio: 1.5,
      maxDrawdown: -0.1,
      expectedShortfall95: -0.05,
      var: -0.05,
      skewness: 0.1,
      kurtosis: 0.2,
      recoveryFactor: 2,
      sortinoRatio: 1.8,
      metrics: { winRate: 0.6, profitFactor: 1.4 },
      edgeStabilityZScore: 2,
      durbinWatson: 2,
      oosWindowCount: 1,
      totalTrades: 20,
      oosCvar95Unreliable: true,
    } as never);
    expect(String(out.riskVerdict)).toContain("Insufficient data");
    expect((out as { riskAssessment?: { status?: string } }).riskAssessment?.status).toBe(
      "UNSTABLE",
    );
  });

  it("flags sortino inconsistency when PF<1 but sortino positive", () => {
    const out = buildRiskNarratives({
      sharpeRatio: 1,
      maxDrawdown: -0.2,
      expectedShortfall95: -0.08,
      var: -0.06,
      skewness: 0.2,
      kurtosis: 2,
      recoveryFactor: 0.8,
      sortinoRatio: 0.9,
      metrics: { winRate: 0.55, profitFactor: 0.8 },
      edgeStabilityZScore: 1.2,
      durbinWatson: 2.2,
      oosWindowCount: 6,
      totalTrades: 120,
    } as never);
    expect((out as { sortinoInconsistentWithPf?: boolean }).sortinoInconsistentWithPf).toBe(
      true,
    );
  });

  it("builds cautious-pass sections and recommendation for strong but small sample", () => {
    const out = buildRiskNarratives({
      sharpeRatio: 1.3,
      maxDrawdown: -0.18,
      expectedShortfall95: -0.07,
      var: -0.05,
      skewness: 0.1,
      kurtosis: 6.2,
      recoveryFactor: 2.5,
      sortinoRatio: 1.6,
      metrics: { winRate: 0.57, profitFactor: 1.35 },
      edgeStabilityZScore: 2.1,
      durbinWatson: 2.0,
      oosWindowCount: 3,
      totalTrades: 80,
      tailRatio: 1.4,
    } as never);

    expect(out.riskVerdict).toBe("CAUTIOUS PASS");
    expect(Array.isArray((out as { riskVerdictSections?: unknown[] }).riskVerdictSections)).toBe(true);
    expect((out as { riskRecommendation?: { status?: string } }).riskRecommendation?.status).toContain(
      "Deployable",
    );
  });

  it("adds outlier artifact diagnostic for capped PF and very low win rate", () => {
    const out = buildRiskNarratives({
      sharpeRatio: 0.9,
      maxDrawdown: -0.35,
      expectedShortfall95: -0.2,
      var: 0,
      skewness: -2,
      kurtosis: 8,
      recoveryFactor: 0.4,
      sortinoRatio: 0.2,
      metrics: { winRate: 0.1, profitFactor: 20 },
      edgeStabilityZScore: 0.5,
      durbinWatson: 1.8,
      oosWindowCount: 6,
      totalTrades: 40,
    } as never);

    expect(String(out.riskAttribution)).toContain("mathematical artifact");
    expect(String(out.diagnosticNote)).toContain("Extreme Outlier Dependency");
  });

  it("builds unstable assessment for low PF and weak profile", () => {
    const out = buildRiskNarratives({
      sharpeRatio: 0.7,
      maxDrawdown: -0.28,
      expectedShortfall95: -0.12,
      var: -0.08,
      skewness: -0.3,
      kurtosis: 1.5,
      recoveryFactor: 0.5,
      sortinoRatio: 0.1,
      metrics: { winRate: 0.45, profitFactor: 1.1 },
      edgeStabilityZScore: -0.2,
      durbinWatson: 1.2,
      oosWindowCount: 4,
      totalTrades: 60,
    } as never);

    expect(String(out.riskVerdict)).toContain("FAIL");
    expect((out as { riskAssessment?: { status?: string } }).riskAssessment?.status).toBe("UNSTABLE");
  });

  it("handles cvar-unreliable branch while keeping narratives non-empty", () => {
    const out = buildRiskNarratives({
      sharpeRatio: 1.1,
      maxDrawdown: -0.14,
      expectedShortfall95: Number.NaN,
      var: -0.06,
      skewness: 0.3,
      kurtosis: 0.8,
      recoveryFactor: 1.5,
      sortinoRatio: 1.2,
      metrics: { winRate: 0.58, profitFactor: 1.4 },
      edgeStabilityZScore: 1.6,
      durbinWatson: 2.1,
      oosWindowCount: 6,
      totalTrades: 120,
      oosCvar95Unreliable: true,
    } as never);

    expect(typeof out.tailAuthority).toBe("string");
    expect(typeof out.contextNote).toBe("string");
  });

  it("builds sub-gaussian tail profile branch", () => {
    const out = buildRiskNarratives({
      sharpeRatio: 1.4,
      maxDrawdown: -0.12,
      expectedShortfall95: -0.06,
      var: -0.05,
      skewness: 0.1,
      kurtosis: -0.4,
      recoveryFactor: 2.2,
      sortinoRatio: 1.7,
      metrics: { winRate: 0.61, profitFactor: 1.5 },
      edgeStabilityZScore: 2.1,
      durbinWatson: 2.0,
      oosWindowCount: 8,
      totalTrades: 140,
      tailRatio: 1.1,
    } as never);

    expect(String(out.tailRiskProfile)).toContain("Sub-Gaussian");
    expect((out as { riskAssessment?: { status?: string } }).riskAssessment?.status).toBe("STABLE");
  });
});
