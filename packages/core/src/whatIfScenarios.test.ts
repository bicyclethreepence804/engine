import { describe, expect, it } from "vitest";
import {
  buildWhatIfScenarios,
  buildWhatIfScenariosFallback,
} from "./whatIfScenarios";

describe("whatIfScenarios", () => {
  it("builds scenario table with baseline row", () => {
    const rows = buildWhatIfScenarios(
      [{ profit: 10 }, { profit: -4 }, { profit: 8 }, { profit: -2 }, { profit: 6 }],
      {
        robustnessScore: { overall: 45, potentialOverall: 66 },
        turnoverAndCostDrag: { grossEdgeBps: 40 },
      },
      { modules: [], finalScore: 1, verdict: "PASS", blocked: false, factor: 1, contribution: 40, isCriticalFailure: false },
      {
        currentVerdict: "FAIL",
        candles: Array.from({ length: 20 }, (_, i) => ({
          open: 100 + i,
          high: 102 + i,
          low: 99 + i,
          close: 101 + i,
        })),
      },
    );
    expect(rows.length).toBeGreaterThan(3);
    expect(rows[0]?.scenario).toBe("Current Test");
  });

  it("builds fallback scenarios only for low robustness", () => {
    const low = buildWhatIfScenariosFallback(
      { robustnessScore: { overall: 20 } },
      "FAIL",
    );
    const high = buildWhatIfScenariosFallback(
      { robustnessScore: { overall: 70 } },
      "ROBUST",
    );
    expect(low).toHaveLength(3);
    expect(high).toHaveLength(0);
  });

  it("handles blocked zero-robustness branch with potentialOverall hint", () => {
    const rows = buildWhatIfScenarios(
      [{ pnl: 3 }, { pnl: -1 }, { pnl: 2 }, { pnl: -0.5 }],
      {
        robustnessScore: { overall: 0, potentialOverall: 41 },
        turnoverAndCostDrag: { grossEdgeBps: 5 },
      },
      { modules: [], finalScore: 0, verdict: "FAIL", blocked: true, factor: 0, contribution: 0, isCriticalFailure: true },
      { currentVerdict: "FAIL" },
    );

    const zeroSlip = rows.find((r) => r.scenario === "Zero Slippage");
    expect(zeroSlip).toBeDefined();
    expect(zeroSlip?.action).toContain("unblocked");
  });

  it("builds black-swan no-loss branch when all profits positive", () => {
    const rows = buildWhatIfScenarios(
      [{ profit_abs: 5 }, { profit_abs: 4 }, { profit_abs: 3 }, { profit_abs: 2 }],
      { robustnessScore: { overall: 60 }, turnoverAndCostDrag: { grossEdgeBps: 30 } },
      { modules: [], finalScore: 1, verdict: "PASS", blocked: false, factor: 1, contribution: 30, isCriticalFailure: false },
      { currentVerdict: "ROBUST" },
    );

    const swan = rows.find((r) => r.scenario.includes("Black Swan"));
    expect(swan).toBeDefined();
    expect(swan?.action).toContain("No losing trades");
  });
});
