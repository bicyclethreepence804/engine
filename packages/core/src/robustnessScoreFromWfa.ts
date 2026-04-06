/**
 * Kiploks Robustness Score - 4-module multiplicative formula.
 * Variant C: one formula test per module.
 *
 * This module is pure Open Core math: the host pipeline is responsible for
 * assembling the input fields (proBenchmarkMetrics, riskAnalysis, etc.)
 * from payload data.
 */

import type {
  RobustnessBlockedByModule,
  RobustnessScoreFromWfaInput,
  RobustnessScoreFromWfaResult,
} from "@kiploks/engine-contracts";

export type {
  RobustnessBlockedByModule,
  RobustnessScoreFromWfaInput,
  RobustnessScoreFromWfaResult,
};

function computeVolatilityFromEquityCurve(
  curve: Array<{ date?: string; value?: number; equity?: number }>,
): number | null {
  if (!Array.isArray(curve) || curve.length < 2) return null;

  const values = curve
    .map((p) => {
      const v = (p as { value?: number; equity?: number }).value ?? (p as { equity?: number }).equity;
      return typeof v === "number" && Number.isFinite(v) ? v : NaN;
    })
    .filter((v) => !isNaN(v) && v > 0);

  if (values.length < 2) return null;

  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const r = (values[i]! - values[i - 1]!) / values[i - 1]!;
    if (Number.isFinite(r)) returns.push(r);
  }

  if (returns.length < 2) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  return Number.isFinite(std) ? std : null;
}

function computeVolatilityAdjustedWfe(
  wfa: RobustnessScoreFromWfaInput["walkForwardAnalysis"],
): { wfe: number; note?: string } {
  const wfaAny = wfa as Record<string, unknown> | null | undefined;
  const periods = (wfa?.periods ?? wfaAny?.windows ?? []) as unknown[];
  const windows = (wfaAny?.performanceTransfer as { windows?: unknown[] })?.windows ?? [];
  const windowsArr = Array.isArray(windows) ? windows : [];

  if (!periods.length) {
    const medianWfe =
      wfaAny?.wfe ?? (wfaAny?.wfeDistribution as { median?: number })?.median;
    return {
      wfe: Number.isFinite(medianWfe as number) ? Math.min(1, Math.max(0, medianWfe as number)) : NaN,
      note: "No WFA periods - WFE unavailable. Run walk-forward analysis.",
    };
  }

  const wfePerWindow = (periods as Array<{
    optimizationReturn?: number;
    validationReturn?: number;
    optimization_return?: number;
    validation_return?: number;
  }>)
    .map((p) => {
      const opt = p.optimizationReturn ?? p.optimization_return ?? 0;
      const val = p.validationReturn ?? p.validation_return ?? 0;
      return opt !== 0 && Number.isFinite(val) ? val / opt : NaN;
    })
    .filter(Number.isFinite) as number[];

  if (!wfePerWindow.length) {
    return {
      wfe: NaN,
      note: "No valid WFE per window - optimizationReturn or validationReturn missing.",
    };
  }

  if (!windowsArr.length || windowsArr.length !== wfePerWindow.length) {
    const mean = wfePerWindow.reduce((a, b) => a + b, 0) / wfePerWindow.length;
    return {
      wfe: Number.isFinite(mean) ? mean : NaN,
      note: "Volatility-Adjusted WFE requires per-window OOS equity curve. Using mean WFE across windows.",
    };
  }

  const volatilities: (number | null)[] = [];
  for (const w of windowsArr) {
    const curve = (w as { oosEquityCurve?: unknown[] })?.oosEquityCurve ?? [];
    const vol = computeVolatilityFromEquityCurve(
      (curve as Array<{ date?: string; value?: number; equity?: number }>) ?? [],
    );
    volatilities.push(vol);
  }

  const validCount = volatilities.filter((v) => v != null && v > 0).length;
  if (validCount < 2) {
    const mean = wfePerWindow.reduce((a, b) => a + b, 0) / wfePerWindow.length;
    return {
      wfe: Number.isFinite(mean) ? mean : NaN,
      note: "Per-window OOS equity curve has <2 points or zero volatility. Using mean WFE.",
    };
  }

  const volFloor = 1e-6;
  let sumWeighted = 0;
  let sumWeights = 0;

  for (let i = 0; i < wfePerWindow.length && i < volatilities.length; i++) {
    const vol = volatilities[i];
    if (vol != null && vol > volFloor && Number.isFinite(wfePerWindow[i])) {
      const w = 1 / (vol + volFloor);
      sumWeighted += wfePerWindow[i]! * w;
      sumWeights += w;
    }
  }

  const volAdjWfe =
    sumWeights > 0 ? sumWeighted / sumWeights : wfePerWindow.reduce((a, b) => a + b, 0) / wfePerWindow.length;

  return {
    wfe: Number.isFinite(volAdjWfe) ? volAdjWfe : NaN,
  };
}

