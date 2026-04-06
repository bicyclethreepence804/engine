import { describe, expect, it } from "vitest";
import type { WFAWindowMetrics } from "../canonicalMetrics";
import { computeOOSRetention } from "./oosRetention";
import { computePerformanceDegradation } from "./performanceDegradation";
import { computeWFEMetric_v2 } from "./wfe";

function windowMetrics(isReturn: number, oosReturn: number, window: number): WFAWindowMetrics {
  const block = (totalReturn: number) => ({
    totalReturn,
    sharpeRatio: 0,
    profitFactor: 1,
    maxDrawdown: -0.1,
    totalTrades: 10,
    winRate: 0.5,
  });
  return {
    window,
    dateRange: { start: "2024-01-01", end: "2024-02-01" },
    source: "wfa_window",
    isMetrics: block(isReturn),
    oosMetrics: block(oosReturn),
    sharpeRetention: null,
    returnRetention: null,
  };
}

describe("layer25 computeOOSRetention", () => {
  it("returns N/A for insufficient windows", () => {
    const out = computeOOSRetention([windowMetrics(0.1, 0.05, 1)]);
    expect(out.value).toBeNull();
    expect(out.verdict).toBe("N/A");
    expect(out.caveats?.some((c) => c.includes("Insufficient"))).toBe(true);
  });

  it("returns N/A when all IS returns are non-finite", () => {
    const out = computeOOSRetention([
      windowMetrics(Number.NaN, 0.1, 1),
      windowMetrics(Number.NaN, 0.05, 2),
    ]);
    expect(out.value).toBeNull();
    expect(out.verdict).toBe("N/A");
  });

  it("maps verdict bands when mean IS > 0", () => {
    expect(computeOOSRetention([windowMetrics(0.1, -0.2, 1), windowMetrics(0.1, -0.2, 2)]).verdict).toBe(
      "KILL",
    );
    expect(computeOOSRetention([windowMetrics(0.1, 0.015, 1), windowMetrics(0.1, 0.015, 2)]).verdict).toBe(
      "FAIL",
    );
    expect(computeOOSRetention([windowMetrics(0.1, 0.04, 1), windowMetrics(0.1, 0.04, 2)]).verdict).toBe(
      "WARN",
    );
    expect(computeOOSRetention([windowMetrics(0.1, 0.08, 1), windowMetrics(0.1, 0.08, 2)]).verdict).toBe(
      "PASS",
    );
  });

  it("returns N/A with caveat when mean IS is not positive", () => {
    const out = computeOOSRetention([windowMetrics(-0.1, 0.02, 1), windowMetrics(-0.1, 0.02, 2)]);
    expect(out.verdict).toBe("N/A");
    expect(String(out.caveats?.join(" "))).toContain("Mean IS negative");
  });

  it("returns N/A when mean IS is near zero and retention is undefined", () => {
    const out = computeOOSRetention([windowMetrics(5e-10, 0.01, 1), windowMetrics(-5e-10, 0.02, 2)]);
    expect(out.value).toBeNull();
    expect(out.verdict).toBe("N/A");
    expect(String(out.caveats?.join(" "))).toContain("Mean IS ~0");
  });
});

