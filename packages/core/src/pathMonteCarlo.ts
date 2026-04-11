/**
 * Path-based i.i.d. bootstrap Monte Carlo over equity period returns.
 * See docs/MONTE_CARLO_PATH.md.
 */

import type {
  MonteCarloPercentileSet,
  PathMonteCarloBlock,
  PathMonteCarloEquityPoint,
  PathMonteCarloOptions,
  PathMonteCarloResult,
  PathStability,
  TailRisk,
} from "@kiploks/engine-contracts";
import {
  calculateAutocorrelationLag1,
  calculateCagrFromYears,
  calculateMean,
  calculateNeweyWestTStat,
  calculateStdDev,
} from "./financialMath";
import { percentileType7 } from "./percentile";
import { createMulberry32 } from "./prng";
import { computeDistributionStats } from "./pathMonteCarloDistribution";
import * as C from "./pathMonteCarloConstants";

function percentileSetFromSamples(samples: number[]): MonteCarloPercentileSet {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    p5: percentileType7(sorted, 0.05),
    p25: percentileType7(sorted, 0.25),
    p50: percentileType7(sorted, 0.5),
    p75: percentileType7(sorted, 0.75),
    p95: percentileType7(sorted, 0.95),
  };
}

function normalizePath(
  points: PathMonteCarloEquityPoint[],
): { values: number[]; allTimestamps: boolean; firstTs?: number; lastTs?: number } | null {
  if (points.length < 2) return null;
  for (const p of points) {
    if (typeof p.value !== "number" || !Number.isFinite(p.value) || p.value <= 0) return null;
  }
  const allTimestamps = points.every(
    (p) => p.timestamp != null && Number.isFinite(p.timestamp as number),
  );
  let ordered = points.map((p) => ({
    t: p.timestamp as number | undefined,
    v: p.value,
  }));
  if (allTimestamps) {
    ordered.sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
    const byTs = new Map<number, number>();
    for (const row of ordered) {
      byTs.set(Math.floor(row.t as number), row.v);
    }
    const keys = [...byTs.keys()].sort((a, b) => a - b);
    ordered = keys.map((k) => ({ t: k, v: byTs.get(k)! }));
  }
  const values = ordered.map((r) => r.v);
  const firstTs = ordered[0]?.t;
  const lastTs = ordered[ordered.length - 1]?.t;
  return { values, allTimestamps, firstTs, lastTs };
}

function extractReturns(values: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]!;
    const cur = values[i]!;
    r.push((cur - prev) / prev);
  }
  return r;
}

function resolveSimulations(options?: PathMonteCarloOptions): { n: number; budgetCapped: boolean } {
  let n = options?.simulations ?? C.DEFAULT_SIMULATIONS;
  let budgetCapped = false;
  if (options?.budget && options.simulations == null) {
    n = C.BUDGET_SIMULATIONS[options.budget];
  }
  if (n < C.MIN_SIMULATIONS) n = C.MIN_SIMULATIONS;
  if (n > C.MAX_SIMULATIONS) {
    n = C.MAX_SIMULATIONS;
    budgetCapped = true;
  }
  if (options?.simulations != null && options.simulations > C.MAX_SIMULATIONS) {
    budgetCapped = true;
  }
  return { n, budgetCapped };
}

function pathStabilityFromSpread(spread: number): PathStability {
  if (spread < C.PATH_STABILITY_HIGH_THRESHOLD) return "HIGH";
  if (spread < C.PATH_STABILITY_MEDIUM_THRESHOLD) return "MEDIUM";
  return "LOW";
}

function tailRiskFromCvar(cvar95: number): TailRisk {
  if (!Number.isFinite(cvar95)) return "HIGH";
  if (cvar95 < C.TAIL_RISK_LOW_THRESHOLD) return "LOW";
  if (cvar95 < C.TAIL_RISK_MEDIUM_THRESHOLD) return "MEDIUM";
  return "HIGH";
}

function fmtPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function fmtDecAsPct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