function estimateNetSharpeAt10Bps(
  baseSharpe: number,
  turnoverRatio: number,
  avgNetProfitBps?: number | null,
  breakevenSlippageBps?: number | null,
): number {
  if (!Number.isFinite(baseSharpe)) return NaN;

  const slippageBps = 10;
  const costBpsPerTrade = slippageBps * 2;
  const annualCostPct = (turnoverRatio * costBpsPerTrade) / 10000;

  let netSharpe: number;
  if (Number.isFinite(avgNetProfitBps)) {
    const avgBps = avgNetProfitBps as number;
    const newEdgeBps = avgBps - costBpsPerTrade;
    if (newEdgeBps <= 0 || avgBps <= 0) {
      netSharpe = -Math.abs(baseSharpe) * Math.pow(slippageBps / 5, 0.7);
    } else {
      const edgeRatio = newEdgeBps / avgBps;
      netSharpe = baseSharpe * edgeRatio;
    }
  } else {
    const costAsReturnShare = Math.min(0.95, annualCostPct * 8);
    netSharpe = baseSharpe * (1 - costAsReturnShare);
  }

  if (Number.isFinite(breakevenSlippageBps) && slippageBps >= (breakevenSlippageBps ?? 0)) {
    const refBps = Math.max(1, breakevenSlippageBps ?? 1);
    netSharpe = -Math.abs(baseSharpe) * Math.pow(slippageBps / refBps, 0.7);
  }

  return Math.max(netSharpe, -5 * Math.abs(baseSharpe));
}

function moduleValidation(
  wfe: number,
  consistency: number,
  failedCount: number,
  totalWindows: number,
): number {
  const wfeScore = Number.isFinite(wfe)
    ? wfe < 0.5
      ? wfe * 50
      : Math.min(100, wfe * 100)
    : null;

  const consistencyScore = Number.isFinite(consistency) ? consistency * 100 : 0;
  const failPenalty = totalWindows > 0 ? Math.max(0, 1 - (failedCount / totalWindows) * 2) : 1;

  const raw = wfeScore === null ? consistencyScore * failPenalty : (wfeScore * 0.5 + consistencyScore * 0.5) * failPenalty;
  return Math.min(100, Math.max(0, raw));
}

function moduleRisk(profitFactor: number, kurtosis: number, recoveryFactor: number): number {
  if (!Number.isFinite(profitFactor) || profitFactor < 1) return 0;
  const pfScore = Math.min(100, (profitFactor - 1) * 50);
  const kurtPenalty = Number.isFinite(kurtosis) && kurtosis > 5 ? 0.7 : 1;
  const rfScore = Number.isFinite(recoveryFactor) ? Math.min(100, recoveryFactor * 50) : 50;
  const raw = (pfScore * 0.4 + rfScore * 0.6) * kurtPenalty;
  return Math.min(100, Math.max(0, raw));
}

