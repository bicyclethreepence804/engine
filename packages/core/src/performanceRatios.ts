function mean(arr: number[]): number {
  if (arr.length === 0) return Number.NaN;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

const MEAN_IS_EPSILON = 1e-9;

export function calcRetention(oosReturns: number[], isReturns: number[]): number | null {
  if (oosReturns.length === 0 || isReturns.length === 0) return null;
  const meanIS = mean(isReturns);
  const meanOOS = mean(oosReturns);
  if (!Number.isFinite(meanIS) || !Number.isFinite(meanOOS)) return null;
  if (Math.abs(meanIS) < MEAN_IS_EPSILON) return null;
  return meanOOS / meanIS;
}

export function calcDegradation(oosReturns: number[], isReturns: number[]): number | null {
  if (oosReturns.length === 0 || isReturns.length === 0) return null;
  const meanIS = mean(isReturns);
  const meanOOS = mean(oosReturns);
  if (!Number.isFinite(meanIS) || !Number.isFinite(meanOOS)) return null;
  if (Math.abs(meanIS) < MEAN_IS_EPSILON) return null;
  return (meanOOS - meanIS) / Math.abs(meanIS);
}
