/**
 * Machine-readable institutional grade overrides (Professional WFA, submit-time).
 * `reason` mirrors `institutionalGradeOverrideReason` for humans and logs (same text, structured + string).
 */

export type InstitutionalGradeOverrideCode =
  | "WEAK_STATISTICAL_SIGNIFICANCE"
  | "FAIL_VERDICT_HIGH_FAILURE_RATE";

export type InstitutionalGradeOverride = {
  code: InstitutionalGradeOverrideCode;
  /** Human-readable explanation (English). */
  reason: string;
  /** Interpretation depends on `code`: p-value threshold or max allowed failure rate. */
  threshold: number;
  /** Present when `code === WEAK_STATISTICAL_SIGNIFICANCE`. */
  actualPValue?: number;
  /** Present when `code === FAIL_VERDICT_HIGH_FAILURE_RATE`. */
  actualFailureRate?: number;
};
