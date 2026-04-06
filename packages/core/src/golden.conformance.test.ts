import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  benchmarkNetEdgeBpsFromMeanExcess,
  buildBenchmarkFallbackComparison,
  excessReturnsPerPeriod,
  meanOfNumbers,
  periodReturnsFromStrategyBtcAligned,
  type StrategyBtcAlignedPoint,
} from "./benchmarkCore";
import { riskBuilderFromRCore } from "./riskCore";
import {
  classifyTurnoverPrimaryConstraint,
  computeSlippageSensitivityRows,
  computeTradeReturnZScore,
} from "./turnoverCore";
import { fixtureFingerprint } from "./vectorFixtureFingerprint";
import { buildWfeResult } from "./wfa/wfeCalculator";
import { resolveEngineTestVectorsRoot } from "./testPaths";

type RiskVector = {
  schemaVersion: number;
  suite: "risk";
  name: string;
  input: { R: number[]; options?: { oosWindowCount?: number } };
  expected: {
    approx?: Record<string, number>;
    approxDigits?: number;
    exact?: Record<string, unknown>;
    /** Top-level numeric fields that must be `NaN` (e.g. empty `R` early return). */
    expectNan?: string[];
    /** `result.metrics` fields that must be `NaN`. */
    expectMetricsNan?: string[];
  };
};

type BenchmarkMeanExcessVector = {
  schemaVersion: number;
  suite: "benchmark";
  name: string;
  input: {
    aligned: StrategyBtcAlignedPoint[];
    commissionDecimal: number;
    slippageDecimal: number;
  };
  expected: { approx?: Record<string, number>; approxDigits?: number };
};

type BenchmarkFallbackVector = {
  schemaVersion: number;
  suite: "benchmark";
  name: string;
  input: {
    totalReturn: number;
    btcKlines: Array<{ timestamp: number; close: number }>;
    years: number;
    commissionDecimal: number;
    slippageDecimal: number;
  };
  expected: { exact?: Record<string, unknown> };
};

type WfeRankedV2Vector = {
  schemaVersion: number;
  suite: "wfe";
  name: string;
  input: {
    isReturns: number[];
    oosReturns: number[];
    seed: number;
    permutationN: number;
  };
  expected: {
    approx?: Record<string, number>;
    approxDigits?: number;
    exact?: Record<string, unknown>;
    metadata?: { fixtureHash?: string };
  };
};

type TurnoverBundleVector = {
  schemaVersion: number;
  suite: "turnover";
  name: string;
  cases: Array<{
    id: string;
    tradeReturnBps?: number[];
    primaryInput?: Parameters<typeof classifyTurnoverPrimaryConstraint>[0];
    slippageInput?: Parameters<typeof computeSlippageSensitivityRows>[0];
    expected: {
      approx?: Record<string, number>;
      approxDigits?: number;
      exact?: Record<string, unknown>;
      /** When true, `computeTradeReturnZScore` must be NaN (e.g. one trade or zero std). */
      expectZScoreNaN?: boolean;
    };
  }>;
};

async function loadV2Vectors(): Promise<string[]> {
  const dir = path.join(resolveEngineTestVectorsRoot(), "v2");
  const entries = await readdir(dir);
  return entries.filter((f) => f.endsWith(".json")).map((f) => path.join(dir, f));
}

function assertApprox(
  actual: number,
  expected: number,
  label: string,
  digits: number,
): void {
  expect(Number.isFinite(actual), `${label} finite`).toBe(true);
  expect(actual, label).toBeCloseTo(expected, digits);
}

