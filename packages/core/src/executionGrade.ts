export type ExecutionGrade = "simple" | "professional" | "institutional";

export interface InstitutionalReadinessInput {
  executionGrade?: ExecutionGrade | null;
  wfe?: number | null;
  tradesCount?: number | null;
  oosRetention?: number | null;
}

export interface InstitutionalReadinessResult {
  institutionalReady: boolean;
  institutionalBlockReasons: string[];
  executionGradeUpgradeHint?: string;
}

const WFE_THRESHOLD_AAA = 0.7;
const MIN_TRADES_AAA = 100;
const OOS_RETENTION_THRESHOLD_AAA = 0.2;

export function computeExecutionGrade(
  executionIsEstimated: boolean,
  advFromApi: boolean,
): ExecutionGrade {
  if (executionIsEstimated) return "simple";
  return advFromApi ? "institutional" : "professional";
}

export function computeInstitutionalReadiness(
  input: InstitutionalReadinessInput,
): InstitutionalReadinessResult {
  const { executionGrade, wfe, tradesCount, oosRetention } = input;

  const reasons: string[] = [];

  if (executionGrade !== "institutional") {
    reasons.push("Execution parameters incomplete");
    const hint =
      executionGrade === "simple"
        ? "Provide exact exchange fees and slippage; use real ADV for Institutional grade."
        : "Provide real ADV (from API or historical data) for Institutional grade.";
    return {
      institutionalReady: false,
      institutionalBlockReasons: reasons,
      executionGradeUpgradeHint: hint,
    };
  }

  const wfeNum = typeof wfe === "number" && Number.isFinite(wfe) ? wfe : null;
  const tradesNum =
    typeof tradesCount === "number" && Number.isFinite(tradesCount) ? tradesCount : null;
  const retentionNum =
    typeof oosRetention === "number" && Number.isFinite(oosRetention) ? oosRetention : null;

  if (wfeNum == null || wfeNum < WFE_THRESHOLD_AAA) {
    reasons.push(`WFE < ${WFE_THRESHOLD_AAA}`);
  }
  if (tradesNum == null || tradesNum < MIN_TRADES_AAA) {
    reasons.push(`Insufficient trades for AAA (min ${MIN_TRADES_AAA})`);
  }
  if (retentionNum == null || retentionNum < OOS_RETENTION_THRESHOLD_AAA) {
    reasons.push("OOS retention below 0.2");
  }

  return {
    institutionalReady: reasons.length === 0,
    institutionalBlockReasons: reasons,
    ...(reasons.length > 0 && {
      executionGradeUpgradeHint:
        "Meet WFE >= 0.7, trades >= 100, and OOS retention >= 0.2 for AAA execution.",
    }),
  };
}
