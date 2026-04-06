/**
 * Precomputed data for Strategy Action Plan block.
 * Mirrors frontend StrategyActionPlan estimateSlippageImpact so UI only displays, no client-side math.
 */

type MetricVerdict = "PASS" | "FAIL" | "REJECT" | "N/A" | "NOT_VIABLE";

function slippageSensitivityBlockVerdict(baseOOSSharpe: number): MetricVerdict {
  if (!Number.isFinite(baseOOSSharpe)) return "N/A";
  if (baseOOSSharpe < 0) return "NOT_VIABLE";
  return "N/A";
}

export interface SlippageImpactRow {
  bps: number;
  label: string;
  netSharpe: number;
  ddDeltaPct: number;
  ddDeltaPctUncapped?: number;
  verdict: string;
}

export interface StrategyActionPlanTextPayload {
  capacityNote?: string;
  proNote?: string;
  reResearchReasons?: string[];
  bulletSummaries?: string[];
}

export type SharpeSourceTag = "wfa_avg_oos_sharpe" | "risk";

export interface StrategyActionPlanRecommendation {
  target: string;
  msg: string;
  impact: "Critical" | "High" | "Medium";
}

export interface StrategyActionPlanPrecomputed {
  slippageImpactRows: SlippageImpactRow[];
  textPayload?: StrategyActionPlanTextPayload;
  sharpeSource?: SharpeSourceTag;
  slippageBlockVerdict?: "NOT_VIABLE";
  baseSharpe?: number;
  netSharpe10bps?: number;
  phase?: "READY" | "INCUBATE" | "RE_RESEARCH" | "CAUTION" | "REJECT";
  phase1Label?: string;
  phase2WfeThreshold?: number;
  reResearchReasons?: string[];
  recommendations?: StrategyActionPlanRecommendation[];
  systemConflictDetected?: boolean;
  systemConflictMessage?: string;
  systemConflictCritical?: boolean;
  systemConflictWarning?: boolean;
  systemConflictMessageCritical?: string;
  systemConflictMessageWarning?: string;
  medianWfeUnbiased?: number;
  wfeUnbiasedCount?: number;
  wfeFilteredCount?: number | null;
  oosBetterThanIs?: boolean;
  executionEfficiencyRatio?: number;
  monitoringText?: string;
  allocationText?: string;
  killSwitchDisplay?: string;
  wfaFailCount?: number | null;
  wfaFailTotal?: number | null;
  pumpkinExhaustion?: boolean;
  pumpkinExhaustionDays?: number | null;
  zombieShare?: number;
  hasRegimeData?: boolean;
  regimePassCount?: number;
  mostSensitiveParamName?: string | null;
  fragileCount?: number;
  fragileParamList?: string | null;
  edgeHalfLifeDays?: number;
  oosRetention?: number;
  failRatio?: number;
  medianWfe?: number;
  showLatencySensitivity?: boolean;
  breakevenSlippage?: number;
}

const DD_DISPLAY_CAP_PCT = 200;

