import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const VITEST_CONFIG_NAMES = ["vitest.engine.config.ts", "vitest.config.ts"];

/**
 * Walks up from `startDir` until a directory with engine Vitest config and
 * `engine:validate` in package.json (engine repo root, or a parent workspace that delegates to it).
 */
export function findEngineMonorepoRoot(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const pkg = path.join(dir, "package.json");
    if (!existsSync(pkg)) {
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
      continue;
    }
    const hasVitest = VITEST_CONFIG_NAMES.some((name) => existsSync(path.join(dir, name)));
    if (hasVitest) {
      const raw = JSON.parse(readFileSync(pkg, "utf8")) as {
        scripts?: Record<string, string>;
      };
      if (raw.scripts?.["engine:validate"]) {
        return dir;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Runs the same checks as `npm run engine:validate` at the monorepo root:
 * Vitest engine suite, boundary check, npm bundle safety check.
 */
export function runTestConformance(options?: { cwd?: string }): void {
  const cwd = options?.cwd ?? process.cwd();
  const root = findEngineMonorepoRoot(cwd);
  if (!root) {
    process.stderr.write(
      [
        "test-conformance: could not find an engine root (expected",
        `one of ${VITEST_CONFIG_NAMES.join(", ")} and package.json with script "engine:validate").`,
        "Run from the engine repository root (or a workspace whose root defines engine:validate), or use:",
        "  npm run engine:validate",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npm, ["run", "engine:validate"], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}
