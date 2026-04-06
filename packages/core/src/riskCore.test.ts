import { describe, expect, it } from "vitest";
import { buildCanonicalR, computeTailRatio, riskBuilderFromRCore } from "./riskCore";

describe("riskCore", () => {
  it("returns empty canonical R for invalid trades", () => {
    expect(buildCanonicalR([])).toEqual([]);
    expect(buildCanonicalR([{ x: 1 }] as never)).toEqual([]);
  });

  it("computes canonical R from net_return and pnl_pct", () => {
    const out = buildCanonicalR([
      { net_return: 0.1 },
      { pnl_pct: 5 },
      { pnl_pct: -2 },
    ] as never);
    expect(out).toEqual([0.1, 0.05, -0.02]);
  });

  it("returns null tail ratio for invalid percentile inputs", () => {
    expect(computeTailRatio(NaN, 0.2)).toBeNull();
    expect(computeTailRatio(0, 0.2)).toBeNull();
    expect(typeof computeTailRatio(-0.1, 0.2)).toBe("number");
  });

  it("returns NaN-rich result for empty R", () => {
    const out = riskBuilderFromRCore([]);
    expect(Number.isNaN(out.maxDrawdown)).toBe(true);
    expect(out.oosWindowCount).toBe(0);
  });

  it("sets warning and capped PF/GtP for outlier-dominant returns", () => {
    const out = riskBuilderFromRCore([0.9, -0.01, -0.01, -0.01, 0.01, 0.01], {
      oosWindowCount: 3,
    });
    expect(out.metrics.profitFactor).toBeLessThanOrEqual(20);
    expect(out.gainToPain).toBeLessThanOrEqual(100);
    expect(out.singleTradeDominanceWarning).toBeDefined();
  });

  it("uses insufficient-window branch for sortino/durbin/tail", () => {
    const out = riskBuilderFromRCore([0.05, -0.02, 0.01, -0.01], {
      oosWindowCount: 1,
    });
    expect(Number.isNaN(out.sortinoRatio)).toBe(true);
    expect(Number.isNaN(out.durbinWatson)).toBe(true);
    expect(out.tailRatio).toBeNull();
  });

  it("sets recovery factor to Infinity when there is no drawdown but positive growth", () => {
    const out = riskBuilderFromRCore([0.01, 0.02, 0.015, 0.01], { oosWindowCount: 2 });
    expect(out.recoveryFactor).toBe(Infinity);
  });

  it("sets recovery factor to 0 when flat equity and zero drawdown", () => {
    const out = riskBuilderFromRCore([0, 0, 0, 0], { oosWindowCount: 2 });
    expect(out.recoveryFactor).toBe(0);
  });

  it("uses mean return as expectancy when there are no losing trades", () => {
    const out = riskBuilderFromRCore([0.04, 0.02, 0.01], { oosWindowCount: 2 });
    expect(out.metrics.expectancy).toBeCloseTo(0.07 / 3, 10);
  });

  it("clamps gain-to-pain to the cap when loss mass is tiny vs net profit", () => {
    const out = riskBuilderFromRCore([0.2, 0.2, 0.2, -0.001], { oosWindowCount: 2 });
    expect(out.gainToPain).toBe(100);
  });

  it("exposes payoff ratio when losses and wins are both present", () => {
    const out = riskBuilderFromRCore([0.1, -0.05, 0.08, -0.04, 0.02], { oosWindowCount: 2 });
    expect(out.payoffRatio).toBeDefined();
    expect((out.payoffRatio as number) > 0).toBe(true);
  });

  it("computes durbin-watson for long samples when windows allow", () => {
    const returns = Array.from({ length: 32 }, (_, i) => (i % 3 === 0 ? -0.01 : 0.008));
    const out = riskBuilderFromRCore(returns, { oosWindowCount: 2 });
    expect(Number.isFinite(out.durbinWatson)).toBe(true);
  });

  it("sets recovery factor to NaN when max drawdown or total return is non-finite", () => {
    const out = riskBuilderFromRCore([0.04, Number.NaN, 0.02], { oosWindowCount: 2 });
    expect(Number.isNaN(out.recoveryFactor)).toBe(true);
  });

  it("uses mean return over average loss as expectancy when losses exist", () => {
    const out = riskBuilderFromRCore([-0.02, -0.03, 0.14, 0.01], { oosWindowCount: 2 });
    const mean = (-0.02 - 0.03 + 0.14 + 0.01) / 4;
    const avgLoss = (0.02 + 0.03) / 2;
    expect(out.metrics.expectancy).toBeCloseTo(mean / avgLoss, 10);
  });

  it("adds winsorized kurtosis when raw kurtosis is extreme but still finite", () => {
    const returns = Array.from({ length: 100 }, (_, i) => (i === 50 ? 0.15 : i % 2 === 0 ? 0.008 : -0.007));
    const out = riskBuilderFromRCore(returns, { oosWindowCount: 2 });
    expect(out.kurtosis).toBeGreaterThan(50);
    expect(out.kurtosisWinsorized).toBeDefined();
    expect(Number.isFinite(out.kurtosisWinsorized as number)).toBe(true);
  });
});
