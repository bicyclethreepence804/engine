/**
 * Layer 2.5 metric definition contract (types + API slice).
 * See docs/METRIC_DEFINITION_CONTRACT_LAYER_2_5.md.
 */

export type CanonicalSourceType = "fullBacktestMetrics" | "oosMetrics" | "wfaWindowMetrics";

export interface MetricFormula {
  description: string;
  pseudocode: string;
  inputFields: string[];
  computationFunc: string;
}

export interface MetricValidRange {
  min: number | null;
  max: number | null;
  description: string;
}

export interface MetricThresholds {
  fail?: number;
  warn?: number;
  pass?: number;
  note: string;
}

export interface MetricApplicability {
  requiresMinPeriods: number;
  requiresMinTrades: number;
  requiresPositiveIS?: boolean;
  requiresMeanISNotZero?: boolean;
  fallback: string | null;
}

export interface MetricChangelogEntry {
  version: string;
  date: string;
  change: string;
}

export interface MetricDefinition {
  metricName: string;
  version: string;
  definition: string;
  canonicalSource: CanonicalSourceType;
  formula: MetricFormula;
  validRange: MetricValidRange;
  thresholds: MetricThresholds;
  applicability: MetricApplicability;
  uiLabel: string;
  uiTooltip: string;
  uiFormat: string;
  changelog: MetricChangelogEntry[];
}

export type MetricVerdict =
  | "FAIL"
  | "WARN"
  | "PASS"
  | "KILL"
  | "N/A"
  | "NOT_VIABLE"
  | "VIABLE"
  | "MARGINAL";

export interface WfeWindowClassification {
  normal: number;
  recovery: number;
  doubleNegative: number;
  undefined: number;
}

export interface MetricResult<T = number | null> {
  value: T;
  definition: MetricDefinition;
  verdict: MetricVerdict;
  source?: string;
  caveats?: string[];
  definitionVersion: string;
  wfeDistribution?: {
    min: number;
    median: number;
    max: number;
    variance: number;
    nNegativeWfe?: number;
    nPositiveWfe?: number;
  };
  wfeValidWindowCount?: number;
  wfeWindowClassification?: WfeWindowClassification;
  profitableAmongPositiveIsCount?: number;
}

export interface MetricDefinitionForApi {
  metricName: string;
  version: string;
  definition: string;
  canonicalSource: CanonicalSourceType;
  formulaDescription: string;
  formulaPseudocode: string;
  uiLabel: string;
  uiTooltip: string;
  thresholdsNote: string;
  validRangeDescription: string;
}

export function toMetricDefinitionForApi(d: MetricDefinition): MetricDefinitionForApi {
  return {
    metricName: d.metricName,
    version: d.version,
    definition: d.definition,
    canonicalSource: d.canonicalSource,
    formulaDescription: d.formula.description,
    formulaPseudocode: d.formula.pseudocode,
    uiLabel: d.uiLabel,
    uiTooltip: d.uiTooltip,
    thresholdsNote: d.thresholds.note,
    validRangeDescription: d.validRange.description,
  };
}