export function buildPathMonteCarloSimulation(
  equityPoints: PathMonteCarloEquityPoint[],
  options?: PathMonteCarloOptions,
): PathMonteCarloBlock {
  const norm = normalizePath(equityPoints);
  if (!norm) return null;

  const returns = extractReturns(norm.values);
  const minP = options?.minPeriods ?? C.DEFAULT_MIN_PERIODS;
  if (returns.length < minP) return null;

  const stdR = calculateStdDev(returns, calculateMean(returns));
  if (!Number.isFinite(stdR) || stdR <= 1e-15) return null;

  const { n: simulationsRun, budgetCapped } = resolveSimulations(options);
  const seedUsed = options?.seed ?? C.PATH_MONTE_CARLO_DEFAULT_SEED;
  const rng = createMulberry32(seedUsed);

  const approximationsUsed: string[] = [];
  let horizonYears: number;
  let horizonFromTimestamps: boolean;
  if (options?.horizonYears != null && Number.isFinite(options.horizonYears) && options.horizonYears > 0) {
    horizonYears = options.horizonYears;
    horizonFromTimestamps = false;
  } else if (norm.allTimestamps && norm.firstTs != null && norm.lastTs != null) {
    horizonYears = (norm.lastTs - norm.firstTs) / C.MS_PER_YEAR;
    horizonFromTimestamps = true;
  } else {
    horizonYears = returns.length / C.TRADING_DAYS_PER_YEAR;
    horizonFromTimestamps = false;
    approximationsUsed.push("horizon_from_trading_days");
  }
  if (!Number.isFinite(horizonYears) || horizonYears <= 0) return null;

  const initialBalance =
    options?.initialBalance != null && options.initialBalance > 0
      ? options.initialBalance
      : norm.values[0]!;

  const acf1 = calculateAutocorrelationLag1(returns);
  if (Number.isFinite(acf1) && Math.abs(acf1) > 0.15) {
    approximationsUsed.push(
      `iid_bootstrap_high_autocorrelation: lag-1 ACF=${acf1.toFixed(3)}; i.i.d. bootstrap may understate path variance.`,
    );
  }
  const nw = calculateNeweyWestTStat(returns);

  const n = returns.length;
  const pathBuf = new Float64Array(n);
  const equityBuf = new Float64Array(n + 1);
  const cagrSamples = new Float64Array(simulationsRun);
  const mddSamples = new Float64Array(simulationsRun);

  let ruinousPathCount = 0;

  for (let k = 0; k < simulationsRun; k++) {
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * n);
      pathBuf[j] = returns[idx]!;
    }

    equityBuf[0] = initialBalance;
    let ruined = false;
    for (let j = 0; j < n; j++) {
      const next = equityBuf[j]! * (1 + pathBuf[j]!);
      if (next <= 0 || !Number.isFinite(next)) {
        ruined = true;
        for (let t = j + 1; t <= n; t++) equityBuf[t] = 0;
        equityBuf[j + 1] = 0;
        break;
      }
      equityBuf[j + 1] = next;
    }

    if (ruined) {
      ruinousPathCount++;
      cagrSamples[k] = -1;
      mddSamples[k] = -1;
      continue;
    }

    const finalBal = equityBuf[n]!;

    const cagr = calculateCagrFromYears(initialBalance, finalBal, horizonYears);
    let peak = equityBuf[0]!;
    let maxDdFrac = 0;
    for (let i = 1; i <= n; i++) {
      const v = equityBuf[i]!;
      if (v > peak) peak = v;
      const dd = peak > 0 ? (peak - v) / peak : 0;
      if (dd > maxDdFrac) maxDdFrac = dd;
    }
    const mddK = -maxDdFrac;

    const cagrK = Number.isFinite(cagr) ? cagr : Number.NaN;

    cagrSamples[k] = cagrK;
    mddSamples[k] = Number.isFinite(mddK) ? mddK : Number.NaN;
  }

  const cagrList = Array.from(cagrSamples).filter(Number.isFinite);
  const mddList = Array.from(mddSamples).filter(Number.isFinite);
  if (cagrList.length === 0 || mddList.length === 0) return null;

  const cagrDistribution = percentileSetFromSamples(cagrList);
  const maxDrawdownDistribution = percentileSetFromSamples(mddList);

  let pos = 0;
  let viable = 0;
  for (let k = 0; k < simulationsRun; k++) {
    const c = cagrSamples[k]!;
    const m = mddSamples[k]!;
    if (c > 0) pos++;
    if (c > 0 && Number.isFinite(m) && Math.abs(m) < C.VIABLE_MDD_THRESHOLD_DECIMAL) viable++;
  }
  const probabilityPositive = pos / simulationsRun;
  const probabilityViable = viable / simulationsRun;

  const cagrStats = computeDistributionStats(cagrList);
  const maxDrawdownStats = computeDistributionStats(mddList);

  const spread = cagrDistribution.p95 - cagrDistribution.p5;
  const pathStability: PathStability = pathStabilityFromSpread(spread);
  const tailRisk: TailRisk = tailRiskFromCvar(cagrStats.cvar95);

  const interpretation: string[] = [];
  interpretation.push(
    `Median simulated CAGR: ${fmtDecAsPct(cagrDistribution.p50)}. Range (5th–95th pct): ${fmtDecAsPct(cagrDistribution.p5)} to ${fmtDecAsPct(cagrDistribution.p95)}.`,
  );
  interpretation.push(`${fmtPct(probabilityPositive)} of simulated paths produced positive CAGR.`);
  interpretation.push(
    `Median simulated max drawdown: ${fmtDecAsPct(maxDrawdownDistribution.p50)}. Worst-case (5th pct): ${fmtDecAsPct(maxDrawdownDistribution.p5)}.`,
  );
  interpretation.push(
    `Tail risk: ${tailRisk}. 95% Expected Shortfall on CAGR distribution: ${fmtDecAsPct(cagrStats.cvar95)} annualised loss.`,
  );
  interpretation.push(
    `Path stability: ${pathStability}. CAGR outcome spread (p95−p5): ${fmtDecAsPct(spread)}.`,
  );
  interpretation.push(
    `${fmtPct(probabilityViable)} of paths were viable (positive CAGR and max drawdown below 50%).`,
  );
  interpretation.push(
    `Method: i.i.d. bootstrap over ${returns.length} observed return periods, ${simulationsRun} paths. Does not model serial correlation or regime shifts. Interpret alongside WFA walk-forward results.`,
  );

  const meta: PathMonteCarloResult["meta"] = {
    methodVersion: C.PATH_MONTE_CARLO_METHOD_VERSION,
    simulationsRun,
    periodsUsed: returns.length,
    seedUsed,
    horizonYears,
    horizonFromTimestamps,
    bootstrapMethod: "iid",
    budgetCapped,
    percentileMethod: "type7",
    ruinousPathCount,
    approximationsUsed: approximationsUsed.length ? approximationsUsed : undefined,
    ...(Number.isFinite(acf1) ? { periodReturnsAutocorrelationLag1: acf1 } : {}),
    ...(Number.isFinite(nw.tStat) ? { periodReturnsNeweyWestTStat: nw.tStat } : {}),
  };

  const result: PathMonteCarloResult = {
    cagrDistribution,
    maxDrawdownDistribution,
    probabilityPositive,
    probabilityViable,
    pathStability,
    tailRisk,
    interpretation,
    cagrStats,
    maxDrawdownStats,
    meta,
  };
  return result;
}
