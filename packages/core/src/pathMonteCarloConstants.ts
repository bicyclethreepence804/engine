/** Bumped on algorithm / threshold / breaking shape changes (independent of FORMULA_VERSION). */
export const PATH_MONTE_CARLO_METHOD_VERSION = "1.1.0";

export const DEFAULT_SIMULATIONS = 10_000;
export const MIN_SIMULATIONS = 100;
export const MAX_SIMULATIONS = 50_000;

export const BUDGET_SIMULATIONS: Record<"fast" | "standard" | "thorough", number> = {
  fast: 1_000,
  standard: 10_000,
  thorough: 50_000,
};

export const DEFAULT_MIN_PERIODS = 30;

/** When `seed` omitted, use this for reproducible default runs. */
export const PATH_MONTE_CARLO_DEFAULT_SEED = 0xdecafbad;

export const PATH_STABILITY_HIGH_THRESHOLD = 0.3;
export const PATH_STABILITY_MEDIUM_THRESHOLD = 0.6;

export const TAIL_RISK_LOW_THRESHOLD = 0.1;
export const TAIL_RISK_MEDIUM_THRESHOLD = 0.25;

/** Paths with |maxDD| below this (decimal) count as viable alongside positive CAGR. */
export const VIABLE_MDD_THRESHOLD_DECIMAL = 0.5;

export const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;
export const TRADING_DAYS_PER_YEAR = 252;