function estimateSlippageImpact(
  baseSharpe: number,
  baseDdPct: number,
  turnoverRatio: number,
  slippageBps: number,
  avgNetProfitPerTradeBps?: number | null,
  breakevenSlippageBps?: number | null
): { netSharpe: number; ddDeltaPct: number; ddDeltaPctUncapped?: number; verdict: string } {
  if (!Number.isFinite(baseSharpe)) {
    return { netSharpe: NaN, ddDeltaPct: NaN, verdict: "n/a" };
  }
  if (slippageBps === 0) {
    return {
      netSharpe: baseSharpe,
      ddDeltaPct: 0,
      verdict: "Base Case",
    };
  }

  const costBpsPerTrade = slippageBps * 2;
  const annualCostPct = (turnoverRatio * costBpsPerTrade) / 10000;

  let sharpeRatio: number;
  let sharpeDrop: number;

  if (baseSharpe <= 0) {
    const k = 0.02;
    sharpeRatio = baseSharpe - k * slippageBps;
    sharpeDrop = Math.min(1, (slippageBps / 50) * 0.5);
  } else if (Number.isFinite(avgNetProfitPerTradeBps)) {
    const oldEdgeBps = avgNetProfitPerTradeBps as number;
    const newEdgeBps = oldEdgeBps - costBpsPerTrade;
    if (oldEdgeBps <= 0) {
      sharpeRatio = -Math.abs(baseSharpe) * Math.pow(slippageBps / 5, 0.7);
      sharpeDrop = 1;
    } else if (newEdgeBps <= 0) {
      const edgeRatio = newEdgeBps / oldEdgeBps;
      sharpeRatio = baseSharpe * edgeRatio;
      sharpeDrop = 1;
    } else {
      const edgeRatio = newEdgeBps / oldEdgeBps;
      sharpeRatio = baseSharpe * edgeRatio;
      sharpeDrop = 1 - edgeRatio;
    }
  } else {
    const costAsReturnShare = Math.min(0.95, annualCostPct * 8);
    sharpeDrop = costAsReturnShare;
    sharpeRatio = baseSharpe * (1 - sharpeDrop);
    if (sharpeRatio < 0) {
      sharpeRatio = -Math.abs(baseSharpe) * Math.pow(slippageBps / 5, 0.7);
    }
  }

  if (
    baseSharpe > 0 &&
    Number.isFinite(breakevenSlippageBps) &&
    slippageBps >= (breakevenSlippageBps ?? 0)
  ) {
    sharpeDrop = 1;
    const refBps = Math.max(1, breakevenSlippageBps ?? 1);
    sharpeRatio = -Math.abs(baseSharpe) * Math.pow(slippageBps / refBps, 0.7);
  }

  const netSharpe = sharpeRatio;
  const DD_BASE_EPSILON = 0.5;
  const baseDdEffective = Math.max(baseDdPct, DD_BASE_EPSILON);
  const ddMultiplier = 1 + sharpeDrop;
  const ddSlippage =
    baseDdEffective * (1 + annualCostPct * 5) * Math.min(ddMultiplier, 2);
  const ddDeltaPctUncapped =
    ((ddSlippage - baseDdEffective) / Math.max(baseDdEffective, DD_BASE_EPSILON)) * 100;
  const ddDeltaPct =
    ddDeltaPctUncapped > DD_DISPLAY_CAP_PCT ? DD_DISPLAY_CAP_PCT : ddDeltaPctUncapped;
  const uncappedForDisplay =
    ddDeltaPctUncapped > DD_DISPLAY_CAP_PCT ? ddDeltaPctUncapped : undefined;

  let verdict: string;
  if (baseSharpe <= 0) {
    verdict = netSharpe > 0 ? "🟡 Margin erosion" : "🔴 UNTRADABLE";
  } else {
    if (netSharpe >= baseSharpe * 0.85) verdict = "🟢 Safe";
    else if (netSharpe >= baseSharpe * 0.6 || netSharpe > 0) verdict = "🟡 Margin erosion";
    else verdict = "🔴 UNTRADABLE";
  }

  return {
    netSharpe,
    ddDeltaPct,
    ...(uncappedForDisplay != null && { ddDeltaPctUncapped: uncappedForDisplay }),
    verdict,
  };
}

const SLIPPAGE_BPS_ROWS = [
  { bps: 0, label: "0 (Ideal)" },
  { bps: 5, label: "5 (Low)" },
  { bps: 10, label: "10 (Avg)" },
  { bps: 20, label: "20 (High)" },
  { bps: 50, label: "50 (Stress)" },
];

function pseudoSharpeFromReturns(returns: number[]): number {
  if (!Array.isArray(returns) || returns.length < 2) return NaN;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((sum, r) => sum + (r - mean) * (r - mean), 0) / returns.length;
  const std = Math.sqrt(variance);
  return std > 0 ? mean / std : NaN;
}

