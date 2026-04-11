/**
 * Deterministic PRNG (Mulberry32). Shared by WFA bootstrap, WFE permutation draws, and path Monte Carlo.
 * Sequence matches the legacy implementation that mutated a closed-over seed (see git history).
 */

export function createMulberry32(seed: number): () => number {
  let state = seed;
  return (): number => {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t ^ (t >>> 15));
    return (t >>> 0) / 4294967296;
  };
}
