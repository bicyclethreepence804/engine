import type { TestResultDataLike } from "./analysisReportTypes";
import { engineWarn } from "./logger";

const TOLERANCE = 1e-4;

function toNum(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  return v;
}

function calcRetention(oosReturns: number[], isReturns: number[]): number | null {
  if (oosReturns.length === 0 || isReturns.length === 0) return null;
  if (oosReturns.length !== isReturns.length) return null;
  const meanIs = isReturns.reduce((a, b) => a + b, 0) / isReturns.length;
  const meanOos = oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length;
  if (!Number.isFinite(meanIs) || Math.abs(meanIs) < 1e-12) return null;
  return meanOos / meanIs;
}

function calcDegradation(oosReturns: number[], isReturns: number[]): number | null {
  if (oosReturns.length === 0 || isReturns.length === 0) return null;
  if (oosReturns.length !== isReturns.length) return null;
  const meanIs = isReturns.reduce((a, b) => a + b, 0) / isReturns.length;
  const meanOos = oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length;
  if (!Number.isFinite(meanIs) || Math.abs(meanIs) < 1e-12) return null;
  return (meanOos - meanIs) / Math.abs(meanIs);
}

export interface ValidateReportInvariantsResult {
  ok: boolean;
  errors: string[];
}

export interface ValidateReportInvariantsOptions {
  throw?: boolean;
}

export class InvariantError extends Error {
  constructor(public readonly violations: string[]) {
    super(`Invariant violations: ${violations.join("; ")}`);
    this.name = "InvariantError";
  }
}

