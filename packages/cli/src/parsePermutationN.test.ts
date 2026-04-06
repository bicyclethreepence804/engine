import { describe, expect, it } from "vitest";

import { parsePermutationNCli, PERMUTATION_N_MAX, PERMUTATION_N_MIN } from "./parsePermutationN";

describe("parsePermutationNCli", () => {
  it("accepts bounds and integers inside range", () => {
    expect(parsePermutationNCli(String(PERMUTATION_N_MIN))).toBe(PERMUTATION_N_MIN);
    expect(parsePermutationNCli(String(PERMUTATION_N_MAX))).toBe(PERMUTATION_N_MAX);
    expect(parsePermutationNCli("1000")).toBe(1000);
  });

  it("rejects missing value", () => {
    expect(() => parsePermutationNCli(undefined)).toThrow(/requires an integer/);
  });

  it("rejects out of range with hint", () => {
    expect(() => parsePermutationNCli("50")).toThrow(/between/);
    expect(() => parsePermutationNCli("50000")).toThrow(/Got 50000/);
  });

  it("rejects non-integer", () => {
    expect(() => parsePermutationNCli("3.5")).toThrow(/integer/);
  });
});
