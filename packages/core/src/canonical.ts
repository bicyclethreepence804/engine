import { DEFAULT_DECIMALS, type CanonicalScaledNumber } from "@kiploks/engine-contracts";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNumber(value: number, decimals: number): CanonicalScaledNumber {
  const scale = 10 ** decimals;
  const scaled = Math.round(value * scale);
  return { v: String(scaled), scale: decimals };
}

export function canonicalize(value: unknown, decimals = DEFAULT_DECIMALS): unknown {
  if (typeof value === "number") {
    return normalizeNumber(value, decimals);
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, decimals));
  }

  if (isPlainObject(value)) {
    const sorted = Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(value[key], decimals);
        return acc;
      }, {});
    return sorted;
  }

  return value;
}

export function canonicalStringify(value: unknown, decimals = DEFAULT_DECIMALS): string {
  return JSON.stringify(canonicalize(value, decimals));
}
