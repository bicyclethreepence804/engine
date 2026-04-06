import { describe, expect, it } from "vitest";
import { computeFinalVerdict, VERDICT_ALGORITHM_VERSION } from "./finalVerdictEngine";

describe("computeFinalVerdict", () => {
  it("returns deterministic rejected verdict for minimal weak input", () => {
    const out = computeFinalVerdict({
      strategy: {
        testPeriodStart: "2024-01-01",
        testPeriodEnd: "2024-02-01",
      },
      walkForwardAnalysis: {
        windows: [],
        failedWindows: { count: 0, total: 0 },
        overfittingRisk: { score: 0 },
      },
      turnoverAndCostDrag: {
        avgTradesPerMonth: 0,
      },
      riskAnalysis: {},
      benchmarkComparison: {},
      proBenchmarkMetrics: {},
      robustnessScore: { overall: 10 },
    } as never);

    expect(out.version).toBe(VERDICT_ALGORITHM_VERSION);
    expect(out.caseType).toBe("STATISTICAL_GHOST");
    expect(out.verdict).toBe("REJECTED");
    expect(out.badge).toBe("🔴");
    expect(Array.isArray(out.deploymentGate)).toBe(true);
  });
});
