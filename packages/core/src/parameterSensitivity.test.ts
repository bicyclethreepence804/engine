import { describe, expect, it } from "vitest";
import {
  buildTrialsFromWfa,
  computeParameterSensitivityFromTrials,
  getParameterDisplayLabelAndTone,
} from "./parameterSensitivity";

describe("parameterSensitivity", () => {
  it("maps sensitivity to expected labels and tones", () => {
    expect(getParameterDisplayLabelAndTone(0.1)).toEqual({
      displayLabel: "Stable",
      tone: "green",
    });
    expect(getParameterDisplayLabelAndTone(0.35)).toEqual({
      displayLabel: "Reliable",
      tone: "green",
    });
    expect(getParameterDisplayLabelAndTone(0.5)).toEqual({
      displayLabel: "Needs Tuning",
      tone: "yellow",
    });
    expect(getParameterDisplayLabelAndTone(0.9)).toEqual({
      displayLabel: "Fragile",
      tone: "red",
    });
  });

  it("builds trials from WFA periods and falls back to first params", () => {
    const out = buildTrialsFromWfa({
      periods: [
        { parameters: { timeWindow: 10, liquidity: "2" }, validationReturn: 0.1 },
        { parameters: {}, validationReturn: 0.05 },
        { parameters: { timeWindow: 12 }, optimizationReturn: 0.08 },
      ],
    });
    expect(out).toHaveLength(3);
    expect(out[1]?.parameters?.timeWindow).toBe(10);
  });

  it("returns null for invalid or too-small trial sets", () => {
    expect(computeParameterSensitivityFromTrials([])).toBeNull();
    expect(
      computeParameterSensitivityFromTrials([{ parameters: { a: 1 }, score: 1 }]),
    ).toBeNull();
  });

  it("computes sensitivities and governance notes from trials", () => {
    const trials = Array.from({ length: 25 }, (_, i) => ({
      parameters: {
        timeWindow: i + 1,
        liquidityLimit: (i % 5) + 1,
      },
      score: (i + 1) * 2 + ((i % 3) - 1),
    }));
    const out = computeParameterSensitivityFromTrials(trials);
    expect(out).not.toBeNull();
    expect((out?.parameters?.length ?? 0) >= 2).toBe(true);
    const timeParam = out?.parameters.find((p) => p.name === "Time Window");
    expect(timeParam).toBeDefined();
    expect(typeof timeParam?.sensitivity).toBe("number");
    expect(timeParam?.governanceNote).toBe("Time-decay enforced");
    expect(timeParam?.displayLabel).toBeDefined();
    expect(timeParam?.tone).toBeDefined();
    expect((timeParam?.curvePoints?.length ?? 0) > 0).toBe(true);
  });
});
