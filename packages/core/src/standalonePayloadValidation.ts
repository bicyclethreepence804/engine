/**
 * Validation of standalone integration payload before report build.
 * Pure shape/field checks (no I/O).
 */

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function hasSymbol(payload: Record<string, unknown>): boolean {
  const backtest = (payload.backtestResult ?? payload.backtest) as Record<string, unknown> | undefined;
  const config = (backtest?.config as Record<string, unknown>) ?? {};
  const results = (backtest?.results ?? backtest) as Record<string, unknown> | undefined;
  const strategy = (payload.strategy as Record<string, unknown>) ?? {};
  const raw =
    (results?.symbol ?? backtest?.symbol ?? strategy.symbol ?? config?.symbol ?? "") as string;
  if (!raw || typeof raw !== "string") return false;
  const t = raw.trim();
  if (!t) return false;
  const upper = t.toUpperCase();
  if (upper.endsWith("USDT") && upper.length > 4) return true;
  return t.length > 0;
}

function getPeriodReturns(p: Record<string, unknown>): { validationReturn: number | null; optimizationReturn: number | null } {
  const metrics = p.metrics as Record<string, Record<string, unknown>> | undefined;
  const rawVal =
    p.validationReturn ??
    p.validation_return ??
    metrics?.validation?.totalReturn ??
    metrics?.validation?.total ??
    (metrics?.validation as Record<string, unknown>)?.total_return;
  const rawOpt =
    p.optimizationReturn ??
    p.optimization_return ??
    metrics?.optimization?.totalReturn ??
    metrics?.optimization?.total ??
    (metrics?.optimization as Record<string, unknown>)?.total_return;
  return { validationReturn: toNum(rawVal), optimizationReturn: toNum(rawOpt) };
}

export interface StandalonePayloadValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateStandalonePayload(
  payload: unknown
): StandalonePayloadValidationResult {
  const errors: string[] = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { valid: false, errors: ["Payload must be an object"] };
  }
  const p = payload as Record<string, unknown>;

  const backtest = (p.backtestResult ?? p.backtest) as Record<string, unknown> | undefined;
  if (!backtest || typeof backtest !== "object") {
    errors.push("Missing backtestResult or backtest");
  } else {
    const config = backtest.config as Record<string, unknown> | undefined;
    const results = (backtest.results ?? backtest) as Record<string, unknown> | undefined;
    if (!config || typeof config !== "object") {
      errors.push("backtestResult.config is required");
    }
    if (!results || typeof results !== "object") {
      errors.push("backtestResult.results (or backtest) is required");
    }
  }

  if (!hasSymbol(p)) {
    errors.push(
      "Symbol is missing or invalid (set in backtestResult.results.symbol, backtestResult.config.symbol, or strategy.symbol)"
    );
  }

  const wfa = (p.walkForwardAnalysis ?? p.wfaData ?? p.wfaResult) as Record<string, unknown> | undefined;
  if (!wfa || typeof wfa !== "object") {
    errors.push("Missing walkForwardAnalysis (or wfaData / wfaResult)");
  } else {
    const periods = (wfa.periods ?? wfa.windows) as Record<string, unknown>[] | undefined;
    if (!Array.isArray(periods) || periods.length === 0) {
      errors.push("walkForwardAnalysis.periods (or .windows) must be a non-empty array");
    } else {
      for (let i = 0; i < periods.length; i++) {
        const period = periods[i];
        if (!period || typeof period !== "object") {
          errors.push(`walkForwardAnalysis.periods[${i}] must be an object`);
          continue;
        }
        const { validationReturn, optimizationReturn } = getPeriodReturns(period as Record<string, unknown>);
        if (validationReturn === null) {
          errors.push(
            `Period ${i + 1}: validationReturn (or metrics.validation.totalReturn / validation_return) must be a number`
          );
        }
        if (optimizationReturn === null) {
          errors.push(
            `Period ${i + 1}: optimizationReturn (or metrics.optimization.totalReturn / optimization_return) must be a number`
          );
        }
      }
    }
  }

  let hasDateRange = false;
  if (backtest && typeof backtest === "object") {
    const config = backtest.config as Record<string, unknown> | undefined;
    const results = (backtest.results ?? backtest) as Record<string, unknown> | undefined;
    if (config?.startDate && config?.endDate) hasDateRange = true;
    if (results?.backtest_start && results?.backtest_end) hasDateRange = true;
    if (results?.start_date && results?.end_date) hasDateRange = true;
  }
  if (!hasDateRange && wfa && typeof wfa === "object") {
    const periods = (wfa.periods ?? wfa.windows) as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(periods) && periods.length > 0) {
      const first = periods[0];
      const last = periods[periods.length - 1];
      const start =
        first?.validationStartDate ?? first?.startDate ?? first?.start ?? first?.validation_start_date ?? first?.start_date;
      const end =
        last?.validationEndDate ?? last?.endDate ?? last?.end ?? last?.validation_end_date ?? last?.end_date;
      if (start && end) hasDateRange = true;
    }
  }
  if (!hasDateRange) {
    errors.push(
      "Date range is required (backtestResult.config.startDate/endDate, or results.backtest_start/backtest_end, or WFA period start/end dates)"
    );
  }

  const params = p.parameters as Record<string, unknown> | undefined;
  if (params && typeof params === "object" && params.strategy !== undefined && typeof params.strategy !== "string") {
    errors.push("parameters.strategy must be a string (strategy name)");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

