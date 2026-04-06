/** Defaults and bounds for WFE permutation p-value (AnalyzeConfig + CLI). */

export const WFE_PERMUTATION_N_DEFAULT = 1000;
export const WFE_PERMUTATION_N_MIN = 100;
export const WFE_PERMUTATION_N_MAX = 10_000;

/** One-sided permutation p at or above this is treated as weak statistical significance (warning + grade cap). */
export const WFE_PERMUTATION_P_WEAK_THRESHOLD = 0.1;
