import { hashCanonical } from "./hash";

/**
 * Removes every `expected` key recursively so only fixture inputs remain.
 * Used for v2 golden JSON fingerprints when canonicalization or fixture shape policy changes.
 */
export function stripExpectedDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripExpectedDeep);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (key === "expected") continue;
      out[key] = stripExpectedDeep(obj[key]);
    }
    return out;
  }
  return value;
}

/** SHA-256 hex of canonical JSON for the fixture payload (no `expected` keys). */
export function fixtureFingerprint(obj: unknown): string {
  return hashCanonical(stripExpectedDeep(obj));
}
