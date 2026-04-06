import { describe, expect, it } from "vitest";
import { KiploksValidationError } from "@kiploks/engine-contracts";

import {
  buildWfeResult,
  computeAverageRanks,
  computePermutationPValue,
  computeRankWfe,
} from "./wfeCalculator";

describe("computeAverageRanks", () => {
  it("assigns 1-based average ranks with ties", () => {
    expect(computeAverageRanks([1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
    expect(computeAverageRanks([3, 1, 2])).toEqual([3, 1, 2]);
    expect(computeAverageRanks([5, 5, 5])).toEqual([2, 2, 2]);
    expect(computeAverageRanks([1, 3, 3, 5])).toEqual([1, 2.5, 2.5, 4]);
  });

  it("rejects non-finite values", () => {
    expect(() => computeAverageRanks([1, Number.NaN])).toThrow(KiploksValidationError);
  });
});

describe("computeRankWfe", () => {
  it("requires equal length and at least 2 windows", () => {
    expect(() => computeRankWfe([0.1], [0.2])).toThrow(KiploksValidationError);
    expect(() => computeRankWfe([0.1, 0.2], [0.2])).toThrow(KiploksValidationError);
  });

  it("is 1 when IS and OOS share the same within-sample rank order", () => {
    const is = [0.1, 0.05, 0.08];
    const oos = [0.12, 0.09, 0.11];
    expect(computeRankWfe(is, oos)).toBe(1);
  });

  it("exceeds 1 when low-IS windows pair with high-OOS ranks (rank transfer)", () => {
    const is = [0.3, 0.1, 0.2];
    const oos = [0.05, 0.2, 0.09];
    expect(computeRankWfe(is, oos)).toBeCloseTo(1.4444444444444444, 6);
  });

  it("handles identical IS returns via tie ranks", () => {
    const is = [0.1, 0.1, 0.1];
    const oos = [0.2, 0.1, 0.05];
    const r = computeRankWfe(is, oos);
    expect(Number.isFinite(r)).toBe(true);
  });
});

describe("computePermutationPValue", () => {
  it("is deterministic for fixed seed and n", () => {
    const is = [0.08, 0.12, 0.05, 0.15, 0.09];
    const oos = [0.07, 0.11, 0.04, 0.13, 0.08];
    const a = computePermutationPValue(is, oos, 42, 1000);
    const b = computePermutationPValue(is, oos, 42, 1000);
    expect(a).toBe(b);
  });
});

describe("buildWfeResult", () => {
  it("returns full WFEResult shape", () => {
    const is = [0.1, 0.12];
    const oos = [0.09, 0.11];
    const r = buildWfeResult(is, oos, 7, 500);
    expect(r.windowCount).toBe(2);
    expect(r.permutationN).toBe(500);
    expect(r.seed).toBe(7);
    expect(typeof r.rankWfe).toBe("number");
    expect(typeof r.permutationPValue).toBe("number");
    expect(["ROBUST", "ACCEPTABLE", "WEAK", "FAIL"]).toContain(r.verdict);
  });
});
