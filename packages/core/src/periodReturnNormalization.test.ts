import { describe, expect, it } from "vitest";
import { getPeriodReturn } from "./periodReturnNormalization";

describe("getPeriodReturn", () => {
  it("reads optimization return from nested metrics paths", () => {
    expect(
      getPeriodReturn(
        {
          metrics: {
            optimization: { totalReturn: 0.12 },
          },
        },
        "optimizationReturn",
      ),
    ).toBeCloseTo(0.12, 10);

    expect(
      getPeriodReturn(
        {
          metrics: {
            optimization: { total: 15 },
          },
        },
        "optimizationReturn",
      ),
    ).toBeCloseTo(0.15, 10);

    expect(
      getPeriodReturn(
        {
          metrics: {
            optimization: { total_return: 8 },
          } as Record<string, unknown>,
        },
        "optimizationReturn",
      ),
    ).toBeCloseTo(0.08, 10);
  });

  it("reads validation return from nested metrics and snake_case aliases", () => {
    expect(
      getPeriodReturn(
        {
          validation_return: -5,
        },
        "validationReturn",
      ),
    ).toBeCloseTo(-0.05, 10);

    expect(
      getPeriodReturn(
        {
          metrics: {
            validation: { total: -3 },
          },
        },
        "validationReturn",
      ),
    ).toBeCloseTo(-0.03, 10);
  });

  it("returns NaN when raw value does not normalize to a finite number", () => {
    expect(Number.isNaN(getPeriodReturn({ optimizationReturn: Number.NaN }, "optimizationReturn"))).toBe(
      true,
    );
  });
});
