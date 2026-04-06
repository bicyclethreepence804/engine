function isEngineDebugEnabled(): boolean {
  return (
    typeof process !== "undefined" &&
    process?.env?.KIPLOKS_ENGINE_DEBUG === "true"
  );
}

export function engineWarn(...args: unknown[]): void {
  if (!isEngineDebugEnabled()) return;
  console.warn(...args);
}

export function engineInfo(...args: unknown[]): void {
  if (!isEngineDebugEnabled()) return;
  console.info(...args);
}
