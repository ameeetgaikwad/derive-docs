/**
 * Deribit public market-data client (no auth — public REST v2).
 *
 * Verified against https://docs.deribit.com (fetched 2026-07-01):
 *   GET /api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option
 *       -> array of book summaries; per option: instrument_name, mark_iv,
 *          underlying_price, underlying_index, mid_price, bid_price,
 *          ask_price, mark_price. This one call gives the whole board +
 *          per-expiry underlying (forward) price, so it's our primary fetch.
 *   GET /api/v2/public/get_index_price?index_name=btc_usd -> { index_price }
 *   GET /api/v2/public/ticker?instrument_name=... -> mark_iv/bid_iv/ask_iv,
 *          underlying_price, index_price, greeks (used for single-instrument
 *          cross-checks).
 *   GET /api/v2/public/get_instruments?currency=BTC&kind=option -> instrument
 *          metadata (expiration_timestamp ms, strike, option_type).
 *
 * IMPORTANT unit note: Deribit quotes implied vol in PERCENTAGE POINTS
 * (e.g. mark_iv = 65.0 means 65% -> 0.65 as a fraction). We divide by 100 on
 * ingest so everything downstream is a plain fraction (0.65), matching the
 * protocol's 18dp vol convention after toUnit().
 */

const DEFAULT_BASE_URL = "https://www.deribit.com/api/v2";

export interface DeribitOption {
  /** e.g. "BTC-27JUN25-100000-C" */
  instrumentName: string;
  /** unix seconds */
  expiry: number;
  /** strike in quote units (e.g. 100000) */
  strike: number;
  isCall: boolean;
  /** mark implied vol as a FRACTION (0.65 = 65%), converted from Deribit % */
  markIv: number | null;
  /** forward/underlying price for this option's expiry (quote units) */
  underlyingPrice: number | null;
  /** future name backing the option, or "index_price" */
  underlyingIndex: string | null;
  midPrice: number | null;
  bidPrice: number | null;
  askPrice: number | null;
  markPrice: number | null;
}

/** All options for a single expiry, plus the expiry's forward price. */
export interface DeribitExpirySlice {
  /** unix seconds */
  expiry: number;
  /** representative forward/underlying price for the expiry (quote units) */
  forward: number;
  options: DeribitOption[];
}

/** The full board grouped by expiry, plus the spot index price. */
export interface DeribitBoard {
  /** BTC index (spot proxy), quote units */
  indexPrice: number;
  /** fetch time, unix seconds */
  fetchedAt: number;
  /** sorted ascending by expiry */
  expiries: DeribitExpirySlice[];
}

interface BookSummaryRaw {
  instrument_name: string;
  mark_iv?: number | null;
  underlying_price?: number | null;
  underlying_index?: string | null;
  mid_price?: number | null;
  bid_price?: number | null;
  ask_price?: number | null;
  mark_price?: number | null;
}

interface JsonRpcResult<T> {
  jsonRpc?: string;
  result?: T;
  error?: { code: number; message: string };
}

export interface DeribitClientOptions {
  baseUrl?: string;
  /** Injectable fetch (tests pass a fixture-backed stub). */
  fetchImpl?: typeof fetch;
  /** Per-request timeout ms (default 15s). */
  timeoutMs?: number;
}

/**
 * Parse a Deribit option instrument name, e.g. "BTC-27JUN25-100000-C" or
 * "BTC-27JUN25-100000-P". Deribit dates are DDMMMYY expiring at 08:00 UTC.
 */
export function parseDeribitInstrument(name: string): {
  currency: string;
  expiry: number; // unix seconds (08:00 UTC on the date)
  strike: number;
  isCall: boolean;
} {
  const parts = name.split("-");
  if (parts.length !== 4) throw new Error(`bad Deribit instrument: ${name}`);
  const [currency, dateSeg, strikeSeg, cp] = parts as [string, string, string, string];
  if (cp !== "C" && cp !== "P") throw new Error(`bad option type in: ${name}`);
  return {
    currency,
    expiry: parseDeribitExpiryDate(dateSeg),
    strike: Number(strikeSeg),
    isCall: cp === "C",
  };
}

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

/** "27JUN25" -> unix seconds at 08:00:00 UTC on 2025-06-27 (Deribit expiry). */
export function parseDeribitExpiryDate(seg: string): number {
  const m = /^(\d{1,2})([A-Z]{3})(\d{2})$/.exec(seg);
  if (!m) throw new Error(`bad Deribit expiry date: ${seg}`);
  const day = Number(m[1]);
  const month = MONTHS[m[2]!];
  if (month === undefined) throw new Error(`bad month in Deribit date: ${seg}`);
  const year = 2000 + Number(m[3]);
  return Math.floor(Date.UTC(year, month, day, 8, 0, 0) / 1000);
}

