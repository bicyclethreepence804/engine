import { describe, expect, it } from "vitest";
import {
  OOS_CALMAR_METRIC_DEFINITION,
  OOS_CVAR95_METRIC_DEFINITION,
  OOS_DOMINANCE_RATIO_METRIC_DEFINITION,
  WFA_PASS_PROBABILITY_CRITICAL_LOW_THRESHOLD,
  WFA_PASS_PROBABILITY_METRIC_DEFINITION,
} from "./benchStaticDefinitions";

describe("benchStaticDefinitions", () => {
  it("exposes stable metric names and threshold constant", () => {
    expect(OOS_CALMAR_METRIC_DEFINITION.metricName).toBe("OOS_Calmar");
    expect(OOS_CVAR95_METRIC_DEFINITION.metricName).toBe("OOS_CVaR_95");
    expect(OOS_DOMINANCE_RATIO_METRIC_DEFINITION.metricName).toBe("OOS_Dominance_Ratio");
    expect(WFA_PASS_PROBABILITY_METRIC_DEFINITION.metricName).toBe("WFA_Pass_Probability");
    expect(typeof WFA_PASS_PROBABILITY_CRITICAL_LOW_THRESHOLD).toBe("number");
  });
});