function moduleStability(fragileCount: number, totalParams: number, edgeStabilityZ: number): number {
  const fragileRatio = totalParams > 0 ? fragileCount / totalParams : 0;
  const sensitivityScore = Math.max(0, 100 - fragileRatio * 150);
  const edgeScore =
    Number.isFinite(edgeStabilityZ) && edgeStabilityZ > 0 ? Math.min(100, edgeStabilityZ * 50) : 50;
  const raw = sensitivityScore * 0.5 + edgeScore * 0.5;
  return Math.min(100, Math.max(0, raw));
}

function moduleExecution(netSharpe10bps: number): number {
  if (!Number.isFinite(netSharpe10bps)) return 10;
  if (netSharpe10bps < 0) return Math.max(0, 10 + netSharpe10bps * 5);
  if (netSharpe10bps >= 0.3) return 100;
  if (netSharpe10bps >= 0.2) return 70;
  return 10 + netSharpe10bps * 200;
}

export function calculateRobustnessScoreFromWfa(
  input: RobustnessScoreFromWfaInput,
): RobustnessScoreFromWfaResult | null {
  const { walkForwardAnalysis, proBenchmarkMetrics, riskAnalysis, parameterSensitivity, turnoverAndCostDrag } = input;

  if (!walkForwardAnalysis) return null;
  const wfa = walkForwardAnalysis;

  const { wfe: volAdjWfe, note: wfeNote } = computeVolatilityAdjustedWfe(wfa);

  const medianWfe =
    (proBenchmarkMetrics as { wfeDistribution?: { median?: number } })?.wfeDistribution?.median ??
    (typeof (wfa as { wfe?: number }).wfe === "number" ? (wfa as { wfe?: number }).wfe : volAdjWfe);

  const consistency =
    typeof (wfa as { consistency?: number }).consistency === "number"
      ? (wfa as { consistency?: number }).consistency
      : (proBenchmarkMetrics as { windowsCount?: number })?.windowsCount
        ? 0
        : NaN;

  const failedCount = (wfa as { failedWindows?: { count?: number } }).failedWindows?.count ?? 0;
  const totalWindows =
    (wfa as { failedWindows?: { total?: number } }).failedWindows?.total ??
    (proBenchmarkMetrics as { windowsCount?: number })?.windowsCount ??
    1;

  const periodsForPct = (wfa as { periods?: unknown[] }).periods ?? (wfa as unknown as Record<string, unknown>)?.windows ?? [];

  const profitablePct =
    Number.isFinite(consistency) && (consistency as number) > 0
      ? (consistency as number)
      : Array.isArray(periodsForPct) && periodsForPct.length > 0
        ? (periodsForPct as Array<{ validationReturn?: number }>).filter((p) => (p.validationReturn ?? 0) > 0).length / periodsForPct.length
        : 0;

  const m1 = moduleValidation(Number.isFinite(volAdjWfe) ? volAdjWfe : (medianWfe as number), Number.isFinite(consistency) ? (consistency as number) : profitablePct, failedCount, totalWindows);

  const pf = (riskAnalysis as { metrics?: { profitFactor?: number } })?.metrics?.profitFactor ?? NaN;
  const kurt = (riskAnalysis as { kurtosis?: number })?.kurtosis ?? NaN;
  const rf = (riskAnalysis as { recoveryFactor?: number })?.recoveryFactor ?? NaN;
  const m2 = moduleRisk(pf, kurt, rf);

  const params = (parameterSensitivity as { parameters?: unknown[] })?.parameters ?? [];
  const hasParameterData = params.length > 0;
  const fragileCount = (params as Array<{ sensitivity?: number }>).filter((p) => (p.sensitivity ?? 0) >= 0.6).length;
  const edgeZ = (riskAnalysis as { edgeStabilityZScore?: number })?.edgeStabilityZScore ?? NaN;
  const m3 = hasParameterData ? moduleStability(fragileCount, params.length, edgeZ) : 0;
  const stabilityNotComputed = !hasParameterData;

  const baseSharpe =
    (proBenchmarkMetrics as { avgOosSharpe?: number })?.avgOosSharpe ??
    (riskAnalysis as { sharpeRatio?: number })?.sharpeRatio ??
    NaN;

  const turnoverRatio = Number.isFinite((turnoverAndCostDrag as { annualTurnover?: number })?.annualTurnover)
    ? (turnoverAndCostDrag as { annualTurnover: number }).annualTurnover
    : 10;

  const netSharpe10 = estimateNetSharpeAt10Bps(
    baseSharpe,
    turnoverRatio,
    (turnoverAndCostDrag as { avgNetProfitPerTradeBps?: number })?.avgNetProfitPerTradeBps,
    (turnoverAndCostDrag as { breakevenSlippageBps?: number })?.breakevenSlippageBps,
  );

  const m4 = moduleExecution(netSharpe10);

  const m1n = m1 / 100;
  const m2n = m2 / 100;
  const m3n = m3 / 100;
  const m4n = m4 / 100;

  const criticalModules: Array<{ key: RobustnessBlockedByModule; value: number }> = [
    { key: "validation", value: m1 },
    { key: "risk", value: m2 },
    { key: "stability", value: m3 },
    { key: "execution", value: m4 },
  ];

  const blockedByModules = criticalModules
    .filter((m) => m.value === 0 || (m.key === "execution" && m.value < 10))
    .map((m) => m.key);

  const blockedByModule = blockedByModules.length > 0 ? blockedByModules[0] : undefined;

  const m3nEff = Math.max(0.1, m3n);
  const m4nEff = Math.max(0.1, m4n);

  const multiplicative =
    Math.pow(Math.max(0.01, m1n), 0.4) *
    Math.pow(Math.max(0.01, m2n), 0.3) *
    Math.pow(m3nEff, 0.2) *
    Math.pow(m4nEff, 0.1);

  let overallRaw = Math.round(multiplicative * 100);
  if (m4 >= 10 && m4 < 20 && Number.isFinite(overallRaw)) {
    overallRaw = Math.round(overallRaw * 0.5);
  }
  overallRaw = Math.min(100, Math.max(0, overallRaw));

  const overall = blockedByModule ? 0 : overallRaw;
  const potentialOverall = blockedByModule ? overallRaw : undefined;

  const psi = (proBenchmarkMetrics as { parameterStabilityIndex?: number })?.parameterStabilityIndex ?? NaN;
  const parameterStability = Number.isFinite(psi) ? (1 - Math.min(1, psi)) * 100 : NaN;

  const walkForwardEfficiency = Number.isFinite(volAdjWfe) ? volAdjWfe * 100 : Number.isFinite(medianWfe as number) ? (medianWfe as number) * 100 : NaN;

  const oosConsistency = Number.isFinite(consistency) ? (consistency as number) * 100 : NaN;

  return {
    overall,
    ...(potentialOverall != null && { potentialOverall }),
    blockedByModule,
    ...(blockedByModules.length > 0 && { blockedByModules }),
    components: {
      parameterStability: Number.isFinite(parameterStability) ? parameterStability / 100 : NaN,
      timeRobustness: Number.isFinite(walkForwardEfficiency) ? Math.max(0, Math.min(1, walkForwardEfficiency / 100)) : NaN,
      marketRegime: Number.isFinite(oosConsistency) ? oosConsistency / 100 : NaN,
      monteCarloStability: NaN,
      sensitivity: Number.isFinite(m3) ? m3 / 100 : NaN,
    },
    modules: { validation: m1, risk: m2, stability: m3, execution: m4 },
    wfeNote,
    ...(stabilityNotComputed && { stabilityNotComputed: true }),
  };
}