function medianOfSorted(arr: number[]): number {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function parseWfaWindowDays(windowLength: string): number | null {
  if (!windowLength || typeof windowLength !== "string") return null;
  const m = windowLength.trim().match(/^(\d+)\s*([DWMY])$/i);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const u = (m[2] || "").toUpperCase();
  if (u === "D") return n;
  if (u === "W") return n * 7;
  if (u === "M") return n * 30;
  if (u === "Y") return n * 365;
  return null;
}

type DataLike = {
  proBenchmarkMetrics?: {
    avgOosSharpe?: number;
    wfeDistribution?: { median?: number };
    wfeValidWindowCount?: number;
    oosRetention?: number;
    edgeHalfLife?: { days?: number };
    killSwitchMaxOosDrawdownWindows?: number;
    regimeSurvivalMatrix?: Record<string, { pass?: boolean }>;
    parameterStabilityIndex?: number;
  } | null;
  riskAnalysis?: {
    sharpeRatio?: number;
    maxDrawdown?: number;
    kurtosisWinsorized?: number;
    kurtosis?: number;
    edgeStabilityZScore?: number;
  } | null;
  turnoverAndCostDrag?: {
    annualTurnover?: number;
    avgNetProfitPerTradeBps?: number;
    breakevenSlippageBps?: number;
    capacity?: { alphaMinus10Aum?: number; alphaCollapseAum?: number };
    safetyMarginSlippage?: number;
    confidence?: { zScore?: number };
    avgTradesPerMonth?: number;
  } | null;
  parameterSensitivity?: {
    parameters?: Array<{ name: string; sensitivity?: number }>;
    diagnostics?: { deploymentStatus?: string };
  } | null;
  walkForwardAnalysis?: {
    distribution?: { optimizationReturns?: number[]; validationReturns?: number[] };
    windows?: Array<{
      optimizationReturn?: number;
      validationReturn?: number;
      oosTradesCount?: number;
      diagnosis?: string;
    }>;
    wfaConfig?: { windowLength?: string };
    failedWindows?: { count?: number; total?: number };
  } | null;
  strategy?: { symbol?: string; timeframe?: string; strategyType?: string } | null;
};

export function buildStrategyActionPlanPrecomputed(
  data: DataLike
): StrategyActionPlanPrecomputed | null {
  const avgOos = (data.proBenchmarkMetrics as { avgOosSharpe?: number } | undefined)?.avgOosSharpe;
  const riskSharpe = (data.riskAnalysis as { sharpeRatio?: number } | undefined)?.sharpeRatio;
  const baseSharpe = Number.isFinite(avgOos) ? avgOos! : (Number.isFinite(riskSharpe) ? riskSharpe! : NaN);
  const sharpeSource: SharpeSourceTag | undefined =
    Number.isFinite(avgOos) ? "wfa_avg_oos_sharpe" : (Number.isFinite(riskSharpe) ? "risk" : undefined);
  if (!Number.isFinite(baseSharpe)) return null;

  const baseDdPct = Math.abs(
    ((data.riskAnalysis as { maxDrawdown?: number } | undefined)?.maxDrawdown ??
      0) * 100
  );
  const toc = data.turnoverAndCostDrag as
    | {
        annualTurnover?: number;
        avgNetProfitPerTradeBps?: number;
        breakevenSlippageBps?: number;
      }
    | undefined
    | null;
  const turnoverRatio = Number.isFinite(toc?.annualTurnover)
    ? (toc!.annualTurnover as number)
    : 10;
  const avgNetProfitBps = toc?.avgNetProfitPerTradeBps;
  const breakevenSlippage = toc?.breakevenSlippageBps;

  const blockVerdictEarly = slippageSensitivityBlockVerdict(baseSharpe);
  const slippageImpactRows: SlippageImpactRow[] =
    blockVerdictEarly === "NOT_VIABLE"
      ? []
      : SLIPPAGE_BPS_ROWS.map(({ bps, label }) => {
          const { netSharpe, ddDeltaPct, ddDeltaPctUncapped, verdict } = estimateSlippageImpact(
            baseSharpe,
            baseDdPct,
            turnoverRatio,
            bps,
            avgNetProfitBps,
            breakevenSlippage
          );
          return {
            bps,
            label,
            netSharpe,
            ddDeltaPct,
            ...(ddDeltaPctUncapped != null && { ddDeltaPctUncapped }),
            verdict,
          };
        });

  const untradableRow = slippageImpactRows.find(
    (r) =>
      r.verdict.includes("UNTRADABLE") ||
      (Number.isFinite(r.netSharpe) && r.netSharpe < 0)
  );
  const breakBpsStr = untradableRow?.label?.match(/\d+/)?.[0];
  const capacity = (toc as { capacity?: { alphaMinus10Aum?: number; alphaCollapseAum?: number } })?.capacity;
  const capacityAum = capacity?.alphaMinus10Aum ?? capacity?.alphaCollapseAum;
  let capacityNote: string | undefined;
  if (Number.isFinite(capacityAum) && (capacityAum as number) > 0 && breakBpsStr) {
    const aum = capacityAum as number;
    capacityNote =
      aum >= 1_000_000
        ? `At current pair liquidity, volume limit ~$${(aum / 1_000_000).toFixed(1)}M. Above that, slippage >${breakBpsStr} bps destroys Sharpe. Order-of-magnitude estimate under current assumptions.`
        : aum >= 1_000
          ? `At current pair liquidity, volume limit ~$${(aum / 1_000).toFixed(0)}k. Above that, slippage >${breakBpsStr} bps destroys Sharpe. Order-of-magnitude estimate under current assumptions.`
          : `At current pair liquidity, volume limit ~$${aum.toFixed(0)}. Above that, slippage >${breakBpsStr} bps destroys Sharpe. Order-of-magnitude estimate under current assumptions.`;
  } else if (breakBpsStr) {
    capacityNote = `Strategy breaks at ${breakBpsStr} bps slippage; scale volume with caution.`;
  }

  const netSharpe10bps = slippageImpactRows.find((r) => r.bps === 10)?.netSharpe ?? NaN;
  let proNote: string | undefined;
  if (
    Number.isFinite(breakevenSlippage) &&
    (breakevenSlippage as number) < 15 &&
    Number.isFinite(netSharpe10bps) &&
    netSharpe10bps < 0.2
  ) {
    proNote =
      (breakevenSlippage as number) < 10
        ? "The highest risk is Slippage Sensitivity. Switch to Limit Orders only before increasing position size."
        : "The highest risk is Slippage Sensitivity. Use Post-Only Limit orders; OOS Retention may be strong but execution cost is critical.";
  } else if (Number.isFinite(breakevenSlippage) && (breakevenSlippage as number) < 15) {
    proNote = "The highest risk is Slippage Sensitivity. Even though OOS Retention is strong, we recommend using Limit Orders only before increasing position size.";
  } else if (Number.isFinite(netSharpe10bps) && netSharpe10bps < 0.2) {
    proNote = "The highest risk is Net Sharpe at 10 bps. Reduce costs or improve edge before scaling.";
  }

  const pro = data.proBenchmarkMetrics as DataLike["proBenchmarkMetrics"];
  const risk = data.riskAnalysis as DataLike["riskAnalysis"];
  const tocExtended = data.turnoverAndCostDrag as DataLike["turnoverAndCostDrag"];
  const wfa = data.walkForwardAnalysis as DataLike["walkForwardAnalysis"];
  const strategy = data.strategy as DataLike["strategy"];
  const params = (data.parameterSensitivity?.parameters ?? []) as Array<{ name: string; sensitivity?: number }>;

  const medianWfe = pro?.wfeDistribution?.median;
  const psi = pro?.parameterStabilityIndex ?? NaN;
  const oosRetention = pro?.oosRetention ?? NaN;
  const edgeHalfLifeDays = pro?.edgeHalfLife?.days ?? NaN;
  const killSwitchNum = pro?.killSwitchMaxOosDrawdownWindows ?? 0;
  const regimeSurvivalMatrix = pro?.regimeSurvivalMatrix;
  const hasRegimeData =
    regimeSurvivalMatrix != null && Object.keys(regimeSurvivalMatrix).length > 0;
  const regimePassCount = hasRegimeData
    ? ["Trend", "Range", "HighVol"].filter((r) => regimeSurvivalMatrix?.[r]?.pass).length
    : 0;

  const failedWindows = wfa?.failedWindows ?? (wfa as { failedWindows?: { count?: number; total?: number } })?.failedWindows;
  const wfaFailCount = failedWindows?.count ?? null;
  const wfaFailTotal = failedWindows?.total ?? null;
  const failRatio =
    wfaFailTotal != null && wfaFailTotal > 0 && wfaFailCount != null
      ? wfaFailCount / wfaFailTotal
      : NaN;

  const isReturns: number[] = [];
  const oosReturns: number[] = [];
  if (Array.isArray(wfa?.distribution?.optimizationReturns)) {
    isReturns.push(...wfa.distribution.optimizationReturns);
  }
  if (Array.isArray(wfa?.distribution?.validationReturns)) {
    oosReturns.push(...wfa.distribution.validationReturns);
  }
  if (
    isReturns.length === 0 &&
    oosReturns.length === 0 &&
    Array.isArray(wfa?.windows)
  ) {
    for (const w of wfa.windows) {
      const opt = w.optimizationReturn;
      const val = w.validationReturn;
      if (Number.isFinite(opt)) isReturns.push(opt as number);
      if (Number.isFinite(val)) oosReturns.push(val as number);
    }
  }
  const sharpeIs = pseudoSharpeFromReturns(isReturns);
  const sharpeOos = pseudoSharpeFromReturns(oosReturns);
  const oosBetterThanIs =
    Number.isFinite(sharpeOos) &&
    Number.isFinite(sharpeIs) &&
    (sharpeOos as number) > (sharpeIs as number);

  const wfaWindowDays =
    wfa?.wfaConfig?.windowLength != null
      ? parseWfaWindowDays(wfa.wfaConfig.windowLength)
      : null;
  const pumpkinExhaustion =
    Number.isFinite(edgeHalfLifeDays) &&
    wfaWindowDays != null &&
    wfaWindowDays > 0 &&
    edgeHalfLifeDays < 2 * wfaWindowDays;
  const pumpkinExhaustionDays = pumpkinExhaustion ? Math.round(edgeHalfLifeDays) : null;

  const wfaWindows = wfa?.windows ?? [];
  const wfeFilteredCount = (pro as { wfeValidWindowCount?: number })?.wfeValidWindowCount ?? null;
  let medianWfeUnbiased: number | undefined;
  let wfeUnbiasedCount = 0;
  if (Array.isArray(wfaWindows) && wfaWindows.length > 0) {
    const allRatios: number[] = [];
    for (const w of wfaWindows) {
      const opt = w.optimizationReturn;
      const val = w.validationReturn;
      if (typeof opt !== "number" || typeof val !== "number" || !Number.isFinite(opt) || !Number.isFinite(val)) {
        allRatios.push(0);
        continue;
      }
      if (opt <= 0) allRatios.push(0);
      else allRatios.push(val / opt);
    }
    wfeUnbiasedCount = allRatios.length;
    if (allRatios.length > 0) medianWfeUnbiased = medianOfSorted(allRatios);
  }
  const oosZeroActivityCount = Array.isArray(wfaWindows)
    ? wfaWindows.reduce((acc, w) => {
        const oosTrades = w.oosTradesCount;
        const diagnosis = w.diagnosis;
        if (oosTrades === 0 || diagnosis === "Dead Zone (Inactivity)") return acc + 1;
        return acc;
      }, 0)
    : 0;
  const oosTotalCount = Array.isArray(wfaWindows) ? wfaWindows.length : 0;
  const zombieShare =
    oosTotalCount > 0 && oosZeroActivityCount != null
      ? oosZeroActivityCount / oosTotalCount
      : NaN;

  const phase2WfeThreshold =
    Number.isFinite(baseSharpe) && baseSharpe < 1
      ? 0.7
      : Number.isFinite(baseSharpe) && baseSharpe > 2
        ? 0.5
        : 0.6;

  let phase: "READY" | "INCUBATE" | "RE_RESEARCH" | "CAUTION" | "REJECT" =
    Number.isFinite(medianWfe) &&
    ((medianWfe as number) < 0.5 || (Number.isFinite(psi) && psi > 0.4))
      ? "RE_RESEARCH"
      : Number.isFinite(netSharpe10bps) && netSharpe10bps < 0.2
        ? "RE_RESEARCH"
        : baseSharpe > 0.7 && regimePassCount >= 2
          ? "READY"
          : Number.isFinite(medianWfe) &&
              (medianWfe as number) > 0.6 &&
              Number.isFinite(netSharpe10bps) &&
              netSharpe10bps > 0.3
            ? "INCUBATE"
            : baseSharpe > 0.5
              ? "INCUBATE"
              : baseSharpe >= 0.4
                ? "CAUTION"
                : "REJECT";

  if (baseSharpe <= 0) {
    phase = "REJECT";
  }

  let phase1Label =
    phase === "RE_RESEARCH" ? "RE-RESEARCH REQUIRED" : "Incubation (Current)";
  if (baseSharpe <= 0) phase1Label = "NOT VIABLE";

  const reResearchReasons: string[] = [];
  if (phase === "RE_RESEARCH") {
    if (Number.isFinite(medianWfe) && (medianWfe as number) < 0.5) reResearchReasons.push("WFE < 0.5");
    if (Number.isFinite(psi) && psi > 0.4) reResearchReasons.push("PSI > 0.4");
    if (Number.isFinite(netSharpe10bps) && netSharpe10bps < 0.2) reResearchReasons.push("Net Sharpe (10 bps) < 0.2");
  }
  const fragileParams = params
    .filter((p) => (p.sensitivity ?? 0) >= 0.6)
    .sort((a, b) => (b.sensitivity ?? 0) - (a.sensitivity ?? 0))
    .slice(0, 3)
    .map((p) => p.name ?? "param")
    .filter(Boolean);
  const fragileParamList = fragileParams.length > 0 ? fragileParams.join(", ") : null;
  const fragileCount = params.filter((p) => (p.sensitivity ?? 0) >= 0.6).length;
  if (fragileCount > 0) {
    reResearchReasons.push(`Fragile params (>=0.6): ${fragileCount}`);
  }
  const mostSensitiveParam =
    params.length > 0
      ? params.reduce((a, b) =>
          (a?.sensitivity ?? 0) > (b?.sensitivity ?? 0) ? a : b
        )
      : undefined;
  const mostSensitiveParamName = mostSensitiveParam?.name ?? null;

  const avgTradesPerMonth = tocExtended?.avgTradesPerMonth ?? NaN;
  const highFreqForReResearch = Number.isFinite(avgTradesPerMonth) && avgTradesPerMonth > 20;
  let monitoringText: string;
  if (baseSharpe <= 0) {
    monitoringText = `Observation without capital. Track ${mostSensitiveParamName ?? "most sensitive parameter"} to detect when OOS Sharpe becomes positive.`;
  } else if (phase === "RE_RESEARCH") {
    monitoringText =
      reResearchReasons.length > 0
        ? `RE-RESEARCH required (${reResearchReasons.join(", ")}).${highFreqForReResearch ? " Check for execution collisions and toxic flow (Adverse Selection)." : ""}`
        : `RE-RESEARCH required (robustness thresholds not met).${highFreqForReResearch ? " Check for execution collisions and toxic flow (Adverse Selection)." : ""}`;
  } else {
    monitoringText = `Focus on ${mostSensitiveParamName ?? "most sensitive parameter"}`;
  }

  const tradesPerMonth = tocExtended?.avgTradesPerMonth ?? NaN;
  const lowFreq = Number.isFinite(tradesPerMonth) && tradesPerMonth < 5;
  let allocationText: string;
  if (baseSharpe <= 0) {
    allocationText = "0% - strategy not viable (negative base Sharpe). Do not allocate.";
  } else if (phase === "RE_RESEARCH") {
    allocationText = lowFreq
      ? "0% - do not deploy until re-optimized. Add 2 more years of data or increase trade frequency to >5/mo."
      : "0% - do not deploy until re-optimized. Add 2 more years of data or reduce parameter count (extend data vs complexity).";
  } else {
    allocationText = "10–20% of target capital";
  }

  const killSwitchDisplay =
    baseSharpe <= 0
      ? "TRIGGERED"
      : wfaFailCount != null && wfaFailTotal != null && wfaFailTotal > 0
        ? `${wfaFailCount}/${wfaFailTotal}`
        : String(killSwitchNum);

  const safetyMargin = tocExtended?.safetyMarginSlippage ?? NaN;
  const zScore =
    tocExtended?.confidence?.zScore ?? risk?.edgeStabilityZScore ?? NaN;
  const kurtosis = risk?.kurtosisWinsorized ?? risk?.kurtosis ?? NaN;

  const failRatioOver50 = Number.isFinite(failRatio) && failRatio > 0.5;
  const wfeLow = Number.isFinite(medianWfe) && (medianWfe as number) < 0.5;
  const retentionHigh = Number.isFinite(oosRetention) && oosRetention >= 0.85;
  const systemConflictCritical =
    retentionHigh && failRatioOver50;
  const systemConflictWarning =
    retentionHigh && !failRatioOver50 && wfeLow;
  const systemConflictMessageCritical = systemConflictCritical
    ? `Conflict A (Critical): Fail ratio > 50% (${Number.isFinite(failRatio) ? Math.round(failRatio * 100) : "n/a"}% windows failed). Use pessimistic scenario; Phase 2 not applicable.`
    : undefined;
  const systemConflictMessageWarning = systemConflictWarning
    ? `Conflict B (Warning): WFE ${Number.isFinite(medianWfe) ? (medianWfe as number).toFixed(2) : "n/a"} below threshold (0.5–0.7). Conservative allocation and extended monitoring recommended.`
    : undefined;
  const systemConflictDetected = systemConflictCritical || systemConflictWarning;
  const systemConflictMessage = systemConflictCritical
    ? systemConflictMessageCritical
    : systemConflictWarning
      ? systemConflictMessageWarning
      : undefined;

  const symbol = strategy?.symbol;
  const isMajorPair =
    symbol != null &&
    (String(symbol).toUpperCase().includes("BTC") || String(symbol).toUpperCase().includes("ETH"));
  const assumedSpreadBps = symbol == null ? 3 : isMajorPair ? 2 : 5;
  const executionEfficiencyRatio =
    Number.isFinite(breakevenSlippage) &&
    breakevenSlippage != null &&
    (breakevenSlippage as number) > 0
      ? assumedSpreadBps / Math.max(breakevenSlippage as number, 0.5)
      : NaN;

  const strategyType = strategy?.strategyType;
  const timeframe = strategy?.timeframe;
  const lowTf = timeframe != null && /^(\d+)?m$/i.test(String(timeframe).trim());
  const highFreq = Number.isFinite(avgTradesPerMonth) && avgTradesPerMonth > 30;
  const showLatencySensitivity =
    (strategyType != null && String(strategyType).toLowerCase().trim() === "scalping") ||
    (!!lowTf && !!highFreq);

  const recommendations: StrategyActionPlanRecommendation[] = [];
  if (Number.isFinite(medianWfe) && (medianWfe as number) < 0.5) {
    if (Number.isFinite(psi) && psi >= 0.5) {
      recommendations.push({
        target: "Regime Drift",
        msg: "Update lookback window or add Regime Filter (Trend/Range detector).",
        impact: "High",
      });
    } else {
      recommendations.push({
        target: "Model Complexity",
        msg: "Simplify logic: reduce indicator count or increase smoothing period. Merge correlated indicators into one signal.",
        impact: "High",
      });
    }
  } else if (Number.isFinite(psi) && psi < 0.5) {
    recommendations.push({
      target: "Parameter Stability",
      msg: "Replace hard thresholds with adaptive bands (e.g. volatility-based channels).",
      impact: "High",
    });
  }
  if (Number.isFinite(safetyMargin) && safetyMargin < 2) {
    recommendations.push({
      target: "Execution / Liquidity",
      msg: "Switch to Maker-only execution or increase timeframe to raise profit per trade.",
      impact: "Critical",
    });
  }
  if (Number.isFinite(zScore) && zScore < 1.96) {
    recommendations.push({
      target: "Statistical Significance",
      msg: "Extend test by +2 years or add instruments with low cross-correlation (ρ < 0.3) to generate independent observations. Correlated instruments share the same market regime and do not increase effective sample size.",
      impact: "High",
    });
  }
  if (Number.isFinite(kurtosis) && kurtosis > 5) {
    recommendations.push({
      target: "Tail Risk",
      msg: "Add a hard tail stop or halve leverage.",
      impact: "High",
    });
  }
  if (Number.isFinite(breakevenSlippage)) {
    if ((breakevenSlippage as number) < 10) {
      recommendations.push({
        target: "Execution Engine",
        msg: "Switch to Limit Orders only. Edge too thin for Market orders or high-fee exchanges.",
        impact: "Critical",
      });
    } else if ((breakevenSlippage as number) < 15) {
      recommendations.push({
        target: "Execution Engine",
        msg: "Use Post-Only Limit orders to avoid spread costs.",
        impact: "High",
      });
    }
  }
  if (Number.isFinite(netSharpe10bps) && netSharpe10bps < 0.2) {
    recommendations.push({
      target: "Execution",
      msg: "Net Sharpe at 10 bps below 0.2. Reduce costs or improve edge before scaling.",
      impact: "High",
    });
  }
  if (Number.isFinite(edgeHalfLifeDays) && edgeHalfLifeDays < 90) {
    recommendations.push({
      target: "Logic",
      msg: "Short Alpha Half-life (~3 mo). Use dynamic re-optimization or shorter trading cycle.",
      impact: "Medium",
    });
  }
  if (Number.isFinite(avgTradesPerMonth) && avgTradesPerMonth < 5) {
    recommendations.push({
      target: "Signal Density",
      msg: "Current signal density is too low for validation. Consider loosening entry filters or moving to a lower timeframe to reach at least 5 trades/month. Without more data, the strategy remains in 'Gambling Zone'.",
      impact: "Critical",
    });
  }
  if (fragileParams.length > 0) {
    const paramName = fragileParams[0];
    recommendations.push({
      target: "Sensitivity Overload",
      msg: `The strategy relies on a 'Profit Island' in parameter ${paramName}. Apply a 3x3 Parameter Stress Test. If nearby values are loss-making, remove this parameter or use its median value for robustness.`,
      impact: "High",
    });
  }
  if (Number.isFinite(zombieShare) && zombieShare >= 0.8) {
    recommendations.push({
      target: "Logic Paralysis",
      msg: "80% of OOS windows show zero activity. Entry logic is too restrictive for current volatility. Introduce a 'Volatility Floor' or an adaptive ATR-based entry threshold to avoid logic paralysis.",
      impact: "High",
    });
  }

  const textPayload: StrategyActionPlanTextPayload = {
    ...(capacityNote && { capacityNote }),
    ...(proNote && { proNote }),
    ...(reResearchReasons.length > 0 && { reResearchReasons }),
  };

  return {
    slippageImpactRows,
    textPayload,
    ...(sharpeSource && { sharpeSource }),
    ...(blockVerdictEarly === "NOT_VIABLE" && { slippageBlockVerdict: "NOT_VIABLE" as const }),
    baseSharpe: Number.isFinite(baseSharpe) ? baseSharpe : undefined,
    netSharpe10bps: Number.isFinite(netSharpe10bps) ? netSharpe10bps : undefined,
    phase,
    phase1Label,
    phase2WfeThreshold,
    reResearchReasons: reResearchReasons.length > 0 ? reResearchReasons : undefined,
    recommendations: recommendations.length > 0 ? recommendations : undefined,
    ...(systemConflictDetected && { systemConflictDetected: true, systemConflictMessage }),
    ...(systemConflictCritical && { systemConflictCritical: true, systemConflictMessageCritical }),
    ...(systemConflictWarning && { systemConflictWarning: true, systemConflictMessageWarning }),
    ...(Number.isFinite(medianWfeUnbiased) && { medianWfeUnbiased, wfeUnbiasedCount }),
    ...(wfeFilteredCount != null && { wfeFilteredCount }),
    ...(typeof oosBetterThanIs === "boolean" && { oosBetterThanIs }),
    ...(Number.isFinite(executionEfficiencyRatio) && { executionEfficiencyRatio }),
    monitoringText,
    allocationText,
    killSwitchDisplay,
    ...(wfaFailCount != null && { wfaFailCount }),
    ...(wfaFailTotal != null && { wfaFailTotal }),
    ...(pumpkinExhaustion && { pumpkinExhaustion: true, pumpkinExhaustionDays }),
    ...(Number.isFinite(zombieShare) && { zombieShare }),
    hasRegimeData,
    regimePassCount,
    mostSensitiveParamName: mostSensitiveParamName ?? undefined,
    fragileCount,
    fragileParamList: fragileParamList ?? undefined,
    ...(Number.isFinite(edgeHalfLifeDays) && { edgeHalfLifeDays }),
    ...(Number.isFinite(oosRetention) && { oosRetention }),
    ...(Number.isFinite(failRatio) && { failRatio }),
    ...(Number.isFinite(medianWfe) && { medianWfe }),
    showLatencySensitivity: showLatencySensitivity || undefined,
    ...(Number.isFinite(breakevenSlippage) && { breakevenSlippage: breakevenSlippage as number }),
  };
}
