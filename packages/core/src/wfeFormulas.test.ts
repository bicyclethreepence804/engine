import { describe, expect, it } from "vitest";
import { calcWfeCvar95 } from "./wfeFormulas";

describe("calcWfeCvar95", () => {
  it("returns null for empty returns", () => {
    expect(calcWfeCvar95([])).toBeNull();
  });

  it("returns mean of worst tail for small N", () => {
    const xs = [0.05, -0.01, -0.02, -0.03, -0.04];
    const v = calcWfeCvar95(xs);
    expect(v).not.toBeNull();
    expect(v as number).toBeLessThanOrEqual(-0.01);
  });

  it("returns null when tail mean is not finite", () => {
    expect(calcWfeCvar95([Number.NaN, Number.NaN, Number.NaN, Number.NaN, Number.NaN])).toBeNull();
  });
});
