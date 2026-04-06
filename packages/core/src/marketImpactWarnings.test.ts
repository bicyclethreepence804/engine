import { describe, expect, it } from "vitest";
import { computeMarketImpactWarnings } from "./marketImpactWarnings";

describe("computeMarketImpactWarnings", () => {
  it("warns when market impact CAGR exceeds 100% of capital", () => {
    const w = computeMarketImpactWarnings(1.2, 50_000);
    expect(w.some((s) => s.includes("exceeds 100%"))).toBe(true);
  });

  it("warns when ADV is very low", () => {
    const w = computeMarketImpactWarnings(0.01, 5_000);
    expect(w.some((s) => s.includes("ADV"))).toBe(true);
    expect(w.some((s) => s.includes("very low"))).toBe(true);
  });

  it("returns empty array when inputs are not concerning", () => {
    expect(computeMarketImpactWarnings(0.1, 100_000)).toEqual([]);
  });
});
