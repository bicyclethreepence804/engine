import { promises as fs } from "node:fs";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ROOT = path.resolve(__dirname, "..");
const ENGINE_CORE_DIR = path.join(ENGINE_ROOT, "packages", "core", "src");
const ENGINE_ADAPTERS_DIR = path.join(ENGINE_ROOT, "packages", "adapters", "src");

const FORBIDDEN_IMPORT_PATTERNS = [
  /from\s+["']@\/+/,
  /from\s+["'].*src\/app\//,
  /from\s+["'].*backend\//,
  /from\s+["'].*cloud-web\//,
];

const FORBIDDEN_IMPORT_PATTERNS_ADAPTERS = [/from\s+["']@kiploks\/engine-core/];

async function collectTsFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectTsFiles(fullPath);
      if (entry.name.endsWith(".ts")) return [fullPath];
      return [];
    }),
  );
  return files.flat();
}

async function main() {
  if (!existsSync(ENGINE_CORE_DIR)) {
    throw new Error(`Missing ${ENGINE_CORE_DIR}`);
  }
  const files = await collectTsFiles(ENGINE_CORE_DIR);
  const violations = [];

  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    for (const pattern of FORBIDDEN_IMPORT_PATTERNS) {
      if (pattern.test(content)) {
        violations.push(`${file}: forbidden import pattern ${pattern}`);
      }
    }
  }

  try {
    const adapterStats = await fs.stat(ENGINE_ADAPTERS_DIR);
    if (adapterStats.isDirectory()) {
      const adapterFiles = await collectTsFiles(ENGINE_ADAPTERS_DIR);
      for (const file of adapterFiles) {
        const content = await fs.readFile(file, "utf8");
        for (const pattern of FORBIDDEN_IMPORT_PATTERNS_ADAPTERS) {
          if (pattern.test(content)) {
            violations.push(`${file}: forbidden import pattern ${pattern}`);
          }
        }
      }
    }
  } catch {
    // no adapters
  }

  if (violations.length > 0) {
    process.stderr.write(`${violations.join("\n")}\n`);
    process.exit(1);
  }

  process.stdout.write("Engine boundary check passed.\n");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Boundary check failed: ${message}\n`);
  process.exit(1);
});
