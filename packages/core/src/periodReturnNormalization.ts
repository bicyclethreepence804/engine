/**
 * Single source for WFA period return normalization (Open Core).
 * Same fallback order as proBenchmarkMetrics and canonical metrics.
 */

import { toDecimalReturn } from "./normalize";

export function getPeriodReturn(
  p: Record<string, unknown>,
  field: "optimizationReturn" | "validationReturn",
): number {
  const metrics = p.metrics as Record<string, Record<string, unknown>> | undefined;
  const raw =
    field === "optimizationReturn"
      ? p.optimizationReturn ??
        p.optimization_return ??
        metrics?.optimization?.totalReturn ??
        metrics?.optimization?.total ??
        (metrics?.optimization as Record<string, unknown>)?.total_return
      : p.validationReturn ??
        p.validation_return ??
        metrics?.validation?.totalReturn ??
        metrics?.validation?.total ??
        (metrics?.validation as Record<string, unknown>)?.total_return;
  const decimal = toDecimalReturn(raw);
  return typeof decimal === "number" && Number.isFinite(decimal) ? decimal : NaN;
}