export function validateReportInvariants(
  report: TestResultDataLike | null,
  opts: ValidateReportInvariantsOptions = {},
): ValidateReportInvariantsResult {
  const errors: string[] = [];
  if (!report || typeof report !== "object") {
    errors.push("Report is null or not an object");
    return { ok: false, errors };
  }

  const reportObj = report as Record<string, unknown>;
  const pro = report.proBenchmarkMetrics as Record<string, unknown> | undefined;
  const results = report.results as Record<string, unknown> | undefined;
  const wfa = report.walkForwardAnalysis as { periods?: unknown[]; windows?: unknown[] } | undefined;
  const periods = (wfa?.periods ?? wfa?.windows) ?? [];
  const periodsAny = periods as Array<Record<string, unknown>>;
  const periodCount = Array.isArray(periods) ? periods.length : 0;
  const isMultiWindowWfa = periodCount > 1;

  const totalReturn = toNum(results?.totalReturn);
  const sumIs = toNum(pro?.sumIs);
  const sumOos = toNum(pro?.sumOos);
  const oosRetention = toNum(pro?.oosRetention);
  const optimizationGain = toNum(pro?.optimizationGain);
  const performanceDegradation = toNum(pro?.performanceDegradation);

  if (sumIs != null && sumOos != null && sumIs !== 0 && Math.abs(sumIs) > 1e-12) {
    const expectedRetention = sumOos / sumIs;
    if (oosRetention != null && Math.abs(oosRetention - expectedRetention) > TOLERANCE) {
      errors.push(`oosRetention ${oosRetention} should equal sumOos/sumIs = ${expectedRetention}`);
    }
    const expectedGain = sumIs - sumOos;
    if (optimizationGain != null && Math.abs(optimizationGain - expectedGain) > TOLERANCE) {
      errors.push(`optimizationGain ${optimizationGain} should equal sumIs-sumOos = ${expectedGain}`);
    }
  }

  const TOLERANCE_FORMULAS = 0.02;
  if (Array.isArray(periods) && periods.length >= 2) {
    const isReturns = periodsAny
      .map((p: Record<string, unknown>) => toNum(p.optimizationReturn ?? p.optimization_return))
      .filter((v): v is number => v != null && Number.isFinite(v));
    const oosReturns = periodsAny
      .map((p: Record<string, unknown>) => toNum(p.validationReturn ?? p.validation_return))
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (isReturns.length === oosReturns.length && isReturns.length >= 2) {
      const canonicalRetention = calcRetention(oosReturns, isReturns);
      const canonicalDegradation = calcDegradation(oosReturns, isReturns);
      if (oosRetention != null && canonicalRetention != null && Math.abs(oosRetention - canonicalRetention) > TOLERANCE_FORMULAS) {
        errors.push(`oosRetention ${oosRetention} should match metrics-formulas calcRetention = ${canonicalRetention}`);
      }
      if (performanceDegradation != null && canonicalDegradation != null && Math.abs(performanceDegradation - canonicalDegradation) > TOLERANCE_FORMULAS) {
        errors.push(`performanceDegradation ${performanceDegradation} should match metrics-formulas calcDegradation = ${canonicalDegradation}`);
      }
      const meanIs = isReturns.reduce((a, b) => a + b, 0) / isReturns.length;
      if (oosRetention != null && performanceDegradation != null && Math.abs(meanIs) > 1e-9) {
        const expectedDegradation = meanIs > 0 ? oosRetention - 1 : -(oosRetention - 1);
        if (Math.abs(performanceDegradation - expectedDegradation) > TOLERANCE_FORMULAS) {
          errors.push(`performanceDegradation ${performanceDegradation} should equal ${meanIs > 0 ? "retention - 1" : "-(retention - 1)"} = ${expectedDegradation} (canonical mean OOS/IS)`);
        }
        if (meanIs > 0 && (oosRetention > 1) !== (performanceDegradation > 0)) {
          errors.push(`When mean(IS) > 0: oosRetention > 1 (${oosRetention > 1}) must match performanceDegradation > 0 (${performanceDegradation > 0})`);
        }
        if (meanIs < 0 && (oosRetention > 1) === (performanceDegradation > 0)) {
          errors.push("When mean(IS) < 0: oosRetention > 1 and performanceDegradation should have opposite sign relation");
        }
      }
    }
  }

  if (oosRetention != null && oosRetention > 1 && performanceDegradation != null) {
    if (sumIs != null && sumOos != null && sumIs > 0 && sumOos > 0 && performanceDegradation <= 0) {
      errors.push(`oosRetention ${oosRetention} > 100% with positive IS/OOS (OOS better) but performanceDegradation ${performanceDegradation} is non-positive; expected positive`);
    }
    if (sumIs != null && sumOos != null && sumIs < 0 && sumOos < 0 && performanceDegradation >= 0) {
      errors.push(`oosRetention ${oosRetention} > 100% with negative IS/OOS (OOS worse) but performanceDegradation ${performanceDegradation} is non-negative; expected negative`);
    }
  }

  if (isMultiWindowWfa && sumOos != null && totalReturn != null) {
    if (Math.abs(totalReturn - sumOos) > TOLERANCE) {
      errors.push(`Multi-window WFA: totalReturn ${totalReturn} should equal sumOos ${sumOos}`);
    }
  }

  const wfeDist = pro?.wfeDistribution as { median?: number } | undefined;
  const medianWfe = wfeDist != null ? toNum(wfeDist.median) : undefined;
  const validIsCount = Array.isArray(periods)
    ? periodsAny.filter((p: Record<string, unknown>) => toNum(p.optimizationReturn ?? p.optimization_return) != null && (toNum(p.optimizationReturn ?? p.optimization_return) as number) > 0).length
    : 0;
  if (periodCount >= 3) {
    if (validIsCount >= 3 && (medianWfe == null || !Number.isFinite(medianWfe))) {
      if (!(oosRetention != null && oosRetention > 0.5)) {
        errors.push(`WFA has ${validIsCount} periods with IS>0 but wfeDistribution.median is missing or not finite`);
      }
    }
    if (validIsCount < 3 && medianWfe != null && Number.isFinite(medianWfe)) {
      errors.push(`WFA has only ${validIsCount} periods with IS>0; wfeDistribution.median should be N/A but is ${medianWfe}`);
    }
    if (validIsCount >= 3 && oosRetention != null && oosRetention > 0.5 && medianWfe != null && Number.isFinite(medianWfe) && Math.abs(medianWfe) < 0.05) {
      errors.push(`WFE median ${medianWfe} inconsistent with OOS Retention ${oosRetention} (both from WFA; high retention implies WFE not near 0)`);
    }
  }

  const wfeMin = wfeDist != null ? toNum((wfeDist as Record<string, unknown>).min) : undefined;
  const wfeMax = wfeDist != null ? toNum((wfeDist as Record<string, unknown>).max) : undefined;
  const wfeVariance = wfeDist != null ? toNum((wfeDist as Record<string, unknown>).variance) : undefined;
  if (medianWfe != null && Number.isFinite(medianWfe) && wfeMin != null && wfeMax != null && Number.isFinite(wfeMin) && Number.isFinite(wfeMax)) {
    if (wfeMin > medianWfe + TOLERANCE || medianWfe > wfeMax + TOLERANCE) {
      errors.push(`wfeDistribution: min ${wfeMin} <= median ${medianWfe} <= max ${wfeMax} violated`);
    }
  }
  if (wfeVariance != null && Number.isFinite(wfeVariance) && wfeVariance < 0) {
    errors.push(`wfeDistribution.variance ${wfeVariance} must be non-negative`);
  }

  const registry = pro?.metricsRegistry as Record<string, { n_used?: number; n_negative_wfe?: number; n_positive_wfe?: number }> | undefined;
  const wfeRegistry = registry?.WFE;
  if (wfeRegistry != null && typeof wfeRegistry.n_used === "number") {
    const nUsed = wfeRegistry.n_used;
    const nNeg = wfeRegistry.n_negative_wfe ?? 0;
    const nPos = wfeRegistry.n_positive_wfe ?? 0;
    if (nNeg + nPos !== nUsed) {
      errors.push(`metricsRegistry.WFE: n_negative_wfe (${nNeg}) + n_positive_wfe (${nPos}) must equal n_used (${nUsed})`);
    }
  }

  const strategyActionPlan = reportObj.strategyActionPlanPrecomputed as Record<string, unknown> | undefined;
  if (strategyActionPlan) {
    const rows = strategyActionPlan.slippageImpactRows as unknown[] | undefined;
    const verdict = strategyActionPlan.slippageBlockVerdict as string | undefined;
    const baseSharpe = toNum(strategyActionPlan.baseSharpe);
    if (baseSharpe != null && baseSharpe < 0) {
      if (Array.isArray(rows) && rows.length > 0) {
        errors.push(`baseSharpe < 0 but slippageImpactRows.length = ${rows.length} (should be 0)`);
      }
      if (verdict !== "NOT_VIABLE") {
        errors.push(`baseSharpe < 0 but slippageBlockVerdict = ${verdict} (should be NOT_VIABLE)`);
      }
    }
  }

  const toc = report.turnoverAndCostDrag as Record<string, unknown> | undefined;
  if (toc?.marketImpactOutOfRange === true) {
    const impact = toNum(toc.marketImpactPct);
    const drag = toNum(toc.totalCostDragPct);
    if (impact != null && (impact > 1 || impact < -1)) {
      errors.push(`marketImpactOutOfRange true but marketImpactPct = ${impact} (should be capped ±1 or N/A)`);
    }
    if (drag != null && drag < -1) {
      errors.push(`marketImpactOutOfRange true but totalCostDragPct = ${drag} (should be >= -1)`);
    }
  }

  const verdictPayload = reportObj.verdictPayload as Record<string, unknown> | undefined;
  const deploymentGate = verdictPayload?.deploymentGate as Array<{ label?: string; notApplicable?: boolean; value?: number | null; threshold?: number; passed?: boolean | null }> | undefined;
  const wfeValidWindowCount = toNum((pro as Record<string, unknown>)?.wfeValidWindowCount);
  const wfeFromWfa = toNum((wfa as Record<string, unknown>)?.wfe);
  const wfeNa = (wfeFromWfa == null || !Number.isFinite(wfeFromWfa)) && (wfeValidWindowCount === 0 || wfeValidWindowCount == null);
  if (Array.isArray(deploymentGate) && wfeNa) {
    const wfeGate = deploymentGate.find((g) => g.label?.includes("WFE") || g.label?.includes("Stability"));
    if (wfeGate && !wfeGate.notApplicable && wfeGate.value === 0 && wfeGate.threshold === 0.5) {
      errors.push("WFE N/A but deployment gate shows 0 vs 0.5 (should be notApplicable)");
    }
  }

  const wfaPassProb = toNum(pro?.wfaPassProbability);
  const bayesianInVerdict = verdictPayload != null ? toNum(verdictPayload.bayesianPassProbability) : undefined;
  if (wfaPassProb != null && bayesianInVerdict != null) {
    const expected = Math.round(Math.max(0, Math.min(1, wfaPassProb)) * 100);
    if (Math.abs(bayesianInVerdict - expected) > 1) {
      errors.push(`verdictPayload.bayesianPassProbability ${bayesianInVerdict} should be within 1 of round(wfaPassProbability*100) = ${expected}`);
    }
  }

  const issues = reportObj.integrityIssues as Array<{ message: string }> | undefined;
  if (Array.isArray(issues) && !isMultiWindowWfa) {
    const dataDriftSingle = issues.some((i) => i.message?.includes("Total return does not match optimization return"));
    if (dataDriftSingle) {
      errors.push("Single-run report has Data Drift (optimization return) integrity issue");
    }
  }

  if (sumIs != null && sumIs <= 0 && Array.isArray(issues)) {
    const paradox = issues.some((i) => i.message?.includes("Retention/Gain Paradox"));
    if (paradox) {
      errors.push("sumIs <= 0 but Retention/Gain Paradox reported");
    }
  }

  const winrate = toNum((results as Record<string, unknown>)?.winRate) ?? toNum(pro?.winrate);
  if (winrate != null) {
    if (winrate < 0 || winrate > 1) {
      errors.push(`winrate ${winrate} must be in [0, 1]`);
    }
  }

  const robustnessScore = report.robustnessScore as {
    overall?: number;
    blockedByModule?: string;
    blockedByModules?: string[];
  } | null | undefined;
  const overall = robustnessScore != null ? toNum(robustnessScore.overall) : undefined;
  if (overall != null) {
    if (overall < 0 || overall > 100) {
      errors.push(`robustness overall ${overall} must be in [0, 100]`);
    }
  }

  const blockedByModule = robustnessScore?.blockedByModule;
  const blockedByModules = robustnessScore?.blockedByModules;
  const dataQualityBlocks =
    blockedByModule === "dataQuality" ||
    (Array.isArray(blockedByModules) && blockedByModules.includes("dataQuality"));
  if (dataQualityBlocks && overall != null && overall !== 0) {
    errors.push(`blockedByModule/blockedByModules includes dataQuality but robustness overall is ${overall} (should be 0)`);
  }

  if (performanceDegradation != null && performanceDegradation < -1) {
    const caveats = (pro as Record<string, unknown>)?.performanceDegradationCaveats as string[] | undefined;
    if (!Array.isArray(caveats) || caveats.length === 0) {
      errors.push("performanceDegradation < -1 but performanceDegradationCaveats is missing or empty (user warning required)");
    }
  }

  const buckets = pro?.benchmarkMetricsBuckets as Record<string, { oosMaxDrawdown?: number }> | undefined;
  const oosMaxDrawdownBucket = buckets?.oosEquityBased?.oosMaxDrawdown;
  const avgOosCalmar = toNum(pro?.avgOosCalmar);
  const avgOosMeanReturn = toNum(pro?.avgOosMeanReturn);
  const oosMaxDrawdownFromWfa = toNum((pro as Record<string, unknown>)?.oosMaxDrawdownFromWfa);
  if (oosMaxDrawdownBucket != null && Math.abs(oosMaxDrawdownBucket) < 1e-12 && avgOosCalmar != null && Number.isFinite(avgOosCalmar)) {
    errors.push("OOS maxDrawdown is 0 but avgOosCalmar is set (should be undefined; Calmar division-by-zero bug)");
  }
  if (
    avgOosCalmar != null && Number.isFinite(avgOosCalmar) &&
    avgOosMeanReturn != null && Number.isFinite(avgOosMeanReturn) &&
    oosMaxDrawdownFromWfa != null && Number.isFinite(oosMaxDrawdownFromWfa) && Math.abs(oosMaxDrawdownFromWfa) > 1e-9
  ) {
    const expectedCalmar = avgOosMeanReturn / Math.abs(oosMaxDrawdownFromWfa);
    if (Math.abs(avgOosCalmar - expectedCalmar) > TOLERANCE_FORMULAS) {
      errors.push(`avgOosCalmar ${avgOosCalmar} should equal expOosReturn/|oosMaxDD| = ${expectedCalmar.toFixed(4)} (canonical OOS return)`);
    }
  }

  if (errors.length > 0 && opts.throw) {
    throw new InvariantError(errors);
  }
  if (errors.length > 0) {
    engineWarn("invariant_violations", { violations: errors });
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}
