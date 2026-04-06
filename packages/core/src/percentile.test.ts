import { describe, expect, it } from "vitest";
import { percentileType7 } from "./percentile";

describe("percentileType7", () => {
  it("returns NaN for empty sample", () => {
    expect(Number.isNaN(percentileType7([], 0.5))).toBe(true);
  });

  it("returns sole element when N is 1", () => {
    expect(percentileType7([42], 0.5)).toBe(42);
  });
});
