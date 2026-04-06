import {
  CONTRACT_VERSION,
  DEFAULT_DECIMALS,
  ENGINE_VERSION,
  FORMULA_VERSION,
  RISK_ANALYSIS_VERSION,
  type AnalyzeConfig,
  type AnalyzeInput,
  type AnalyzeOutput,
} from "@kiploks/engine-contracts";
import { hashCanonical } from "./hash";

function roundWithDecimals(value: number, decimals: number): number {
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

export function analyze(input: AnalyzeInput, config: AnalyzeConfig = {}): AnalyzeOutput {
  const decimals = config.decimals ?? DEFAULT_DECIMALS;
  const seed = config.seed ?? 42;

  const trades = input.trades ?? [];
  const totalTrades = trades.length;
  const netProfit = roundWithDecimals(
    trades.reduce((sum, trade) => sum + trade.profit, 0),
    decimals,
  );
  const avgTradeProfit =
    totalTrades > 0 ? roundWithDecimals(netProfit / totalTrades, decimals) : 0;

  const inputHash = hashCanonical(input, decimals);
  const configHash = hashCanonical({ seed, decimals }, decimals);

  return {
    summary: {
      totalTrades,
      netProfit,
      avgTradeProfit,
    },
    metadata: {
      engineVersion: ENGINE_VERSION,
      formulaVersion: FORMULA_VERSION,
      riskAnalysisVersion: RISK_ANALYSIS_VERSION,
      contractVersion: CONTRACT_VERSION,
      inputHash,
      configHash,
      seed,
      decimals,
    },
  };
}
