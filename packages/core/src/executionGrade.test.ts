import { describe, expect, it } from "vitest";
import { computeExecutionGrade, computeInstitutionalReadiness } from "./executionGrade";

describe("computeExecutionGrade", () => {
  it("returns simple when execution is estimated", () => {
    expect(computeExecutionGrade(true, false)).toBe("simple");
    expect(computeExecutionGrade(true, true)).toBe("simple");
  });

  it("returns institutional when not estimated and ADV from API", () => {
    expect(computeExecutionGrade(false, true)).toBe("institutional");
  });

  it("returns professional when not estimated and no API ADV", () => {
    expect(computeExecutionGrade(false, false)).toBe("professional");
  });
});

describe("computeInstitutionalReadiness", () => {
  it("blocks non-institutional grades with tailored hints", () => {
    const simple = computeInstitutionalReadiness({ executionGrade: "simple" });
    expect(simple.institutionalReady).toBe(false);
    expect(simple.executionGradeUpgradeHint).toContain("exact exchange fees");

    const pro = computeInstitutionalReadiness({ executionGrade: "professional" });
    expect(pro.institutionalReady).toBe(false);
    expect(pro.executionGradeUpgradeHint).toContain("real ADV");
  });

  it("blocks institutional grade when AAA metrics are insufficient", () => {
    const out = computeInstitutionalReadiness({
      executionGrade: "institutional",
      wfe: 0.5,
      tradesCount: 10,
      oosRetention: 0.1,
    });
    expect(out.institutionalReady).toBe(false);
    expect(out.institutionalBlockReasons.length).toBeGreaterThanOrEqual(3);
    expect(out.executionGradeUpgradeHint).toContain("WFE");
  });

  it("passes when institutional and thresholds are met", () => {
    const out = computeInstitutionalReadiness({
      executionGrade: "institutional",
      wfe: 0.75,
      tradesCount: 150,
      oosRetention: 0.35,
    });
    expect(out.institutionalReady).toBe(true);
    expect(out.institutionalBlockReasons).toHaveLength(0);
    expect(out.executionGradeUpgradeHint).toBeUndefined();
  });
});
