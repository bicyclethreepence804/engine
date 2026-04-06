import { describe, expect, it } from "vitest";
import { runSummaryBlockEngine } from "./summaryBlockEngine";

describe("runSummaryBlockEngine", () => {
  it("marks report as non-allocatable on execution bleed", () => {
    const out = runSummaryBlockEngine({
      turnoverAndCostDrag: { avgNetProfitPerTradeBps: -3 },
    } as never);

    expect(out.allocatable).toBe(false);
    expect(out.operationalLines.length).toBeGreaterThan(0);
    expect(out.executiveSummaryParagraph).toContain("Not Allocatable");
  });

  it("keeps allocatable=true for clean sparse input", () => {
    const out = runSummaryBlockEngine({} as never);
    expect(out.allocatable).toBe(true);
    expect(out.checks).toHaveLength(0);
  });

  it("collects integrity/statistical diagnostics and forces non-allocatable", () => {
    const out = runSummaryBlockEngine({
      benchmarkComparison: {
        zeroDrawdownWarning: true,
        strategyCAGR: 0.2,
      },
      riskAnalysis: {
        maxDrawdown: 0,
        kurtosis: 8,
      },
      proBenchmarkMetrics: {
        regimeSurvivalMatrix: {
          Trend: { pass: false },
          Range: { pass: false },
          HighVol: { pass: false },
        },
        edgeHalfLife: { days: 5 },
      },
      walkForwardAnalysis: {
        paramDrift: "High",
      },
    } as never);

    expect(out.allocatable).toBe(false);
    expect(out.integrityLines.length).toBeGreaterThan(0);
    expect(out.statisticalLines.length).toBeGreaterThan(0);
    expect(out.recommendationLines.length).toBeGreaterThan(0);
  });

  it("maps explicit robust verdict label into summary paragraph", () => {
    const out = runSummaryBlockEngine({} as never, "ROBUST");
    expect(out.executiveSummaryParagraph).toContain("[Diagnostic Verdict: ROBUST]");
  });
});