describe("layer25 computeWFEMetric_v2", () => {
  it("returns N/A for insufficient periods", () => {
    const out = computeWFEMetric_v2([windowMetrics(0.1, 0.05, 1)]);
    expect(out.value).toBeNull();
    expect(out.verdict).toBe("N/A");
  });

  it("classifies recovery and double-negative windows", () => {
    const out = computeWFEMetric_v2([
      windowMetrics(0.1, 0.06, 1),
      windowMetrics(0.1, 0.07, 2),
      windowMetrics(0.1, 0.05, 3),
      windowMetrics(-0.05, 0.02, 4),
      windowMetrics(-0.05, -0.02, 5),
    ]);
    expect(out.wfeWindowClassification?.recovery).toBe(1);
    expect(out.wfeWindowClassification?.doubleNegative).toBe(1);
    expect(out.value).not.toBeNull();
  });

  it("returns N/A when no positive IS windows", () => {
    const out = computeWFEMetric_v2([
      windowMetrics(-0.1, 0.02, 1),
      windowMetrics(-0.1, -0.02, 2),
    ]);
    expect(out.value).toBeNull();
    expect(String(out.caveats?.[0])).toContain("No windows with positive IS");
  });

  it("returns N/A when fewer than 3 positive-IS windows", () => {
    const out = computeWFEMetric_v2([
      windowMetrics(0.1, 0.05, 1),
      windowMetrics(0.1, 0.06, 2),
      windowMetrics(-0.1, 0.01, 3),
    ]);
    expect(out.value).toBeNull();
    expect(out.wfeValidWindowCount).toBe(2);
  });

  it("sets FAIL when median WFE is negative", () => {
    const out = computeWFEMetric_v2([
      windowMetrics(0.1, -0.05, 1),
      windowMetrics(0.1, -0.01, 2),
      windowMetrics(0.1, 0.08, 3),
    ]);
    expect(out.value).not.toBeNull();
    expect(out.value as number).toBeLessThan(0);
    expect(out.verdict).toBe("FAIL");
  });

  it("computes distribution stats for three positive-IS windows", () => {
    const out = computeWFEMetric_v2([
      windowMetrics(0.1, 0.05, 1),
      windowMetrics(0.1, 0.06, 2),
      windowMetrics(0.1, 0.07, 3),
    ]);
    expect(out.value).not.toBeNull();
    expect(out.wfeDistribution?.min).toBeDefined();
    expect(out.wfeDistribution?.max).toBeDefined();
    expect(out.profitableAmongPositiveIsCount).toBe(3);
  });

  it("uses WARN verdict when median WFE is between 0.2 and 0.5", () => {
    const out = computeWFEMetric_v2([
      windowMetrics(0.1, 0.03, 1),
      windowMetrics(0.1, 0.03, 2),
      windowMetrics(0.1, 0.03, 3),
    ]);
    expect(out.verdict).toBe("WARN");
    expect((out.value as number) >= 0.2 && (out.value as number) < 0.5).toBe(true);
  });

  it("uses PASS verdict when median WFE is at least 0.5", () => {
    const out = computeWFEMetric_v2([
      windowMetrics(0.1, 0.08, 1),
      windowMetrics(0.1, 0.08, 2),
      windowMetrics(0.1, 0.08, 3),
    ]);
    expect(out.verdict).toBe("PASS");
  });

  it("uses even-count median when four positive-IS windows", () => {
    const out = computeWFEMetric_v2([
      windowMetrics(0.1, 0.05, 1),
      windowMetrics(0.1, 0.06, 2),
      windowMetrics(0.1, 0.07, 3),
      windowMetrics(0.1, 0.08, 4),
    ]);
    expect(out.value).not.toBeNull();
    expect(out.wfeDistribution?.median).toBe(out.value);
  });

  it("counts flat IS windows as undefined classification", () => {
    const out = computeWFEMetric_v2([
      windowMetrics(1e-12, 0.01, 1),
      windowMetrics(0.1, 0.05, 2),
      windowMetrics(0.1, 0.06, 3),
      windowMetrics(0.1, 0.07, 4),
    ]);
    expect(out.wfeWindowClassification?.undefined).toBeGreaterThanOrEqual(1);
    expect(out.value).not.toBeNull();
  });

  it("uses FAIL when median WFE is positive but below 0.2", () => {
    const out = computeWFEMetric_v2([
      windowMetrics(0.1, 0.01, 1),
      windowMetrics(0.1, 0.015, 2),
      windowMetrics(0.1, 0.012, 3),
    ]);
    expect(out.verdict).toBe("FAIL");
    expect((out.value as number) >= 0).toBe(true);
  });

  it("counts non-numeric window metrics as undefined", () => {
    const bad = {
      ...windowMetrics(0.1, 0.05, 9),
      isMetrics: { ...windowMetrics(0.1, 0.05, 9).isMetrics, totalReturn: "x" as unknown as number },
    } as WFAWindowMetrics;
    const out = computeWFEMetric_v2([bad, windowMetrics(0.1, 0.06, 1), windowMetrics(0.1, 0.07, 2), windowMetrics(0.1, 0.08, 3)]);
    expect(out.wfeWindowClassification?.undefined).toBeGreaterThanOrEqual(1);
    expect(out.value).not.toBeNull();
  });
});

describe("layer25 computePerformanceDegradation", () => {
  it("returns N/A for insufficient windows", () => {
    const out = computePerformanceDegradation([windowMetrics(0.1, 0.05, 1)]);
    expect(out.value).toBeNull();
  });

  it("returns N/A when IS or OOS return lists are empty after filtering", () => {
    const nanIs = {
      ...windowMetrics(0.1, 0.05, 1),
      isMetrics: { ...windowMetrics(0.1, 0.05, 1).isMetrics, totalReturn: Number.NaN },
    } as WFAWindowMetrics;
    expect(computePerformanceDegradation([nanIs, nanIs]).value).toBeNull();
    const nanOos = {
      ...windowMetrics(0.1, 0.05, 1),
      oosMetrics: { ...windowMetrics(0.1, 0.05, 1).oosMetrics, totalReturn: Number.NaN },
    } as WFAWindowMetrics;
    expect(computePerformanceDegradation([nanOos, nanOos]).value).toBeNull();
  });

  it("returns N/A with caveat when mean IS is near zero", () => {
    const out = computePerformanceDegradation([
      windowMetrics(5e-10, 0.01, 1),
      windowMetrics(-5e-10, 0.02, 2),
    ]);
    expect(out.value).toBeNull();
    expect(String(out.caveats?.join(" "))).toContain("Mean IS ~0");
  });

  it("adds caveat when degradation below -1", () => {
    const out = computePerformanceDegradation([
      windowMetrics(0.1, -0.35, 1),
      windowMetrics(0.1, -0.35, 2),
    ]);
    expect(out.value).not.toBeNull();
    expect((out.value as number) < -1).toBe(true);
    expect(out.caveats?.some((c) => c.includes("opposite signs"))).toBe(true);
  });
});
