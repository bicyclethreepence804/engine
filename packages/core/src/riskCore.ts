import { ANALYSIS_ENGINE_VERSION } from "@kiploks/engine-contracts";
import {
  buildEquityCurveFromReturns,
  calculateCvar,
  calculateDurbinWatson,
  calculateKurtosis,
  calculateKurtosisWinsorized,
  calculateMean,
  calculateMaxDrawdown,
  calculateSkewness,
  calculateStdDev,
  calculateTStat,
  calculateVar,
  calculateVarCornishFisher,
} from "./financialMath";
import { percentileType7 } from "./percentile";

const MIN_DOWNSIDE_OBSERVATIONS_FOR_SORTINO = 5;
const DOWNSIDE_DEV_EPSILON = 1e-8;
const TAIL_RATIO_P5_EPSILON = 1e-12;

export function computeTailRatio(p5: number, p95: number): number | null {
  if (!Number.isFinite(p5) || !Number.isFinite(p95)) return null;
  if (Math.abs(p5) < TAIL_RATIO_P5_EPSILON) return null;
  const ratio = p95 / Math.abs(p5);
  return Number.isFinite(ratio) ? ratio : null;
}

export interface RiskAnalysisResult {
  maxDrawdown: number;
  sharpeRatio: number;
  var: number;
  metrics: { profitFactor: number; expectancy: number; winRate: number };
  recoveryFactor: number;
  sortinoRatio: number;
  expectedShortfall95: number;
  gainToPain: number;
  skewness: number;
  kurtosis: number;
  kurtosisWinsorized?: number;
  edgeStabilityZScore: number;
  durbinWatson: number;
  tailRatio?: number | null;
  analysis_engine_version?: string;
  oosWindowCount: number;
  contextNote?: string;
  tailAuthority?: string;
  riskVerdict?: string;
  riskAttribution?: string;
  temporalStability?: string;
  riskRegimeContext?: string;
  tailRiskProfile?: string;
  riskAssessment?: { status?: string; note?: string; maxLeverage?: number };
  riskVerdictSections?: Array<{ type: string; text: string }>;
  riskRecommendation?: { status?: string; action?: string; maxLeverage?: string };
  diagnosticNote?: string;
  singleTradeDominanceWarning?: string;
  payoffRatio?: number;
  tradeWinRate?: number;
  totalTrades?: number;
  oosCvar95Unreliable?: boolean;
  sortinoInconsistentWithPf?: boolean;
}

export type OosTradeLike = { net_return?: number; pnl_pct?: number; [k: string]: unknown };

export function buildCanonicalR(oosTrades: OosTradeLike[]): number[] {
  if (!Array.isArray(oosTrades) || oosTrades.length === 0) return [];
  return oosTrades
    .map((t) => {
      if (typeof t.net_return === "number" && Number.isFinite(t.net_return)) return t.net_return;
      if (typeof t.pnl_pct === "number" && Number.isFinite(t.pnl_pct)) return t.pnl_pct / 100;
      return Number.NaN;
    })
    .filter((r) => Number.isFinite(r));
}

export interface RiskBuilderFromROptions {
  oosWindowCount?: number;
}

