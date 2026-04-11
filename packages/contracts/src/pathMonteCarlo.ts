/**
 * Path-based Monte Carlo simulation over equity period returns (Open Core).
 * Distinct from WFA window-level `monteCarloValidation` (see WFA_PROFESSIONAL.md §5).
 */

export interface PathMonteCarloEquityPoint {
  /** Unix ms. Optional; used for CAGR horizon when all points have it. */
  timestamp?: number;
  /** Absolute equity; must be > 0. */
  value: number;
}

export interface PathMonteCarloOptions {
  simulations?: number;
  seed?: number;
  minPeriods?: number;
  horizonYears?: number;
  initialBalance?: number;
  budget?: "fast" | "standard" | "thorough";
}

export type PathStability = "HIGH" | "MEDIUM" | "LOW";
export type TailRisk = "HIGH" | "MEDIUM" | "LOW";

export interface MonteCarloPercentileSet {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
}

export interface DistributionStats {
  mean: number;
  std: number;
  /**
   * Sample skewness (adjusted Fisher–Pearson G1), **without** the outlier guard used in
   * `financialMath.calculateSkewness`. Suitable for large MC sample arrays; for small n prefer documenting the difference.
   */
  skewness: number;
  /**
   * Excess kurtosis (sample), same “no outlier guard” note as `skewness`.
   */
  kurtosis: number;
  /** Historical 95% VaR as positive loss magnitude (left tail of the sample). Uses `percentileType7` at p=0.05. */
  var95: number;
  /**
   * Expected shortfall at 95%: mean of all sample values **≤** the Type-7 5th percentile (consistent with `var95`).
   */
  cvar95: number;
  /** Optional Cornish–Fisher 95% VaR (positive loss magnitude) when inputs are finite. */
  varCornishFisher95?: number;
}

export interface PathMonteCarloMeta {
  methodVersion: string;
  simulationsRun: number;
  periodsUsed: number;
  seedUsed: number;
  horizonYears: number;
  horizonFromTimestamps: boolean;
  bootstrapMethod: "iid";
  budgetCapped: boolean;
  percentileMethod: "type7";
  ruinousPathCount: number;
  approximationsUsed?: string[];
  /** Lag-1 autocorrelation of observed period returns (finite sample). */
  periodReturnsAutocorrelationLag1?: number;
  /** Newey–West HAC t-statistic for mean period return (same series as bootstrap). */
  periodReturnsNeweyWestTStat?: number;
}

export interface PathMonteCarloResult {
  cagrDistribution: MonteCarloPercentileSet;
  maxDrawdownDistribution: MonteCarloPercentileSet;
  probabilityPositive: number;
  probabilityViable: number;
  pathStability: PathStability;
  tailRisk: TailRisk;
  interpretation: string[];
  cagrStats: DistributionStats;
  maxDrawdownStats: DistributionStats;
  meta: PathMonteCarloMeta;
}

export type PathMonteCarloBlock = PathMonteCarloResult | null;
