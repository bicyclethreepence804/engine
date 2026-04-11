import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GOLDEN_FIXTURE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../docs/examples/monte-carlo-seed42.json",
);
const HAS_GOLDEN_FIXTURE = existsSync(GOLDEN_FIXTURE_PATH);
import { buildPathMonteCarloSimulation } from "./pathMonteCarlo";
import { computeDistributionStats } from "./pathMonteCarloDistribution";
import { percentileType7 } from "./percentile";

describe("buildPathMonteCarloSimulation", () => {
  it("is deterministic for same seed and input (§8.1)", () => {
    const pts = risingEquity(100, 130, 0);
    const a = buildPathMonteCarloSimulation(pts, {
      seed: 42,
      simulations: 1000,
      minPeriods: 10,
      horizonYears: 1,
    });
    const b = buildPathMonteCarloSimulation(pts, {
      seed: 42,
      simulations: 1000,
      minPeriods: 10,
      horizonYears: 1,
    });
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a!.cagrDistribution.p50).toBe(b!.cagrDistribution.p50);
    expect(a!.probabilityPositive).toBe(b!.probabilityPositive);
  });

  it("returns null when returns < minPeriods (§8.2)", () => {
    const pts = risingEquity(100, 105, 0);
    expect(
      buildPathMonteCarloSimulation(pts, { seed: 1, minPeriods: 30, horizonYears: 1 }),
    ).toBeNull();
  });

  it("returns null for flat equity (§8.3)", () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ value: 100, timestamp: i * 86400000 }));
    expect(buildPathMonteCarloSimulation(pts, { seed: 1, minPeriods: 10, horizonYears: 1 })).toBeNull();
  });

  it("rising path: median CAGR > 0 and high probabilityPositive (§8.4)", () => {
    const pts = risingEquity(100, 200, 0);
    const r = buildPathMonteCarloSimulation(pts, {
      seed: 42,
      simulations: 1000,
      minPeriods: 10,
      horizonYears: 1,
    });
    expect(r).not.toBeNull();
    expect(r!.cagrDistribution.p50).toBeGreaterThan(0);
    expect(r!.probabilityPositive).toBeGreaterThan(0.9);
    expect(r!.meta.simulationsRun).toBe(1000);
    expect(r!.meta.periodsUsed).toBe(99);
    expect(r!.meta.ruinousPathCount).toBeGreaterThanOrEqual(0);
  });

  it("declining path: median CAGR < 0 and low probabilityPositive (§8.5)", () => {
    const values: number[] = [];
    let v = 100;
    for (let i = 0; i < 50; i++) {
      values.push(v);
      // Vary decay so period returns are not constant (std > 0).
      v *= 0.9 + (i % 5) * 0.01;
    }
    values.push(v);
    const pts = values.map((value, i) => ({ value, timestamp: i * 86400000 }));
    const r = buildPathMonteCarloSimulation(pts, {
      seed: 1,
      simulations: 500,
      minPeriods: 10,
      horizonYears: 1,
    });
    expect(r).not.toBeNull();
    expect(r!.cagrDistribution.p50).toBeLessThan(0);
    expect(r!.probabilityPositive).toBeLessThan(0.35);
  });

  it.skipIf(!HAS_GOLDEN_FIXTURE)("golden fixture regression (§8.6)", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(GOLDEN_FIXTURE_PATH, "utf8");
    const doc = JSON.parse(raw) as {
      input: {
        equityPoints: { value: number; timestamp?: number }[];
        options: Record<string, unknown>;
      };
      expected: { cagrDistribution: { p50: number }; meta: { simulationsRun: number } };
    };
    const r = buildPathMonteCarloSimulation(doc.input.equityPoints, doc.input.options as never);
    expect(r).not.toBeNull();
    expect(r!.cagrDistribution.p50).toBeCloseTo(doc.expected.cagrDistribution.p50, 6);
    expect(r!.meta.simulationsRun).toBe(doc.expected.meta.simulationsRun);
  });
});

describe("percentileType7 spot checks vs R type 7 (§8.7)", () => {
  it("matches R quantile(1:10, type=7) spot values", () => {
    const xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileType7(xs, 0.25)).toBeCloseTo(3.25, 10);
    expect(percentileType7(xs, 0.75)).toBeCloseTo(7.75, 10);
    expect(percentileType7(xs, 0.5)).toBeCloseTo(5.5, 10);
  });
});

describe("computeDistributionStats (§8.8)", () => {
  it("mean and std for fixed vector", () => {
    const xs = [0.01, -0.02, 0.03, -0.01, 0.02, 0.0, -0.03, 0.01, 0.02, -0.01];
    const s = computeDistributionStats(xs);
    expect(s.mean).toBeCloseTo(0.002, 10);
    expect(s.std).toBeCloseTo(0.019322, 4);
  });

  it("CVaR tail matches Type-7 VaR cutoff (mean of x <= p5)", () => {
    const xs = [-0.2, -0.15, -0.05, 0.01, 0.02, 0.03, 0.04, 0.05];
    const s = computeDistributionStats(xs);
    const sorted = [...xs].sort((a, b) => a - b);
    const p5 = percentileType7(sorted, 0.05);
    const tail = sorted.filter((x) => x <= p5);
    const expectedCvar = -(tail.reduce((a, b) => a + b, 0) / tail.length);
    expect(s.cvar95).toBeCloseTo(expectedCvar, 10);
  });

  it("skewness and excess kurtosis stable on fixed vector (sample G1 / excess kurtosis)", () => {
    const xs = [0.01, -0.02, 0.03, -0.01, 0.02, 0.0, -0.03, 0.01, 0.02, -0.01];
    const s = computeDistributionStats(xs);
    expect(s.skewness).toBeCloseTo(-0.23567, 4);
    expect(s.kurtosis).toBeCloseTo(-0.96142, 4);
    expect(s.varCornishFisher95).toBeCloseTo(0.03143, 4);
  });
});

function risingEquity(start: number, endExclusive: number, t0: number) {
  const pts: { value: number; timestamp: number }[] = [];
  for (let v = start; v < endExclusive; v++) {
    pts.push({ value: v, timestamp: t0 + (v - start) * 86400000 });
  }
  return pts;
}
