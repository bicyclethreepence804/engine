import { describe, expect, it } from "vitest";
import { InvariantError, validateReportInvariants } from "./validateReportInvariants";

describe("validateReportInvariants", () => {
  it("returns error for null report", () => {
    const out = validateReportInvariants(null as never);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.includes("null or not an object"))).toBe(true);
  });

  it("returns ok for sparse report without contradictory fields", () => {
    const report = {
      strategy: { name: "demo" },
    };

    const out = validateReportInvariants(report as never);
    expect(out.ok).toBe(true);
    expect(out.errors).toHaveLength(0);
  });

  it("detects retention mismatch against sumOos/sumIs", () => {
    const report = {
      proBenchmarkMetrics: {
        sumIs: 0.2,
        sumOos: 0.1,
        oosRetention: 0.9, // expected 0.5
      },
    };

    const out = validateReportInvariants(report as never);
    expect(out.ok).toBe(false);
    expect(
      out.errors.some((e) => e.includes("should equal sumOos/sumIs")),
    ).toBe(true);
  });

  it("detects dataQuality block with non-zero robustness", () => {
    const report = {
      robustnessScore: {
        overall: 42,
        blockedByModule: "dataQuality",
      },
    };

    const out = validateReportInvariants(report as never);
    expect(out.ok).toBe(false);
    expect(
      out.errors.some((e) => e.includes("dataQuality") && e.includes("should be 0")),
    ).toBe(true);
  });

  it("validates numeric bounds and throw option", () => {
    const report = {
      results: { winRate: 2 },
      robustnessScore: { overall: 150 },
    };
    const out = validateReportInvariants(report as never);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.includes("winrate"))).toBe(true);
    expect(out.errors.some((e) => e.includes("robustness overall"))).toBe(true);
    expect(() => validateReportInvariants(report as never, { throw: true })).toThrow(
      InvariantError,
    );
  });

  it("detects WFE gate inconsistency when WFE is N/A", () => {
    const report = {
      proBenchmarkMetrics: { wfeValidWindowCount: 0 },
      walkForwardAnalysis: {},
      verdictPayload: {
        deploymentGate: [
          {
            label: "WFE Stability",
            notApplicable: false,
            value: 0,
            threshold: 0.5,
          },
        ],
      },
    };
    const out = validateReportInvariants(report as never);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.includes("WFE N/A"))).toBe(true);
  });

  it("detects bayesian mapping mismatch from wfaPassProbability", () => {
    const report = {
      proBenchmarkMetrics: {
        wfaPassProbability: 0.81,
      },
      verdictPayload: {
        bayesianPassProbability: 10,
      },
    };
    const out = validateReportInvariants(report as never);
    expect(out.ok).toBe(false);
    expect(
      out.errors.some((e) => e.includes("bayesianPassProbability")),
    ).toBe(true);
  });

  it("detects invalid WFE distribution order", () => {
    const report = {
      proBenchmarkMetrics: {
        wfeDistribution: { min: 0.9, median: 0.5, max: 0.6, variance: -1 },
      },
    };
    const out = validateReportInvariants(report as never);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.includes("min") && e.includes("median"))).toBe(
      true,
    );
    expect(out.errors.some((e) => e.includes("variance"))).toBe(true);
  });

  it("detects multi-window totalReturn drift and maxDD inconsistency", () => {
    const report = {
      results: { totalReturn: 0.3, winRate: 0.5 },
      walkForwardAnalysis: {
        periods: [
          { optimizationReturn: 0.2, validationReturn: 0.1 },
          { optimizationReturn: 0.1, validationReturn: 0.05 },
        ],
      },
      proBenchmarkMetrics: {
        sumOos: 0.15,
        avgOosMeanReturn: 0.03,
        avgOosCalmar: 2,
        oosMaxDrawdownFromWfa: -0.02,
        benchmarkMetricsBuckets: {
          oosEquityBased: { oosMaxDrawdown: 0 },
        },
      },
      riskAnalysis: { maxDrawdown: 0 },
    };
    const out = validateReportInvariants(report as never);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.includes("Multi-window WFA"))).toBe(true);
    expect(out.errors.some((e) => e.includes("Calmar"))).toBe(true);
  });

  it("detects registry mismatch and performanceDegradation caveat absence", () => {
    const report = {
      proBenchmarkMetrics: {
        sumIs: 0.1,
        sumOos: 0.2,
        oosRetention: 2,
        performanceDegradation: -1.2,
        metricsRegistry: { WFE: { n_used: 5, n_negative_wfe: 1, n_positive_wfe: 1 } },
      },
    };
    const out = validateReportInvariants(report as never);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.includes("metricsRegistry.WFE"))).toBe(true);
    expect(
      out.errors.some((e) => e.includes("performanceDegradationCaveats")),
    ).toBe(true);
  });

  it("detects market impact out-of-range invariant and single-run integrity issue", () => {
    const out = validateReportInvariants({
      turnoverAndCostDrag: {
        marketImpactOutOfRange: true,
        marketImpactPct: -1.5,
        totalCostDragPct: -1.2,
      },
      walkForwardAnalysis: { periods: [{ optimizationReturn: 0.1, validationReturn: 0.08 }] },
      integrityIssues: [{ message: "Total return does not match optimization return" }],
      proBenchmarkMetrics: { sumIs: -0.1 },
    } as never);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.includes("marketImpactOutOfRange"))).toBe(true);
    expect(out.errors.some((e) => e.includes("Single-run report"))).toBe(true);
  });

  it("detects WFE median consistency and retention/degradation sign rules", () => {
    const out = validateReportInvariants({
      proBenchmarkMetrics: {
        sumIs: 0.2,
        sumOos: 0.1,
        oosRetention: 1.2,
        performanceDegradation: -0.8,
        wfeDistribution: { median: 0.01 },
      },
      walkForwardAnalysis: {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.07 },
          { optimizationReturn: 0.12, validationReturn: 0.08 },
          { optimizationReturn: 0.1, validationReturn: 0.06 },
        ],
      },
    } as never);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.includes("WFE median"))).toBe(true);
    expect(out.errors.some((e) => e.includes("When mean(IS) > 0"))).toBe(true);
  });

  it("detects strategy action plan invariants for negative base sharpe", () => {
    const out = validateReportInvariants({
      strategyActionPlanPrecomputed: {
        baseSharpe: -0.5,
        slippageImpactRows: [{ slippageBps: 5 }],
        slippageBlockVerdict: "PASS",
      },
    } as never);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.includes("baseSharpe < 0"))).toBe(true);
    expect(out.errors.some((e) => e.includes("NOT_VIABLE"))).toBe(true);
  });

  it("detects paradox issue when sumIs is non-positive", () => {
    const out = validateReportInvariants({
      proBenchmarkMetrics: { sumIs: 0 },
      integrityIssues: [{ message: "Retention/Gain Paradox found" }],
    } as never);
    expect(out.ok).toBe(false);
    expect(out.errors.some((e) => e.includes("Retention/Gain Paradox"))).toBe(true);
  });
});