export class DeribitClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: DeribitClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  private async get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url.toString(), { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`Deribit ${path} HTTP ${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as JsonRpcResult<T>;
      if (body.error) {
        throw new Error(`Deribit ${path} error ${body.error.code}: ${body.error.message}`);
      }
      if (body.result === undefined) throw new Error(`Deribit ${path} returned no result`);
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET /public/get_index_price?index_name=btc_usd -> index price (spot proxy). */
  async getIndexPrice(currency = "BTC"): Promise<number> {
    const result = await this.get<{ index_price: number }>("/public/get_index_price", {
      index_name: `${currency.toLowerCase()}_usd`,
    });
    return result.index_price;
  }

  /** Raw book summaries for every option of a currency (one HTTP call). */
  async getOptionBookSummary(currency = "BTC"): Promise<DeribitOption[]> {
    const rows = await this.get<BookSummaryRaw[]>("/public/get_book_summary_by_currency", {
      currency,
      kind: "option",
    });
    return rows.map((r) => {
      const parsed = parseDeribitInstrument(r.instrument_name);
      return {
        instrumentName: r.instrument_name,
        expiry: parsed.expiry,
        strike: parsed.strike,
        isCall: parsed.isCall,
        // Deribit mark_iv is in percentage points -> fraction.
        markIv: r.mark_iv != null ? r.mark_iv / 100 : null,
        underlyingPrice: r.underlying_price ?? null,
        underlyingIndex: r.underlying_index ?? null,
        midPrice: r.mid_price ?? null,
        bidPrice: r.bid_price ?? null,
        askPrice: r.ask_price ?? null,
        markPrice: r.mark_price ?? null,
      };
    });
  }

  /**
   * Single-instrument ticker (used for cross-checking a fitted point against
   * Deribit's own mark_iv). mark_iv/bid_iv/ask_iv returned as FRACTIONS.
   */
  async getTicker(instrumentName: string): Promise<{
    markIv: number | null;
    bidIv: number | null;
    askIv: number | null;
    underlyingPrice: number | null;
    indexPrice: number | null;
    markPrice: number | null;
  }> {
    const r = await this.get<{
      mark_iv?: number | null;
      bid_iv?: number | null;
      ask_iv?: number | null;
      underlying_price?: number | null;
      index_price?: number | null;
      mark_price?: number | null;
    }>("/public/ticker", { instrument_name: instrumentName });
    return {
      markIv: r.mark_iv != null ? r.mark_iv / 100 : null,
      bidIv: r.bid_iv != null ? r.bid_iv / 100 : null,
      askIv: r.ask_iv != null ? r.ask_iv / 100 : null,
      underlyingPrice: r.underlying_price ?? null,
      indexPrice: r.index_price ?? null,
      markPrice: r.mark_price ?? null,
    };
  }

  /**
   * Fetch the whole board and group into per-expiry slices with a forward
   * price. Options with no mark_iv or no underlying_price are dropped (they
   * can't be fit). Expiries in the past (relative to `now`) are dropped.
   */
  async getBoard(currency = "BTC", now = Math.floor(Date.now() / 1000)): Promise<DeribitBoard> {
    const [indexPrice, options] = await Promise.all([
      this.getIndexPrice(currency),
      this.getOptionBookSummary(currency),
    ]);
    return buildBoard(options, indexPrice, now);
  }
}

/** Group raw options into per-expiry slices; pure so tests can drive it. */
export function buildBoard(
  options: DeribitOption[],
  indexPrice: number,
  now = Math.floor(Date.now() / 1000),
): DeribitBoard {
  const byExpiry = new Map<number, DeribitOption[]>();
  for (const o of options) {
    if (o.expiry <= now) continue;
    if (o.markIv == null || !(o.markIv > 0)) continue;
    const list = byExpiry.get(o.expiry) ?? [];
    list.push(o);
    byExpiry.set(o.expiry, list);
  }

  const expiries: DeribitExpirySlice[] = [];
  for (const [expiry, opts] of byExpiry) {
    // Forward: prefer the median underlying_price across the slice (robust to
    // a stray null / outlier), fall back to the index price.
    const fwds = opts
      .map((o) => o.underlyingPrice)
      .filter((v): v is number => v != null && v > 0)
      .sort((a, b) => a - b);
    const forward = fwds.length > 0 ? fwds[Math.floor(fwds.length / 2)]! : indexPrice;
    expiries.push({ expiry, forward, options: opts.sort((a, b) => a.strike - b.strike) });
  }
  expiries.sort((a, b) => a.expiry - b.expiry);
  return { indexPrice, fetchedAt: now, expiries };
}
