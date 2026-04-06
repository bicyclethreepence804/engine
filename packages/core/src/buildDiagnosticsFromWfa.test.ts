import { describe, expect, it } from "vitest";
import {
  buildDiagnosticsFromWfa,
  computeAuditVerdictFromParameters,
} from "./buildDiagnosticsFromWfa";

describe("buildDiagnosticsFromWfa", () => {
  it("returns empty diagnostics for missing WFA", () => {
    const out = buildDiagnosticsFromWfa(null, null);
    expect(out).toEqual({});
  });

  it("builds diagnostics patch from minimal WFA periods", () => {
    const out = buildDiagnosticsFromWfa(
      {
        periods: [
          { optimizationReturn: 0.1, validationReturn: 0.07, parameters: { a: 1, b: 2 } },
          { optimizationReturn: 0.08, validationReturn: 0.05, parameters: { a: 2, b: 3 } },
          { optimizationReturn: 0.09, validationReturn: 0.04, parameters: { a: 3, b: 4 } },
        ],
      },
      { overall: 70 },
    );
    expect(typeof out).toBe("object");
    expect("deploymentStatus" in out).toBe(true);
  });

  it("computes audit verdict from sensitivities", () => {
    const out = computeAuditVerdictFromParameters([
      { sensitivity: 0.2 },
      { sensitivity: 0.5 },
      { sensitivity: 0.7 },
    ]);
    expect(typeof out.aggregateRiskScore).toBe("number");
    expect(out.deploymentStatus).toBeDefined();
  });
});
