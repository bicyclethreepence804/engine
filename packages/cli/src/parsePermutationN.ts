/**
 * CLI validation for AnalyzeConfig.permutationN (same bounds as engine will enforce).
 */

import { WFE_PERMUTATION_N_MAX, WFE_PERMUTATION_N_MIN } from "@kiploks/engine-contracts";

export const PERMUTATION_N_MIN = WFE_PERMUTATION_N_MIN;
export const PERMUTATION_N_MAX = WFE_PERMUTATION_N_MAX;

/**
 * @param value - raw argv value after `--permutation-n`
 * @throws Error with hint when missing, non-integer, or out of range
 */
export function parsePermutationNCli(value: string | undefined, flagName = "--permutation-n"): number {
  if (value === undefined || value === "") {
    throw new Error(
      `${flagName} requires an integer between ${PERMUTATION_N_MIN} and ${PERMUTATION_N_MAX} (AnalyzeConfig). Example: kiploks analyze-trades trades.json --permutation-n 1000`,
    );
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new Error(
      `${flagName} must be an integer between ${PERMUTATION_N_MIN} and ${PERMUTATION_N_MAX} (AnalyzeConfig). Example: kiploks analyze-trades trades.json --permutation-n 5000`,
    );
  }
  if (n < PERMUTATION_N_MIN || n > PERMUTATION_N_MAX) {
    throw new Error(
      `${flagName} must be between ${PERMUTATION_N_MIN} and ${PERMUTATION_N_MAX} (AnalyzeConfig). Got ${n}. Example: kiploks analyze-windows windows.json --permutation-n 500`,
    );
  }
  return n;
}
