export interface NormalizedTrade {
  price: number;
  quantity: number;
  pnl: number;
  timestamp: number;
  side: "BUY" | "SELL";
  symbol?: string;
}

function tradeKey(t: NormalizedTrade): string {
  return [
    t.price,
    t.quantity,
    t.pnl,
    t.timestamp,
    t.side,
    t.symbol ?? "",
  ].join("|");
}

/**
 * Keep exact first-occurrence legs only.
 * This is intentionally strict (full-field identity), so we do not collapse
 * legitimate independent trades that only share timestamp or symbol.
 */
export function deduplicateNormalizedTrades(trades: NormalizedTrade[]): NormalizedTrade[] {
  if (trades.length < 2) return trades;
  const seen = new Set<string>();
  const out: NormalizedTrade[] = [];
  for (const t of trades) {
    const key = tradeKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function parseTimestamp(v: unknown): number {
  if (v == null) return Number.NaN;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const d = new Date(String(v));
  const t = d.getTime();
  return Number.isFinite(t) ? t : Number.NaN;
}

function toSymbol(pair: unknown): string {
  if (pair == null || typeof pair !== "string") return "default";
  const s = String(pair).trim();
  if (!s) return "default";
  if (s.includes("/")) return s;
  const upper = s.toUpperCase();
  if (upper.endsWith("USDT") && upper.length > 4) return `${upper.slice(0, -4)}/USDT`;
  return s;
}

function isFreqtradeShape(t: Record<string, unknown>): boolean {
  return (
    (t.profit_abs !== undefined || t.open_date !== undefined || t.close_date !== undefined) &&
    (t.pair !== undefined || t.open_rate !== undefined)
  );
}

function freqtradeToLegs(t: Record<string, unknown>): NormalizedTrade[] {
  const openTs = parseTimestamp(t.open_date);
  const closeTs = parseTimestamp(t.close_date);
  const openRate = Number(t.open_rate) || 0;
  const closeRate = Number(t.close_rate) || 0;
  const profitAbs = Number(t.profit_abs) || 0;
  const stakeAmount = Number(t.stake_amount);
  const amount = Number(t.amount);
  const isShort = Boolean(t.is_short);
  const pair = toSymbol(t.pair);

  const quantity =
    Number.isFinite(stakeAmount) && stakeAmount > 0 && (openRate > 0 || closeRate > 0)
      ? stakeAmount / (openRate || closeRate || 1)
      : Number.isFinite(amount) && amount > 0
        ? amount
        : 1;
  const priceOpen = openRate || closeRate || 1;
  const priceClose = closeRate || openRate || 1;
  const openSide: "BUY" | "SELL" = isShort ? "SELL" : "BUY";
  const closeSide: "BUY" | "SELL" = isShort ? "BUY" : "SELL";

  const legs: NormalizedTrade[] = [];
  if (Number.isFinite(openTs)) {
    legs.push({
      price: priceOpen,
      quantity,
      pnl: 0,
      timestamp: openTs,
      side: openSide,
      symbol: pair,
    });
  }
  if (Number.isFinite(closeTs)) {
    legs.push({
      price: priceClose,
      quantity,
      pnl: profitAbs,
      timestamp: closeTs,
      side: closeSide,
      symbol: pair,
    });
  }
  return legs;
}

function kiploksTrade(t: Record<string, unknown>): NormalizedTrade | null {
  const price = Number(t.price);
  const quantity = Number(t.quantity);
  const pnl = Number(t.pnl);
  const timestamp = parseTimestamp(t.timestamp);
  const side = t.side === "BUY" || t.side === "SELL" ? t.side : null;
  if (!Number.isFinite(price) || !Number.isFinite(quantity) || side === null) return null;
  return {
    price,
    quantity,
    pnl: Number.isFinite(pnl) ? pnl : 0,
    timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    side,
    symbol: toSymbol(t.symbol ?? t.pair),
  };
}

export function normalizeTradesForTurnover(
  rawTrades: unknown[] | undefined,
  defaultSymbol: string,
): NormalizedTrade[] {
  if (!Array.isArray(rawTrades) || rawTrades.length === 0) return [];

  const out: NormalizedTrade[] = [];
  for (const row of rawTrades) {
    if (row == null || typeof row !== "object") continue;
    const t = row as Record<string, unknown>;
    if (isFreqtradeShape(t)) {
      out.push(...freqtradeToLegs(t));
    } else {
      const leg = kiploksTrade(t);
      if (leg) {
        if (!leg.symbol || leg.symbol === "default") leg.symbol = defaultSymbol;
        out.push(leg);
      }
    }
  }
  return deduplicateNormalizedTrades(out);
}
