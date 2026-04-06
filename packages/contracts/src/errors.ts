/**
 * Public error and warning codes for WFA entrypoints and validation.
 * See docs/KIPLOKS_ENGINE_ROADMAP.md (Decisions locked, Implementation Notes).
 */

/** Thrown when the whole analysis outcome would be meaningless; caller must fix input. */
export type KiploksErrorCode =
  | "INSUFFICIENT_TRADES"
  | "INSUFFICIENT_WINDOWS_FROM_TRADES"
  | "MISSING_TIMESTAMPS"
  | "INVALID_RETURN_VALUE"
  | "SCHEMA_VERSION_MISMATCH";

/** Structural reason a block cannot be computed (no duplicate per block with warnings). */
export type KiploksUnavailableReason =
  | "parameters_not_provided"
  | "equity_curve_not_provided"
  | "insufficient_windows_for_block"
  | "precomputed_mode_only"
  | "narrative_not_in_public_wfa"
  | "dqg_not_in_public_wfa"
  | "kill_switch_verdict_not_in_public_wfa";

/** Behavioral caution: block computed but outcome should not be trusted blindly. */
export type KiploksWarningCode =
  | "LOW_TRADE_COUNT"
  | "LOW_WINDOW_COUNT"
  | "EMPTY_WINDOWS_DETECTED"
  | "HIGH_DEGRADATION"
  | "SINGLE_DIRECTION_ONLY"
  | "SHORT_HISTORY"
  | "PSEUDO_WFA_INTERPRETATION"
  | "ROBUSTNESS_SCORE_USES_IMPUTED_DATA"
  | "WEAK_STATISTICAL_SIGNIFICANCE";

export type BlockResult<T> =
  | { available: true; data: T }
  | { available: false; reason: KiploksUnavailableReason };

export type KiploksWarning = {
  code: KiploksWarningCode;
  /** Logical block name, e.g. "wfe", "parameterStability". */
  block: string;
  message: string;
};

export class KiploksValidationError extends Error {
  readonly code: KiploksErrorCode;

  constructor(code: KiploksErrorCode, message: string) {
    super(message);
    this.name = "KiploksValidationError";
    this.code = code;
  }
}
