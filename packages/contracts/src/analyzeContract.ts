/**
 * Minimal analyze() input/output contracts.
 */

export type TradeInput = {
  profit: number;
  openTime?: number;
  closeTime?: number;
  direction?: "long" | "short";
  symbol?: string;
};

/** Alias for integrations that speak in terms of trades. */
export type Trade = TradeInput;

export type AnalyzeInput = {
  strategyId?: string;
  trades?: TradeInput[];
  tags?: string[];
};

export type AnalysisSummary = {
  totalTrades: number;
  netProfit: number;
  avgTradeProfit: number;
};

export type ReproducibilityMetadata = {
  engineVersion: string;
  formulaVersion: string;
  riskAnalysisVersion: number;
  contractVersion: string;
  inputHash: string;
  configHash: string;
  seed: number;
  decimals: number;
  wfaSchemaVersion?: string;
  wfaInputMode?: "precomputed" | "tradeSlicedPseudoWfa";
  robustnessScoreImputed?: boolean;
};

export type AnalyzeOutput = {
  summary: AnalysisSummary;
  metadata: ReproducibilityMetadata;
};

export type AnalyzeConfig = {
  seed?: number;
  decimals?: number;
  /**
   * Permutation count for WFE p-value. Default and bounds: `WFE_PERMUTATION_N_*` in `@kiploks/engine-contracts`.
   */
  permutationN?: number;
  /**
   * Bootstrap iterations for professional `monteCarloValidation` (window OOS returns). Default 1000; clamped to [100, 50_000].
   */
  monteCarloBootstrapN?: number;
};