describe("Conformance: golden vectors v2 (risk, benchmark, turnover, wfe)", () => {
  it("matches all JSON fixtures under test-vectors/v2", async () => {
    const files = await loadV2Vectors();
    expect(files.length).toBeGreaterThan(0);

    for (const filePath of files) {
      const doc = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
      const expectedBlock = doc.expected;
      if (expectedBlock !== null && typeof expectedBlock === "object") {
        const md = (expectedBlock as Record<string, unknown>).metadata;
        if (md !== null && typeof md === "object" && "fixtureHash" in md) {
          expect(fixtureFingerprint(doc)).toBe(String((md as Record<string, unknown>).fixtureHash));
        }
      }

      const raw = doc as {
        schemaVersion: number;
        suite: string;
        name: string;
      };

      if (raw.schemaVersion !== 1) {
        throw new Error(`Unsupported schemaVersion in ${filePath}`);
      }

      if (raw.suite === "risk") {
        const v = raw as RiskVector;
        const result = riskBuilderFromRCore(v.input.R, v.input.options);
        const digits = v.expected.approxDigits ?? 5;
        if (v.expected.expectNan?.length) {
          for (const key of v.expected.expectNan) {
            const act = result[key as keyof typeof result];
            expect(Number.isNaN(act as number), `${v.name}.${key} should be NaN`).toBe(true);
          }
        }
        if (v.expected.expectMetricsNan?.length) {
          for (const key of v.expected.expectMetricsNan) {
            const act = result.metrics[key as keyof typeof result.metrics];
            expect(Number.isNaN(act as number), `${v.name}.metrics.${key} should be NaN`).toBe(true);
          }
        }
        if (v.expected.approx) {
          for (const [key, exp] of Object.entries(v.expected.approx)) {
            const act = result[key as keyof typeof result];
            if (typeof act === "number") assertApprox(act, exp, `${v.name}.${key}`, digits);
          }
        }
        if (v.expected.exact) {
          const { metrics, ...rest } = v.expected.exact as {
            metrics?: { profitFactor: number; winRate: number };
            oosWindowCount?: number;
            totalTrades?: number;
            analysis_engine_version?: string;
          };
          if (metrics) expect(result.metrics).toMatchObject(metrics);
          if (rest.oosWindowCount !== undefined)
            expect(result.oosWindowCount).toBe(rest.oosWindowCount);
          if (rest.totalTrades !== undefined) expect(result.totalTrades).toBe(rest.totalTrades);
          if (rest.analysis_engine_version !== undefined)
            expect(result.analysis_engine_version).toBe(rest.analysis_engine_version);
        }
        continue;
      }

      if (
        raw.suite === "benchmark" &&
        (raw.name === "mean-excess-net-edge" || raw.name === "mean-excess-flat")
      ) {
        const v = raw as BenchmarkMeanExcessVector;
        const { strategyReturns, btcReturns } = periodReturnsFromStrategyBtcAligned(v.input.aligned);
        const excess = excessReturnsPerPeriod(strategyReturns, btcReturns);
        const meanExcess = meanOfNumbers(excess);
        const netBps = benchmarkNetEdgeBpsFromMeanExcess(
          meanExcess,
          v.input.commissionDecimal,
          v.input.slippageDecimal,
        );
        const digits = v.expected.approxDigits ?? 2;
        if (v.expected.approx?.meanExcessPerPeriod != null) {
          assertApprox(meanExcess, v.expected.approx.meanExcessPerPeriod, `${v.name}.meanExcess`, digits);
        }
        if (v.expected.approx?.netEdgeBps != null && netBps !== undefined) {
          assertApprox(netBps, v.expected.approx.netEdgeBps, `${v.name}.netEdgeBps`, digits);
        }
        continue;
      }

      if (raw.suite === "benchmark" && raw.name === "fallback-one-year") {
        const v = raw as BenchmarkFallbackVector;
        const out = buildBenchmarkFallbackComparison({
          totalReturn: v.input.totalReturn,
          btcKlines: v.input.btcKlines,
          years: v.input.years,
          commissionDecimal: v.input.commissionDecimal,
          slippageDecimal: v.input.slippageDecimal,
        });
        if (v.expected.exact) {
          expect(out.strategyCAGR).toBe(v.expected.exact.strategyCAGR);
          expect(out.btcCAGR).toBe(v.expected.exact.btcCAGR);
          expect(out.excessReturn).toBe(v.expected.exact.excessReturn);
          expect(out.informationRatio).toBe(v.expected.exact.informationRatio);
          expect(out.correlationToBTC).toBe(v.expected.exact.correlationToBTC);
          expect(out.feesPerTrade).toBe(v.expected.exact.feesPerTrade);
          expect(out.slippagePerTrade).toBe(v.expected.exact.slippagePerTrade);
        }
        continue;
      }

      if (raw.suite === "wfe" && raw.name === "ranked-v2") {
        const v = raw as WfeRankedV2Vector;
        const out = buildWfeResult(
          v.input.isReturns,
          v.input.oosReturns,
          v.input.seed,
          v.input.permutationN,
        );
        const digits = v.expected.approxDigits ?? 5;
        if (v.expected.approx) {
          for (const [key, exp] of Object.entries(v.expected.approx)) {
            const act = out[key as keyof typeof out];
            if (typeof act === "number") assertApprox(act, exp, `${v.name}.${key}`, digits);
          }
        }
        if (v.expected.exact) {
          expect(out.permutationN).toBe(v.expected.exact.permutationN);
          expect(out.windowCount).toBe(v.expected.exact.windowCount);
          expect(out.seed).toBe(v.expected.exact.seed);
          expect(out.verdict).toBe(v.expected.exact.verdict);
          expect(out.compositeScore).toBe(v.expected.exact.compositeScore);
        }
        continue;
      }

      if (raw.suite === "turnover") {
        const v = raw as TurnoverBundleVector;
        for (const c of v.cases) {
          if (c.tradeReturnBps) {
            const z = computeTradeReturnZScore(c.tradeReturnBps);
            if (c.expected.expectZScoreNaN) {
              expect(Number.isNaN(z), `${c.id}.zScore should be NaN`).toBe(true);
            } else {
              const d = c.expected.approxDigits ?? 5;
              if (c.expected.approx?.zScore != null)
                assertApprox(z, c.expected.approx.zScore, `${c.id}.zScore`, d);
            }
          }
          if (c.primaryInput) {
            const p = classifyTurnoverPrimaryConstraint(c.primaryInput);
            expect(p).toBe(c.expected.exact?.primaryConstraint);
          }
          if (c.slippageInput) {
            const rows = computeSlippageSensitivityRows(c.slippageInput);
            expect(rows.length).toBe(c.expected.exact?.rowCount);
            expect(rows[0]?.aum).toBe(c.expected.exact?.firstAum);
            if (c.expected.approx?.firstNetCagrPct != null && rows[0]) {
              assertApprox(
                rows[0].netCagrPct as number,
                c.expected.approx.firstNetCagrPct,
                `${c.id}.firstNetCagrPct`,
                c.expected.approxDigits ?? 5,
              );
            }
          }
        }
        continue;
      }

      throw new Error(`Unknown suite/name in ${filePath}: ${raw.suite} / ${raw.name}`);
    }
  });
});
