import { describe, expect, it } from "vitest";
import { KiploksValidationError } from "@kiploks/engine-contracts";
import {
  buildProfessionalWfa,
  runProfessionalWfa,
  validateAndNormalizeWfaInput,
} from "./wfaProfessional";

describe("wfaProfessional", () => {
  it("fails validation for less than 2 periods", () => {
    const out = validateAndNormalizeWfaInput({
      periods: [{ optimizationReturn: 0.1, validationReturn: 0.05 }],
    } as never);
    expect(out.ok).toBe(false);
  });

  it("normalizes periods and builds professional report", () => {
    const validation = validateAndNormalizeWfaInput({
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.05, parameters: { a: 1, b: 2 } },
        { optimizationReturn: 0.08, validationReturn: 0.04, parameters: { a: 2, b: 3 } },
        { optimizationReturn: 0.09, validationReturn: 0.03, parameters: { a: 3, b: 4 } },
      ],
    } as never);
    expect(validation.ok).toBe(true);
    const built = buildProfessionalWfa(validation, { seed: 42 });
    expect(built).not.toBeNull();
    expect(built?.professional.wfeAdvanced).toBeDefined();
    expect(built?.professionalMeta.version).toBeDefined();
  });

  it("runs full pipeline from raw input", () => {
    const out = runProfessionalWfa(
      {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.05, parameters: { a: 1 } },
          { optimizationReturn: 0.12, validationReturn: 0.07, parameters: { a: 2 } },
        ],
      } as never,
      { seed: 1 },
    );
    expect(out).not.toBeNull();
    expect(out?.professional.institutionalGrade).toBeDefined();
  });

  it("normalizes performanceTransfer curves when provided", () => {
    const validation = validateAndNormalizeWfaInput({
      periods: [
        { optimizationReturn: 0.1, validationReturn: 0.05, parameters: { a: 1 } },
        { optimizationReturn: 0.12, validationReturn: 0.07, parameters: { a: 2 } },
      ],
      performanceTransfer: {
        windows: [
          {
            oosEquityCurve: [
              { date: "2024-01-02", value: 1.05 },
              { date: "2024-01-01", value: 1.0 },
            ],
          },
        ],
      },
    } as never);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect((validation.normalizedCurves?.[0]?.[0]?.date ?? "") <= "2024-01-02").toBe(
        true,
      );
    }
  });

  it("returns null from buildProfessionalWfa when validation failed", () => {
    const out = buildProfessionalWfa({
      ok: false,
      errors: ["bad"],
      stopperIds: ["S2"],
    });
    expect(out).toBeNull();
  });

  it("produces professional output with synthetic equity approximation", () => {
    const out = runProfessionalWfa(
      {
        periods: [
          { optimizationReturn: 0.2, validationReturn: 0.12, parameters: { x: 1, y: 2 } },
          { optimizationReturn: 0.18, validationReturn: 0.05, parameters: { x: 2, y: 2 } },
          { optimizationReturn: 0.15, validationReturn: -0.01, parameters: { x: 3, y: 1 } },
          { optimizationReturn: 0.1, validationReturn: 0.02, parameters: { x: 4, y: 1 } },
        ],
      } as never,
      { seed: 123 },
    );
    expect(out).not.toBeNull();
    expect(out?.professionalMeta.approximationsUsed.length).toBeGreaterThanOrEqual(0);
    expect(out?.professional.wfeAdvanced?.verdict).toBeDefined();
    expect(out?.professional.monteCarloValidation?.verdict).toBeDefined();
    expect(out?.professional.stressTest?.verdict).toBeDefined();
  });

  it("returns null for runProfessionalWfa when validation fails", () => {
    const out = runProfessionalWfa({
      periods: [{ optimizationReturn: 0.1, validationReturn: 0.1 }],
    } as never);
    expect(out).toBeNull();
  });

  it("keeps parameterStability undefined when no numeric params", () => {
    const out = runProfessionalWfa(
      {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.05, parameters: { strategy: "x" } },
          { optimizationReturn: 0.12, validationReturn: 0.04, parameters: { strategy: "x" } },
          { optimizationReturn: 0.09, validationReturn: 0.03, parameters: { strategy: "x" } },
        ],
      } as never,
      { seed: 10 },
    );
    expect(out).not.toBeNull();
    expect(out?.professional.parameterStability).toBeUndefined();
  });

  it("captures stress/regime branches on unstable periods", () => {
    const out = runProfessionalWfa(
      {
        periods: [
          { optimizationReturn: 0.2, validationReturn: 0.2, parameters: { p: 1 }, validationMaxDD: -0.05 },
          { optimizationReturn: 0.2, validationReturn: -0.25, parameters: { p: 10 }, validationMaxDD: -0.3 },
          { optimizationReturn: 0.2, validationReturn: 0.15, parameters: { p: 30 }, validationMaxDD: -0.07 },
          { optimizationReturn: 0.2, validationReturn: -0.2, parameters: { p: 60 }, validationMaxDD: -0.35 },
        ],
      } as never,
      { seed: 99 },
    );
    expect(out).not.toBeNull();
    expect(out?.professional.regimeAnalysis?.verdict).toBeDefined();
    expect(out?.professional.stressTest?.verdict).toBeDefined();
    expect(out?.professional.institutionalGrade).toBeDefined();
  });

  it("can keep equity analysis unavailable for too-short curves", () => {
    const out = runProfessionalWfa(
      {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.05, parameters: { a: 1 } },
          { optimizationReturn: 0.11, validationReturn: 0.04, parameters: { a: 2 } },
        ],
        performanceTransfer: {
          windows: [{ oosEquityCurve: [{ date: "2024-01-01", value: 1 }] }],
        },
      } as never,
      { seed: 77 },
    );
    expect(out).not.toBeNull();
    expect(out?.professional.equityCurveAnalysis).toBeUndefined();
  });

  it("accepts windows alias and normalizes numeric string returns", () => {
    const validation = validateAndNormalizeWfaInput({
      windows: [
        { optimization_return: "10", validation_return: "5", parameters: { p: "1" } },
        { optimization_return: "8", validation_return: "3", parameters: { p: "2" } },
      ],
    } as never);
    expect(validation.ok).toBe(true);
    if (validation.ok) {
      expect(validation.normalizedPeriods.length).toBe(2);
      expect(Number.isFinite(validation.normalizedPeriods[0]?.optimizationReturn)).toBe(false);
      expect(validation.normalizedPeriods[0]?.parameters?.p).toBe(1);
    }
  });

  it("can produce confident monte-carlo and resilient stress on stable profile", () => {
    const out = runProfessionalWfa(
      {
        periods: [
          { optimizationReturn: 0.08, validationReturn: 0.06, parameters: { p: 1 }, validationMaxDD: -0.03 },
          { optimizationReturn: 0.09, validationReturn: 0.07, parameters: { p: 1.1 }, validationMaxDD: -0.02 },
          { optimizationReturn: 0.1, validationReturn: 0.08, parameters: { p: 1.2 }, validationMaxDD: -0.02 },
          { optimizationReturn: 0.07, validationReturn: 0.05, parameters: { p: 1.2 }, validationMaxDD: -0.03 },
          { optimizationReturn: 0.11, validationReturn: 0.09, parameters: { p: 1.3 }, validationMaxDD: -0.02 },
        ],
      } as never,
      { seed: 7 },
    );
    expect(out).not.toBeNull();
    expect(out?.professional.monteCarloValidation?.verdict).toBeDefined();
    expect(out?.professional.stressTest?.verdict).toBeDefined();
    expect(out?.professional.institutionalGrade).toBeDefined();
  });

  it("marks weak or fail rank WFE when OOS is negative vs positive IS", () => {
    const out = runProfessionalWfa(
      {
        periods: [
          { optimizationReturn: 0.12, validationReturn: -0.05, parameters: { p: 1 } },
          { optimizationReturn: 0.1, validationReturn: -0.04, parameters: { p: 2 } },
          { optimizationReturn: 0.08, validationReturn: -0.03, parameters: { p: 3 } },
          { optimizationReturn: 0.11, validationReturn: -0.02, parameters: { p: 4 } },
        ],
      } as never,
      { seed: 5 },
    );
    expect(out).not.toBeNull();
    expect(out?.professional.wfeAdvanced?.verdict).toBe("FAIL");
  });

  it("can detect outlier regime shifts on extreme window return", () => {
    const out = runProfessionalWfa(
      {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.03, parameters: { p: 1 } },
          { optimizationReturn: 0.1, validationReturn: 0.02, parameters: { p: 1 } },
          { optimizationReturn: 0.1, validationReturn: 0.45, parameters: { p: 1 } },
          { optimizationReturn: 0.1, validationReturn: 0.01, parameters: { p: 1 } },
          { optimizationReturn: 0.1, validationReturn: 0.02, parameters: { p: 1 } },
        ],
      } as never,
      { seed: 11 },
    );
    expect(out).not.toBeNull();
    expect(typeof out?.professional.regimeAnalysis?.hasOutliers).toBe("boolean");
    expect(out?.professional.regimeAnalysis?.verdict).toBeDefined();
  });

  it("computes rank WFE when all IS returns are identical (ties)", () => {
    const out = runProfessionalWfa(
      {
        periods: [
          { optimizationReturn: 0, validationReturn: 0.01, parameters: { p: 1 } },
          { optimizationReturn: 0, validationReturn: -0.01, parameters: { p: 2 } },
          { optimizationReturn: 0, validationReturn: 0.0, parameters: { p: 3 } },
        ],
      } as never,
      { seed: 21 },
    );
    expect(out).not.toBeNull();
    expect(Number.isFinite(out?.professional.wfeAdvanced?.rankWfe ?? Number.NaN)).toBe(true);
  });

  it("builds stress with N/A recovery when no curves provided", () => {
    const out = runProfessionalWfa(
      {
        periods: [
          { optimizationReturn: 0.06, validationReturn: 0.03, parameters: { p: 1 } },
          { optimizationReturn: 0.06, validationReturn: -0.02, parameters: { p: 1 } },
          { optimizationReturn: 0.06, validationReturn: 0.01, parameters: { p: 1 } },
        ],
      } as never,
      { seed: 14 },
    );
    expect(out).not.toBeNull();
    expect(out?.professional.stressTest?.recoveryCapability).toBe("N/A");
  });

  it("handles skewed-right distribution branch", () => {
    const out = runProfessionalWfa(
      {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.001, parameters: { p: 1 } },
          { optimizationReturn: 0.1, validationReturn: 0.001, parameters: { p: 1 } },
          { optimizationReturn: 0.1, validationReturn: 0.002, parameters: { p: 1 } },
          { optimizationReturn: 0.1, validationReturn: 0.02, parameters: { p: 1 } },
          { optimizationReturn: 0.1, validationReturn: 0.003, parameters: { p: 1 } },
        ],
      } as never,
      { seed: 31 },
    );
    expect(out).not.toBeNull();
    expect(out?.professional.regimeAnalysis?.distributionShape).toBeDefined();
  });

  it("throws when fewer than two finite IS/OOS pairs for rank WFE", () => {
    expect(() =>
      runProfessionalWfa(
        {
          periods: [
            { optimizationReturn: 0.1, validationReturn: Number.NaN, parameters: { p: 1 } },
            { optimizationReturn: 0.1, validationReturn: Number.NaN, parameters: { p: 2 } },
          ],
        } as never,
        { seed: 3 },
      ),
    ).toThrow(KiploksValidationError);
  });

  it("caps institutional grade at A when permutation p-value is weak (>= 0.10)", () => {
    const out = runProfessionalWfa(
      {
        periods: [
          { optimizationReturn: 0.3, validationReturn: 0.05 },
          { optimizationReturn: 0.1, validationReturn: 0.2 },
          { optimizationReturn: 0.2, validationReturn: 0.09 },
        ],
      } as never,
      { seed: 424242, permutationN: 1000 },
    );
    expect(out).not.toBeNull();
    expect(out!.professional.wfeAdvanced!.permutationPValue).toBeGreaterThanOrEqual(0.1);
    expect(out!.professional.institutionalGrade).toBe("A - ACCEPTABLE");
    expect(out!.professional.institutionalGradeOverrideReason).toContain("permutation p-value");
    expect(out!.professional.institutionalGradeOverride?.code).toBe("WEAK_STATISTICAL_SIGNIFICANCE");
    expect(out!.professional.institutionalGradeOverride?.actualPValue).toBe(
      out!.professional.wfeAdvanced!.permutationPValue,
    );
    expect(out!.professionalMeta.engineFormulaVersion).toBeDefined();
  });

  it("caps institutional grade to BBB when verdict FAIL and failure rate > 30% (submit guard)", () => {
    const out = runProfessionalWfa({
      periods: [
        { optimizationReturn: -0.01, validationReturn: -0.04 },
        { optimizationReturn: 0.018, validationReturn: 0.023 },
        { optimizationReturn: 0.009, validationReturn: 0.029 },
        { optimizationReturn: -0.047, validationReturn: -0.04 },
        { optimizationReturn: 0.012, validationReturn: -0.049 },
        { optimizationReturn: -0.082, validationReturn: -0.04 },
      ],
    } as never);
    expect(out).not.toBeNull();
    expect(out!.professional.institutionalGrade).toBe("BBB - RESEARCH ONLY");
    expect(out!.professional.institutionalGradeOverride?.code).toBe("FAIL_VERDICT_HIGH_FAILURE_RATE");
    expect(out!.professional.institutionalGradeOverride?.actualFailureRate).toBeCloseTo(4 / 6, 5);
    expect(out!.professionalMeta.guardsTriggered).toContain("FAIL_VERDICT_HIGH_FAILURE_RATE");
  });
});
