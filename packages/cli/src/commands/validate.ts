import { readFile } from "node:fs/promises";
import path from "node:path";

import type { AnalyzeConfig, TradeBasedWFAInput, TradeBasedWFAInput as TradeBasedWFAInputContract } from "@kiploks/engine-contracts";
import type { KiploksErrorCode } from "@kiploks/engine-contracts";

export type ValidateSchema =
  | "trade-based-wfa";

export type ValidateIssue = {
  path: string;
  code: KiploksErrorCode | string;
  message: string;
  expected?: string;
};

export type ValidateResult = {
  ok: boolean;
  schema: ValidateSchema;
  errors: ValidateIssue[];
  warnings: ValidateIssue[];
};

type UnknownJson = unknown;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v != null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function issue(pathStr: string, code: KiploksErrorCode | string, message: string, expected?: string): ValidateIssue {
  return { path: pathStr, code, message, expected };
}

function validateTrade(trade: unknown, index: number, explain: boolean, out: ValidateIssue[]) {
  if (!isRecord(trade)) {
    out.push(issue(`trades[${index}]`, "INVALID_RETURN_VALUE", "Trade item must be an object", "object"));
    return;
  }
  const profit = (trade as any).profit;
  if (!isFiniteNumber(profit)) {
    out.push(
      issue(
        `trades[${index}].profit`,
        "INVALID_RETURN_VALUE",
        "Trade.profit must be a finite number (decimal fraction).",
        explain ? "number (finite)" : undefined,
      ),
    );
  }

  const openTime = (trade as any).openTime;
  const closeTime = (trade as any).closeTime;
  if (!isFiniteNumber(openTime)) {
    out.push(
      issue(
        `trades[${index}].openTime`,
        "MISSING_TIMESTAMPS",
        "TradeBasedWFAInput requires trades[].openTime as unix ms.",
        explain ? "number (unix ms)" : undefined,
      ),
    );
  }
  if (!isFiniteNumber(closeTime)) {
    out.push(
      issue(
        `trades[${index}].closeTime`,
        "MISSING_TIMESTAMPS",
        "TradeBasedWFAInput requires trades[].closeTime as unix ms.",
        explain ? "number (unix ms)" : undefined,
      ),
    );
  }
}

function validateTradeBasedWfaInput(payload: UnknownJson, explain: boolean): ValidateResult {
  const errors: ValidateIssue[] = [];
  const warnings: ValidateIssue[] = [];

  if (!isRecord(payload)) {
    errors.push(issue("root", "INVALID_RETURN_VALUE", "trade-based-wfa expects a JSON object at root", "object"));
    return { ok: false, schema: "trade-based-wfa", errors, warnings };
  }

  const wfaInputMode = (payload as any).wfaInputMode;
  if (wfaInputMode !== "tradeSlicedPseudoWfa") {
    errors.push(
      issue(
        "wfaInputMode",
        "SCHEMA_VERSION_MISMATCH",
        "Invalid wfaInputMode for trade-based-wfa.",
        explain ? `"tradeSlicedPseudoWfa"` : undefined,
      ),
    );
  }

  const windowConfig = (payload as any).windowConfig;
  if (!isRecord(windowConfig)) {
    errors.push(issue("windowConfig", "INVALID_RETURN_VALUE", "windowConfig must be an object", "object"));
  } else {
    const inSampleMonths = (windowConfig as any).inSampleMonths;
    const outOfSampleMonths = (windowConfig as any).outOfSampleMonths;
    const stepMode = (windowConfig as any).stepMode;

    if (!isFiniteNumber(inSampleMonths) || inSampleMonths <= 0) {
      errors.push(
        issue(
          "windowConfig.inSampleMonths",
          "INVALID_RETURN_VALUE",
          "inSampleMonths must be a finite number > 0.",
          explain ? "number > 0" : undefined,
        ),
      );
    }
    if (!isFiniteNumber(outOfSampleMonths) || outOfSampleMonths <= 0) {
      errors.push(
        issue(
          "windowConfig.outOfSampleMonths",
          "INVALID_RETURN_VALUE",
          "outOfSampleMonths must be a finite number > 0.",
          explain ? "number > 0" : undefined,
        ),
      );
    }
    if (stepMode !== "anchored" && stepMode !== "rolling") {
      errors.push(
        issue(
          "windowConfig.stepMode",
          "INVALID_RETURN_VALUE",
          "stepMode must be 'anchored' or 'rolling'.",
          explain ? "'anchored' | 'rolling'" : undefined,
        ),
      );
    }
  }

  const trades = (payload as any).trades;
  if (!Array.isArray(trades)) {
    errors.push(issue("trades", "INVALID_RETURN_VALUE", "trades must be an array", "array"));
    return { ok: false, schema: "trade-based-wfa", errors, warnings };
  }

  if (trades.length < 3) {
    errors.push(
      issue(
        "trades",
        "INSUFFICIENT_TRADES",
        `TradeBasedWFAInput requires at least 3 trades. Got ${trades.length}.`,
        explain ? ">= 3" : undefined,
      ),
    );
  }

  for (let i = 0; i < trades.length; i++) {
    validateTrade(trades[i], i, explain, errors);
  }

  return { ok: errors.length === 0, schema: "trade-based-wfa", errors, warnings };
}

export type ValidateCliArgs = {
  inputPath: string;
  schema: ValidateSchema;
  explain: boolean;
  json: boolean;
};

export function validate(payload: UnknownJson, schema: ValidateSchema, explain: boolean): ValidateResult {
  if (schema === "trade-based-wfa") return validateTradeBasedWfaInput(payload, explain);
  // Future schemas:
  return { ok: false, schema, errors: [issue("schema", "INVALID_RETURN_VALUE", `Unsupported schema: ${schema}`)], warnings: [] };
}

export async function readInputJson(inputPath: string): Promise<UnknownJson> {
  const abs = path.resolve(process.cwd(), inputPath);
  const fileContent = await readFile(abs, "utf8");
  return JSON.parse(fileContent) as UnknownJson;
}

function formatHuman(result: ValidateResult): string {
  const lines: string[] = [];
  lines.push(result.ok ? "OK" : "Validation failed");
  lines.push(`schema: ${result.schema}`);
  for (const e of result.errors) {
    lines.push(`✗ ${e.path}: ${e.message}${e.expected ? ` (expected: ${e.expected})` : ""}`);
  }
  for (const w of result.warnings) {
    lines.push(`! ${w.path}: ${w.message}${w.expected ? ` (expected: ${w.expected})` : ""}`);
  }
  lines.push(`${result.errors.length} errors, ${result.warnings.length} warnings`);
  return lines.join("\n");
}

export async function runValidate(args: ValidateCliArgs): Promise<void> {
  const payload = await readInputJson(args.inputPath);
  const result = validate(payload, args.schema, args.explain);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } else {
    process.stdout.write(`${formatHuman(result)}\n`);
  }
  if (!result.ok) {
    process.exitCode = 1;
  }
}

