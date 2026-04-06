import { describe, expect, it } from "vitest";
import {
  evaluateKillSwitch,
  KILL_SWITCH_TOLERATED_CONSECUTIVE_OOS_DD,
  MAX_KURTOSIS_LIMIT,
  MIN_BAYESIAN_PASS_PROB,
  MIN_NET_EDGE_BPS,
  MIN_REGIME_PASS_COUNT,
  OOS_RETENTION_FLOOR,
} from "./killSwitch";

describe("evaluateKillSwitch", () => {
  it("returns no triggers for strong stats", () => {
    const out = evaluateKillSwitch({
      oosRetention: 0.5,
      netEdgeBps: 20,
      wfaPassProbability: 0.8,
      regimePassCount: 2,
      strategyKurtosis: 4,
      killSwitchMaxOosDrawdownWindows: 0,
    });
    expect(out.isKilled).toBe(false);
    expect(out.triggers).toHaveLength(0);
  });

  it("triggers on low OOS retention", () => {
    const out = evaluateKillSwitch({ oosRetention: OOS_RETENTION_FLOOR - 0.05 });
    expect(out.isKilled).toBe(true);
    expect(out.triggers.some((t) => t.includes("OOS Retention"))).toBe(true);
  });

  it("triggers on low net edge bps", () => {
    const out = evaluateKillSwitch({ netEdgeBps: MIN_NET_EDGE_BPS - 1 });
    expect(out.isKilled).toBe(true);
    expect(out.triggers.some((t) => t.includes("Net Edge"))).toBe(true);
  });

  it("triggers on low Bayesian pass probability", () => {
    const out = evaluateKillSwitch({ wfaPassProbability: MIN_BAYESIAN_PASS_PROB - 0.01 });
    expect(out.isKilled).toBe(true);
    expect(out.triggers.some((t) => t.includes("Bayesian"))).toBe(true);
  });

  it("triggers on low regime pass count", () => {
    const out = evaluateKillSwitch({ regimePassCount: MIN_REGIME_PASS_COUNT - 1 });
    expect(out.isKilled).toBe(true);
    expect(out.triggers.some((t) => t.includes("Regime"))).toBe(true);
  });

  it("triggers on high kurtosis", () => {
    const out = evaluateKillSwitch({ strategyKurtosis: MAX_KURTOSIS_LIMIT + 1 });
    expect(out.isKilled).toBe(true);
    expect(out.triggers.some((t) => t.includes("Kurtosis"))).toBe(true);
  });

  it("triggers on consecutive OOS drawdown windows over limit", () => {
    const out = evaluateKillSwitch({
      killSwitchMaxOosDrawdownWindows: KILL_SWITCH_TOLERATED_CONSECUTIVE_OOS_DD + 1,
    });
    expect(out.isKilled).toBe(true);
    expect(out.triggers.some((t) => t.includes("Consecutive OOS"))).toBe(true);
  });

  it("ignores non-finite stats", () => {
    const out = evaluateKillSwitch({
      oosRetention: Number.NaN,
      netEdgeBps: Number.NaN,
      wfaPassProbability: Number.NaN,
    });
    expect(out.isKilled).toBe(false);
  });
});
