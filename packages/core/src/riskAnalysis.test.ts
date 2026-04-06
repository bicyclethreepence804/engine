import { describe, expect, it } from "vitest";
import { buildCanonicalR, computeTailRatio, riskBuilderFromR } from "./riskAnalysis";

describe("riskAnalysis facade", () => {
  it("builds canonical returns from oos trades", () => {
    const out = buildCanonicalR([
      { net_return: 0.1 },
      { pnl_pct: -5 },
      { pnl_pct: 15 },
    ] as never);
    expect(out.length).toBe(3);
  });

  it("computes finite tail ratio for non-empty sample", () => {
    const ratio = computeTailRatio(0.05, 0.2);
    expect(typeof ratio).toBe("number");
    expect(Number.isFinite(ratio as number)).toBe(true);
  });

  it("returns risk result merged with narratives", () => {
    const out = riskBuilderFromR([0.1, -0.05, 0.08, -0.02], { oosWindowCount: 2 });
    expect(out).toBeDefined();
    expect(typeof out.maxDrawdown).toBe("number");
    expect("riskVerdict" in (out as Record<string, unknown>)).toBe(true);
  });
});
