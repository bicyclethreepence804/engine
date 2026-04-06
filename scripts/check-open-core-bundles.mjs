import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, "..");
const PACKAGE_DIRS = ["contracts", "core", "adapters", "cli", "test-vectors"].map((d) =>
  path.join(ENGINE_ROOT, "packages", d),
);

const FORBIDDEN_PATH_SEGMENTS = ["src/app", "backend", "cloud-web", "prisma", ".env"];

function runPackDryRun(packageDir) {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: packageDir,
    encoding: "utf8",
  });

  if (result.status !== 0) {
    throw new Error(`npm pack failed in ${packageDir}: ${result.stderr || result.stdout}`);
  }

  const out = result.stdout.trim();
  const jsonStart = out.indexOf("[");
  if (jsonStart === -1) {
    throw new Error(
      `npm pack --json returned no JSON array in ${packageDir}. stdout:\n${out.slice(0, 500)}`,
    );
  }
  const parsed = JSON.parse(out.slice(jsonStart));
  const files = parsed?.[0]?.files ?? [];
  return files.map((file) => file.path);
}

function checkFiles(packageDir, files) {
  const violations = files.filter((file) =>
    FORBIDDEN_PATH_SEGMENTS.some((segment) => file.includes(segment)),
  );
  const internalViolations =
    path.basename(packageDir) === "core"
      ? files.filter(
          (file) =>
            file === "dist/internal.js" || file === "dist/internal.d.ts" || file === "dist/internal.d.ts.map",
        )
      : [];
  if (violations.length > 0) {
    throw new Error(
      `Forbidden bundle files in ${packageDir}:\n${violations.map((v) => `- ${v}`).join("\n")}`,
    );
  }
  if (internalViolations.length > 0) {
    throw new Error(
      `Forbidden internal artifacts in ${packageDir} tarball:\n${internalViolations.map((v) => `- ${v}`).join("\n")}`,
    );
  }
}

function main() {
  for (const packageDir of PACKAGE_DIRS) {
    if (!existsSync(path.join(packageDir, "package.json"))) continue;
    const files = runPackDryRun(packageDir);
    checkFiles(packageDir, files);
  }
  process.stdout.write("Open Core bundle safety check passed.\n");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
