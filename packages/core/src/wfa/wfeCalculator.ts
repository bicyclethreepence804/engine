/**
 * Rank-based WFE and one-sided permutation p-value for public WFA.
 */

import type { WFEResult } from "@kiploks/engine-contracts";
import {
  KiploksValidationError,
  WFE_PERMUTATION_N_DEFAULT,
  WFE_PERMUTATION_N_MAX,
  WFE_PERMUTATION_N_MIN,
} from "@kiploks/engine-contracts";

/** 1-based average ranks (tie-aware), same order as input. */
export function computeAverageRanks(values: number[]): number[] {
  if (values.length === 0) return [];
  for (const v of values) {
    if (!Number.isFinite(v)) {
      throw new KiploksValidationError(
        "INVALID_RETURN_VALUE",
        "WFE rank computation requires finite IS/OOS returns (no NaN or Infinity).",
      );
    }
  }
  const n = values.length;
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => (a.value !== b.value ? a.value - b.value : a.index - b.index));
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && indexed[j + 1]!.value === indexed[i]!.value) j++;
    const startRank = i + 1;
    const endRank = j + 1;
    const avgRank = (startRank + endRank) / 2;
    for (let k = i; k <= j; k++) {
      ranks[indexed[k]!.index] = avgRank;
    }
    i = j + 1;
  }
  return ranks;
}

/**
 * rankWfe = mean(rank_OOS_i / rank_IS_i) with independent ranks on IS and OOS arrays (aligned by window index).
 */
export function computeRankWfe(isReturns: number[], oosReturns: number[]): number {
  if (isReturns.length !== oosReturns.length) {
    throw new KiploksValidationError(
      "INVALID_RETURN_VALUE",
      "IS and OOS return arrays must have the same length for rank WFE.",
    );
  }
  if (isReturns.length < 2) {
    throw new KiploksValidationError("INVALID_RETURN_VALUE", "Rank WFE requires at least 2 windows.");
  }
  const rIs = computeAverageRanks(isReturns);
  const rOos = computeAverageRanks(oosReturns);
  let sum = 0;
  for (let k = 0; k < isReturns.length; k++) {
    sum += rOos[k]! / rIs[k]!;
  }
  return sum / isReturns.length;
}

function mulberry32(initial: number): () => number {
  let state = initial >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t ^ (t >>> 15));
    return (t >>> 0) / 4294967296;
  };
}

function shuffledOosCopy(oos: number[], rng: () => number): number[] {
  const a = [...oos];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}

/**
 * One-sided permutation p-value: fraction of random OOS shuffles with rankWfe >= observed.
 */
export function computePermutationPValue(
  isReturns: number[],
  oosReturns: number[],
  seed: number,
  n: number,
): number {
  const observed = computeRankWfe(isReturns, oosReturns);
  let count = 0;
  for (let iter = 0; iter < n; iter++) {
    const subSeed = Math.imul(iter, 0x9e3779b1) ^ seed;
    const rng = mulberry32(subSeed >>> 0);
    const shuffled = shuffledOosCopy(oosReturns, rng);
    const perm = computeRankWfe(isReturns, shuffled);
    if (perm >= observed) count++;
  }
  return count / n;
}

export function normalizePermutationN(n: number | undefined): number {
  const v = n ?? WFE_PERMUTATION_N_DEFAULT;
  if (!Number.isInteger(v) || v < WFE_PERMUTATION_N_MIN || v > WFE_PERMUTATION_N_MAX) {
    throw new KiploksValidationError(
      "INVALID_RETURN_VALUE",
      `permutationN must be an integer between ${WFE_PERMUTATION_N_MIN} and ${WFE_PERMUTATION_N_MAX} (AnalyzeConfig).`,
    );
  }
  return v;
}

/**
 * Heuristic verdict from rankWfe alone. Typical values sit in [1, ~1.5] for window counts used in practice
 * when ranks are 1-based (perfect rank alignment yields 1.0; stronger OOS-vs-IS rank transfer yields >1).
 */
export function verdictFromRankWfe(rankWfe: number): WFEResult["verdict"] {
  if (rankWfe >= 1.15) return "ROBUST";
  if (rankWfe >= 1.06) return "ACCEPTABLE";
  if (rankWfe >= 1.0) return "WEAK";
  return "FAIL";
}

export function compositeScoreFromRankWfe(rankWfe: number): number {
  const s = 50 + (rankWfe - 1) * 125;
  return Math.round(Math.max(0, Math.min(100, s)) * 10) / 10;
}

export function buildWfeResult(
  isReturns: number[],
  oosReturns: number[],
  seed: number,
  permutationN?: number,
): WFEResult {
  const nPerm = normalizePermutationN(permutationN);
  const rankWfe = computeRankWfe(isReturns, oosReturns);
  const permutationPValue = computePermutationPValue(isReturns, oosReturns, seed, nPerm);
  const meanIs = isReturns.reduce((a, b) => a + b, 0) / isReturns.length;
  const meanOos = oosReturns.reduce((a, b) => a + b, 0) / oosReturns.length;
  let verdict = verdictFromRankWfe(rankWfe);
  let compositeScore = compositeScoreFromRankWfe(rankWfe);
  if (meanIs > 1e-9 && meanOos < -1e-9) {
    verdict = "FAIL";
    compositeScore = Math.min(compositeScore, 35);
  }
  return {
    rankWfe,
    permutationPValue,
    permutationN: nPerm,
    windowCount: isReturns.length,
    seed,
    verdict,
    compositeScore,
  };
}