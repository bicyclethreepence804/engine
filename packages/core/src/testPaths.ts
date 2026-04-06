import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolves `test-vectors` directory for both layouts:
 * - Open engine repo root: `./packages/test-vectors`
 * - Legacy flat: `./test-vectors`
 * - Legacy monorepo: `./engine/test-vectors` or `./engine/packages/test-vectors`
 * - Umbrella monorepo: `./engine/packages/test-vectors` (engine repo under same cwd)
 * - Sibling `engine` checkout: `../engine/packages/test-vectors` (cwd = parent folder next to `engine`)
 */
export function resolveEngineTestVectorsRoot(): string {
  const cwd = process.cwd();
  const packagesLayout = path.join(cwd, "packages", "test-vectors");
  if (existsSync(packagesLayout)) return packagesLayout;
  const engineUnderCwd = path.join(cwd, "engine", "packages", "test-vectors");
  if (existsSync(engineUnderCwd)) return engineUnderCwd;
  const siblingEnginePackages = path.join(cwd, "..", "engine", "packages", "test-vectors");
  if (existsSync(siblingEnginePackages)) return siblingEnginePackages;
  const flat = path.join(cwd, "test-vectors");
  if (existsSync(flat)) return flat;
  const nestedEngine = path.join(cwd, "packages", "engine", "test-vectors");
  if (existsSync(nestedEngine)) return nestedEngine;
  throw new Error(
    `Cannot resolve test-vectors directory from cwd=${cwd} (expected ./packages/test-vectors, ./engine/packages/test-vectors, ../engine/packages/test-vectors, or ./test-vectors).`,
  );
}
