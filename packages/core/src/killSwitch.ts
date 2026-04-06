/**
 * Capital Kill Switch: unified checklist to trigger "NOT production-ready".
 * Thresholds from audit: OOS Retention, Net Edge, Regime, Bayesian.
 */

/** OOS Retention below this = FAIL (critical overfitting). */
export const OOS_RETENTION_FLOOR = 0.2;

/** Net Edge below this (bps) = FAIL when finite; n/a is not FAIL. */
export const MIN_NET_EDGE_BPS = 10;

/** Bayesian pass probability below this = FAIL. */
export const MIN_BAYESIAN_PASS_PROB = 0.65;

/** At least this many regimes must pass (out of 3: Trend, Range, HighVol). */
export const MIN_REGIME_PASS_COUNT = 1;

/** Kurtosis above this = optional FAIL (tail risk). */
export const MAX_KURTOSIS_LIMIT = 25;

/** Max consecutive OOS drawdown windows above this = FAIL (matches frontend "limit: 1"). */
export const KILL_SWITCH_TOLERATED_CONSECUTIVE_OOS_DD = 1;

export interface KillSwitchStats {
  oosRetention?: number;
  netEdgeBps?: number;
  wfaPassProbability?: number;
  regimePassCount?: number;
  strategyKurtosis?: number;
  /**
   * Max consecutive WFA windows with OOS drawdown (validationReturn < 0).
   * Counted over all windows in order (not only IS>0). E.g. [PASS,PASS,FAIL,FAIL,FAIL] → 3; [FAIL,PASS,FAIL,FAIL] → 2.
   * Trigger when > KILL_SWITCH_TOLERATED_CONSECUTIVE_OOS_DD (1).
   */
  killSwitchMaxOosDrawdownWindows?: number;
}

export interface KillSwitchResult {
  triggers: string[];
  isKilled: boolean;
}

/**
 * Evaluate all Kill Switch rules. Returns triggers (human-readable reasons) and isKilled.
 * Net Edge: only FAIL when finite and < MIN_NET_EDGE_BPS; n/a is not a trigger.
 */
export function evaluateKillSwitch(stats: KillSwitchStats): KillSwitchResult {
  const triggers: string[] = [];

  const retention = stats.oosRetention;
  if (typeof retention === "number" && Number.isFinite(retention) && retention < OOS_RETENTION_FLOOR) {
    triggers.push(`OOS Retention < ${OOS_RETENTION_FLOOR * 100}% (current: ${(retention * 100).toFixed(1)}%)`);
  }

  const netEdge = stats.netEdgeBps;
  if (typeof netEdge === "number" && Number.isFinite(netEdge) && netEdge < MIN_NET_EDGE_BPS) {
    triggers.push(`Net Edge < ${MIN_NET_EDGE_BPS} bps (current: ${netEdge.toFixed(2)} bps)`);
  }

  const passProb = stats.wfaPassProbability;
  if (typeof passProb === "number" && Number.isFinite(passProb) && passProb < MIN_BAYESIAN_PASS_PROB) {
    triggers.push(`Bayesian pass probability < ${MIN_BAYESIAN_PASS_PROB * 100}% (current: ${(passProb * 100).toFixed(0)}%)`);
  }

  const regimePass = stats.regimePassCount;
  if (typeof regimePass === "number" && Number.isFinite(regimePass) && regimePass < MIN_REGIME_PASS_COUNT) {
    triggers.push(`Regime adaptability: ${regimePass}/3 pass (min ${MIN_REGIME_PASS_COUNT})`);
  }

  const kurtosis = stats.strategyKurtosis;
  if (typeof kurtosis === "number" && Number.isFinite(kurtosis) && kurtosis > MAX_KURTOSIS_LIMIT) {
    triggers.push(`High tail risk: Kurtosis > ${MAX_KURTOSIS_LIMIT} (current: ${kurtosis.toFixed(1)})`);
  }

  const maxOosDdWindows = stats.killSwitchMaxOosDrawdownWindows;
  if (
    typeof maxOosDdWindows === "number" &&
    Number.isFinite(maxOosDdWindows) &&
    maxOosDdWindows > KILL_SWITCH_TOLERATED_CONSECUTIVE_OOS_DD
  ) {
    triggers.push(
      `Consecutive OOS drawdown windows: ${maxOosDdWindows} (limit: ${KILL_SWITCH_TOLERATED_CONSECUTIVE_OOS_DD})`
    );
  }

  return {
    triggers,
    isKilled: triggers.length > 0,
  };
}
