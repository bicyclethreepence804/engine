export function toTimestampMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    // Heuristic: > 1e12 is almost certainly ms, otherwise seconds.
    if (v > 1e12) return Math.trunc(v);
    if (v > 0) return Math.trunc(v * 1000);
    return null;
  }
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return null;
      return n > 1e12 ? Math.trunc(n) : Math.trunc(n * 1000);
    }
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? Math.trunc(t) : null;
  }
  return null;
}

export function toFiniteNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

export function safeLower(v: unknown): string {
  return typeof v === "string" ? v.toLowerCase() : "";
}