export function riskBuilderFromRCore(
  R: number[],
  options?: RiskBuilderFromROptions,
): RiskAnalysisResult {
  if (!Array.isArray(R) || R.length === 0) {
    return {
      maxDrawdown: Number.NaN,
      sharpeRatio: Number.NaN,
      var: Number.NaN,
      metrics: { profitFactor: Number.NaN, expectancy: Number.NaN, winRate: Number.NaN },
      recoveryFactor: Number.NaN,
      sortinoRatio: Number.NaN,
      expectedShortfall95: Number.NaN,
      gainToPain: Number.NaN,
      skewness: Number.NaN,
      kurtosis: Number.NaN,
      edgeStabilityZScore: Number.NaN,
      durbinWatson: Number.NaN,
      analysis_engine_version: ANALYSIS_ENGINE_VERSION,
      oosWindowCount: 0,
    };
  }

  const returns = R;
  const meanReturn = calculateMean(returns);
  const stdReturn = calculateStdDev(returns, meanReturn);
  const sharpeRatio = stdReturn ? meanReturn / stdReturn : 0;
  let sortinoRatio = (() => {
    const downside = returns.filter((r) => r < 0);
    if (downside.length === 0 || downside.length < MIN_DOWNSIDE_OBSERVATIONS_FOR_SORTINO) {
      return Number.NaN;
    }
    const dv = Math.sqrt(downside.reduce((s, r) => s + r * r, 0) / downside.length);
    if (dv < DOWNSIDE_DEV_EPSILON) return Number.NaN;
    return meanReturn / dv;
  })();
  if (Number.isFinite(sortinoRatio) && meanReturn < 0 && sortinoRatio > 0) sortinoRatio = Number.NaN;

  let var95 = returns.length >= 2 ? Math.abs(calculateVar(returns, 0.95)) : Number.NaN;
  let expectedShortfall95 =
    returns.length >= 2
      ? (() => {
          const cvarRaw = calculateCvar(returns, 0.95);
          return cvarRaw <= 0 ? Math.abs(cvarRaw) : var95;
        })()
      : Number.NaN;
  if (expectedShortfall95 < var95) expectedShortfall95 = var95 * 1.05;

  const equityCurve = buildEquityCurveFromReturns(
    returns,
    1,
    returns.map((_, i) => i),
  );
  const maxDrawdownPct = calculateMaxDrawdown(equityCurve);
  const maxDrawdown = Number.isFinite(maxDrawdownPct) ? -(maxDrawdownPct / 100) : Number.NaN;
  const totalReturn =
    equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].balance - 1 : Number.NaN;
  const recoveryFactor =
    Number.isFinite(totalReturn) && Number.isFinite(maxDrawdown)
      ? maxDrawdown !== 0
        ? totalReturn / Math.abs(maxDrawdown)
        : totalReturn > 0
          ? Infinity
          : 0
      : Number.NaN;

  const grossProfit = returns.filter((r) => r > 0).reduce((s, r) => s + r, 0);
  const grossLoss = returns.filter((r) => r < 0).reduce((s, r) => s + Math.abs(r), 0);
  const positiveReturns = returns.filter((r) => r > 0);
  const singleTradeDominanceWarning =
    grossProfit > 0 && positiveReturns.length > 0 && Math.max(...positiveReturns) >= 0.5 * grossProfit
      ? "Warning: Outlier detected. Profit Factor is distorted by a single event."
      : undefined;

  const PF_CAP = 20;
  const profitFactor =
    grossLoss > 0 ? Math.min(grossProfit / grossLoss, PF_CAP) : grossProfit > 0 ? PF_CAP : Number.NaN;
  const GTP_CAP = 100;
  const gainToPain =
    grossLoss > 0
      ? (() => {
          const netProfit = grossProfit - grossLoss;
          const gtp = netProfit / grossLoss;
          return Number.isFinite(gtp) ? Math.max(-GTP_CAP, Math.min(GTP_CAP, gtp)) : Number.NaN;
        })()
      : grossProfit > 0
        ? GTP_CAP
        : Number.NaN;

  const winRate =
    returns.length > 0 ? returns.filter((r) => r > 0).length / returns.length : Number.NaN;
  const winsCount = returns.filter((r) => r > 0).length;
  const lossCount = returns.filter((r) => r < 0).length;
  const averageWin = winsCount > 0 ? grossProfit / winsCount : Number.NaN;
  const averageLoss = lossCount > 0 ? grossLoss / lossCount : Number.NaN;
  const expectancy =
    Number.isFinite(averageLoss) && averageLoss > 0 ? meanReturn / averageLoss : meanReturn;
  const payoffRatio =
    lossCount > 0 && Number.isFinite(averageWin)
      ? Math.min(averageWin / averageLoss, 100)
      : undefined;

  const skewness = calculateSkewness(returns);
  const kurtosis = calculateKurtosis(returns);
  const kurtosisWinsorized =
    Number.isFinite(kurtosis) && kurtosis > 50 && returns.length >= 4
      ? calculateKurtosisWinsorized(returns, 0.01)
      : undefined;
  const edgeStabilityZScore = calculateTStat(returns);
  const durbinWatson = returns.length >= 30 ? calculateDurbinWatson(returns) : Number.NaN;

  let tailRatio: number | null = null;
  if (returns.length >= 3) {
    const p5 = percentileType7(returns, 0.05);
    const p95 = percentileType7(returns, 0.95);
    tailRatio = computeTailRatio(p5, p95);
  }

  if (Number.isFinite(skewness) && Number.isFinite(kurtosis) && (kurtosis > 3 || Math.abs(skewness) > 1)) {
    const cfVar = calculateVarCornishFisher(meanReturn, stdReturn, skewness, kurtosis, 0.95);
    if (Number.isFinite(cfVar)) {
      const mddAbs = Number.isFinite(maxDrawdown) ? Math.abs(maxDrawdown) : Infinity;
      var95 = Math.min(cfVar, mddAbs);
      if (Number.isFinite(expectedShortfall95) && expectedShortfall95 < var95) expectedShortfall95 = var95;
    }
  }

  const mddAbs = Number.isFinite(maxDrawdown) ? Math.abs(maxDrawdown) : Infinity;
  if (Number.isFinite(var95) && var95 > mddAbs) var95 = mddAbs;
  if (Number.isFinite(expectedShortfall95)) {
    if (expectedShortfall95 < var95) expectedShortfall95 = var95;
    if (expectedShortfall95 > mddAbs) expectedShortfall95 = mddAbs;
  }
  if (returns.length >= 2 && stdReturn > 0 && (var95 === 0 || expectedShortfall95 === 0)) {
    var95 = Number.NaN;
    expectedShortfall95 = Number.NaN;
  }

  const esVarRatio =
    Number.isFinite(var95) && var95 > 0 && Number.isFinite(expectedShortfall95)
      ? expectedShortfall95 / var95
      : Number.NaN;
  const oosCvar95Unreliable = Number.isFinite(esVarRatio) && esVarRatio >= 0.99 && esVarRatio <= 1.05;
  if (oosCvar95Unreliable) expectedShortfall95 = Number.NaN;

  const actualWindowCount = options?.oosWindowCount ?? 1;
  const insufficientWindows = actualWindowCount < 2;
  return {
    maxDrawdown,
    sharpeRatio,
    var: -var95,
    metrics: { profitFactor, expectancy, winRate },
    recoveryFactor,
    sortinoRatio: insufficientWindows ? Number.NaN : sortinoRatio,
    expectedShortfall95: -expectedShortfall95,
    ...(oosCvar95Unreliable && { oosCvar95Unreliable: true }),
    gainToPain,
    skewness,
    kurtosis,
    ...(!Number.isFinite(kurtosisWinsorized) ? {} : { kurtosisWinsorized }),
    edgeStabilityZScore,
    durbinWatson: insufficientWindows ? Number.NaN : durbinWatson,
    // computeTailRatio returns only null or a finite number; no undefined branch needed.
    tailRatio: insufficientWindows ? null : tailRatio,
    analysis_engine_version: ANALYSIS_ENGINE_VERSION,
    oosWindowCount: actualWindowCount,
    totalTrades: returns.length,
    ...(singleTradeDominanceWarning && { singleTradeDominanceWarning }),
    ...(payoffRatio != null && Number.isFinite(payoffRatio) && { payoffRatio }),
  };
}
