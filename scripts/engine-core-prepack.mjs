/**
 * npm lifecycle for @kiploks/engine-core:
 * - prepack "strip": remove ./internal from exports (and typesVersions.internal) so npm tarballs cannot resolve internal.
 * - postpack "restore": restore package.json from backup.
 *
 * Lives under the engine repo root so a public Open Core checkout is self-contained.
 */
import {
  readFileSync,
  writeFileSync,
  copyFileSync,
  existsSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.resolve(__dirname, "../packages/core");
const PKG_JSON = path.join(PKG_DIR, "package.json");
const BAK = path.join(PKG_DIR, "package.json.engine-core-prepack.bak");
const DIST_INTERNAL_FILES = [
  "dist/internal.js",
  "dist/internal.d.ts",
  "dist/internal.d.ts.map",
];
const DIST_BAK_DIR = path.join(PKG_DIR, ".engine-core-prepack-bak");

function backupAndStripDistInternal() {
  mkdirSync(DIST_BAK_DIR, { recursive: true });
  for (const rel of DIST_INTERNAL_FILES) {
    const src = path.join(PKG_DIR, rel);
    const bak = path.join(DIST_BAK_DIR, rel.replaceAll("/", "__"));
    if (!existsSync(src)) continue;
    copyFileSync(src, bak);
    unlinkSync(src);
  }
}

function restoreDistInternal() {
  for (const rel of DIST_INTERNAL_FILES) {
    const dst = path.join(PKG_DIR, rel);
    const bak = path.join(DIST_BAK_DIR, rel.replaceAll("/", "__"));
    if (!existsSync(bak)) continue;
    copyFileSync(bak, dst);
    unlinkSync(bak);
  }
}

function strip() {
  if (!existsSync(PKG_JSON)) {
    process.stderr.write(`engine-core-prepack: missing ${PKG_JSON}\n`);
    process.exit(1);
  }
  if (!existsSync(BAK)) {
    copyFileSync(PKG_JSON, BAK);
  }
  const raw = readFileSync(PKG_JSON, "utf8");
  const pkg = JSON.parse(raw);
  if (pkg.exports && typeof pkg.exports === "object" && "./internal" in pkg.exports) {
    const rest = { ...pkg.exports };
    delete rest["./internal"];
    pkg.exports = rest;
  }
  if (pkg.typesVersions && typeof pkg.typesVersions === "object") {
    const star = pkg.typesVersions["*"];
    if (star && typeof star === "object" && "internal" in star) {
      const restStar = { ...star };
      delete restStar.internal;
      if (Object.keys(restStar).length > 0) {
        pkg.typesVersions["*"] = restStar;
      } else {
        delete pkg.typesVersions["*"];
      }
    }
    if (Object.keys(pkg.typesVersions).length === 0) {
      delete pkg.typesVersions;
    }
  }
  writeFileSync(PKG_JSON, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  backupAndStripDistInternal();
  process.stdout.write("engine-core-prepack: stripped ./internal from package.json for pack.\n");
}

function restore() {
  if (!existsSync(BAK)) {
    process.stdout.write("engine-core-prepack: no backup to restore.\n");
    return;
  }
  copyFileSync(BAK, PKG_JSON);
  unlinkSync(BAK);
  restoreDistInternal();
  process.stdout.write("engine-core-prepack: restored package.json after pack.\n");
}

const cmd = process.argv[2];
if (cmd === "strip") strip();
else if (cmd === "restore") restore();
else {
  process.stderr.write("Usage: node scripts/engine-core-prepack.mjs strip|restore (from engine repo root)\n");
  process.exit(1);
}
