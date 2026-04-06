import { describe, expect, it } from "vitest";
import { calcDegradation, calcRetention } from "./performanceRatios";

describe("calcRetention", () => {
  it("returns null for empty inputs or undefined mean IS", () => {
    expect(calcRetention([], [0.1])).toBeNull();
    expect(calcRetention([0.05], [])).toBeNull();
    expect(calcRetention([0.02, -0.02], [1e-11, -1e-11])).toBeNull();
  });

  it("returns mean OOS over mean IS when defined", () => {
    expect(calcRetention([0.06, 0.04], [0.1, 0.1])).toBeCloseTo(0.5, 10);
  });
});

describe("calcDegradation", () => {
  it("returns null when mean IS is near zero or arrays empty", () => {
    expect(calcDegradation([0.1], [])).toBeNull();
    expect(calcDegradation([0.01, -0.01], [5e-11, -5e-11])).toBeNull();
  });

  it("computes relative change vs |mean IS|", () => {
    expect(calcDegradation([0.05, 0.05], [0.1, 0.1])).toBeCloseTo(-0.5, 10);
  });
});
