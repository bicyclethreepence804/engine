import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { Trade } from "@kiploks/engine-contracts";
import { toFiniteNumber, toTimestampMs } from "./parse";

export type CsvColumnMapping = {
  profit: string;
  openTime?: string;
  closeTime?: string;
  direction?: string;
  symbol?: string;
};

function detectDelimiter(line1: string, line2: string): "," | ";" {
  const c1 = line1.split(",").length - 1;
  const s1 = line1.split(";").length - 1;
  const c2 = line2.split(",").length - 1;
  const s2 = line2.split(";").length - 1;
  const comma = c1 + c2;
  const semi = s1 + s2;
  return semi > comma ? ";" : ",";
}

function splitCsvLine(line: string, delimiter: "," | ";"): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && ch === delimiter) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }

  out.push(cur);
  return out;
}

function parseDirection(cell: string | undefined): "long" | "short" | undefined {
  if (!cell) return undefined;
  const s = cell.trim().toLowerCase();
  if (!s) return undefined;
  if (s.includes("short") || s.includes("sell")) return "short";
  if (s.includes("long") || s.includes("buy")) return "long";
  return undefined;
}

export function csvToTrades(csv: string, mapping: CsvColumnMapping): Trade[] {
  const text = csv
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(lines[0]!, lines[1]!);
  const headerCells = splitCsvLine(lines[0]!, delimiter).map((c) => c.trim());

  const profitIdx = headerCells.indexOf(mapping.profit);
  const openIdx = mapping.openTime ? headerCells.indexOf(mapping.openTime) : -1;
  const closeIdx = mapping.closeTime ? headerCells.indexOf(mapping.closeTime) : -1;
  const dirIdx = mapping.direction ? headerCells.indexOf(mapping.direction) : -1;
  const symIdx = mapping.symbol ? headerCells.indexOf(mapping.symbol) : -1;

  if (profitIdx === -1) {
    throw new Error(`csvToTrades: profit column '${mapping.profit}' not found in header`);
  }

  const out: Trade[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!, delimiter);
    const profitCell = cells[profitIdx] ?? "";
    const profit = toFiniteNumber(profitCell);
    if (profit == null) continue;

    const openTime =
      openIdx >= 0 ? toTimestampMs(cells[openIdx] ?? null) : undefined;
    const closeTime =
      closeIdx >= 0 ? toTimestampMs(cells[closeIdx] ?? null) : undefined;

    const direction =
      dirIdx >= 0 ? parseDirection(cells[dirIdx]) : undefined;
    const symbol = symIdx >= 0 ? (cells[symIdx] ?? undefined) : undefined;

    out.push({
      profit,
      openTime: openTime ?? undefined,
      closeTime: closeTime ?? undefined,
      direction,
      symbol: symbol ? String(symbol) : undefined,
    });
  }

  return out;
}

export async function csvToTradesFromStream(
  readable: Readable,
  mapping: CsvColumnMapping,
  options?: { maxTrades?: number },
): Promise<Trade[]> {
  const maxTrades = options?.maxTrades ?? 500_000;

  const rl = createInterface({ input: readable, crlfDelay: Infinity });

  let nonEmptyLineIndex = -1;
  let headerLine1: string | undefined;
  let headerLine2: string | undefined;
  let delimiter: "," | ";" | undefined;
  let headerCells: string[] | undefined;

  const profitIdx = () => (headerCells ? headerCells.indexOf(mapping.profit) : -1);
  const openIdx = () => (mapping.openTime && headerCells ? headerCells.indexOf(mapping.openTime) : -1);
  const closeIdx = () => (mapping.closeTime && headerCells ? headerCells.indexOf(mapping.closeTime) : -1);
  const dirIdx = () => (mapping.direction && headerCells ? headerCells.indexOf(mapping.direction) : -1);
  const symIdx = () => (mapping.symbol && headerCells ? headerCells.indexOf(mapping.symbol) : -1);

  const out: Trade[] = [];

  try {
    for await (const rawLine of rl) {
      const line = String(rawLine).trim();
      if (!line) continue;

      nonEmptyLineIndex += 1;
      const normalizedLine = nonEmptyLineIndex === 0 ? line.replace(/^\uFEFF/, "") : line;

      if (nonEmptyLineIndex === 0) {
        headerLine1 = normalizedLine;
        continue;
      }

      if (nonEmptyLineIndex === 1) {
        headerLine2 = normalizedLine;
        delimiter = detectDelimiter(headerLine1 ?? "", headerLine2);
        headerCells = splitCsvLine(headerLine1 ?? "", delimiter).map((c) => c.trim());

        if ((profitIdx() ?? -1) === -1) {
          throw new Error(`csvToTradesFromStream: profit column '${mapping.profit}' not found in header`);
        }
      }

      if (!delimiter || !headerCells) {
        // Should not happen because we parse delimiter from first 2 lines.
        throw new Error("csvToTradesFromStream: CSV header parsing failed");
      }

      const rowCells = splitCsvLine(normalizedLine, delimiter);
      const profitCell = rowCells[profitIdx()] ?? "";
      const profit = toFiniteNumber(profitCell);
      if (profit == null) continue;

      const openTime = openIdx() >= 0 ? toTimestampMs(rowCells[openIdx()] ?? null) : undefined;
      const closeTime = closeIdx() >= 0 ? toTimestampMs(rowCells[closeIdx()] ?? null) : undefined;

      if (out.length >= maxTrades) {
        throw new Error(
          `csvToTradesFromStream: maxTrades exceeded (${maxTrades}). Please use JSON inputs (e.g. kiploks analyze-trades --format raw) for large datasets.`,
        );
      }

      const direction = dirIdx() >= 0 ? parseDirection(rowCells[dirIdx()] ) : undefined;
      const symbol = symIdx() >= 0 ? (rowCells[symIdx()] ?? undefined) : undefined;

      out.push({
        profit,
        openTime: openTime ?? undefined,
        closeTime: closeTime ?? undefined,
        direction,
        symbol: symbol ? String(symbol) : undefined,
      });
    }
  } finally {
    rl.close();
  }

  // If we never reached the second header line, do not attempt parsing.
  if (nonEmptyLineIndex < 1) return [];

  return out;
}

