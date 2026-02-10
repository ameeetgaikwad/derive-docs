import { NextRequest, NextResponse } from "next/server";
import { DERIVE_API_URL } from "@/lib/derive/constants";

/**
 * Derive get_tickers returns abbreviated field names.
 * This route normalizes them to our Ticker interface.
 *
 * Abbreviated fields:
 * B = best_bid_price, b = best_bid_amount
 * A = best_ask_price, a = best_ask_amount
 * M = mark_price, I = index_price
 * f = last_price (fill)
 * stats: c = contract_volume, v = volume, pr = percent_change,
 *        n = num_trades, oi = open_interest, h = high, l = low, p = price_change
 * option_pricing: d = delta, g = gamma, t = theta, v = vega,
 *        i = mark_iv, bi = bid_iv, ai = ask_iv, r = rho, m = mark_price, f = forward
 */
function normalizeTicker(name: string, raw: Record<string, unknown>) {
  const stats = (raw.stats || {}) as Record<string, unknown>;
  const op = (raw.option_pricing || {}) as Record<string, unknown>;

  return {
    instrument_name: name,
    best_bid_price: String(raw.B || "0"),
    best_bid_amount: String(raw.b || "0"),
    best_ask_price: String(raw.A || "0"),
    best_ask_amount: String(raw.a || "0"),
    mark_price: String(raw.M || "0"),
    index_price: String(raw.I || "0"),
    last_price: raw.f != null ? String(raw.f) : undefined,
    option_pricing: op
      ? {
          delta: String(op.d || "0"),
          gamma: String(op.g || "0"),
          theta: String(op.t || "0"),
          vega: String(op.v || "0"),
          mark_iv: String(op.i || "0"),
          bid_iv: String(op.bi || "0"),
          ask_iv: String(op.ai || "0"),
          rho: String(op.r || "0"),
        }
      : undefined,
    stats: {
      high: String(stats.h || "0"),
      low: String(stats.l || "0"),
      contract_volume: String(stats.c || "0"),
      volume: String(stats.v || "0"),
      percent_change: String(stats.pr || "0"),
      price_change: String(stats.p || "0"),
      num_trades: String(stats.n || "0"),
      open_interest: String(stats.oi || "0"),
    },
    timestamp: raw.t ? Number(raw.t) : undefined,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const params: Record<string, unknown> = {
      currency: body.currency || "ETH",
      instrument_type: body.instrument_type || "option",
    };
    if (body.expiry_date) params.expiry_date = body.expiry_date;

    const url = `${DERIVE_API_URL}/public/get_tickers`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });

    const data = await res.json();

    // Check for API-level errors
    if (data.error) {
      const errMsg = typeof data.error === "object"
        ? data.error.message || data.error.data || JSON.stringify(data.error)
        : String(data.error);
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    // Derive wraps in { result: { tickers: { ... } } }
    const rawResult = data.result || data;

    // Check for error nested inside result
    if (rawResult?.error) {
      const errMsg = typeof rawResult.error === "object"
        ? rawResult.error.message || rawResult.error.data || JSON.stringify(rawResult.error)
        : String(rawResult.error);
      return NextResponse.json({ error: errMsg }, { status: 400 });
    }

    const rawTickers = rawResult.tickers || rawResult;

    if (typeof rawTickers === "object" && !Array.isArray(rawTickers)) {
      // Dict format: { "ETH-20260213-1900-P": { B: "24.71", ... } }
      const normalized = Object.entries(rawTickers).map(([name, raw]) =>
        normalizeTicker(name, raw as Record<string, unknown>)
      );
      return NextResponse.json({ result: normalized });
    }

    // Already an array or unexpected format
    return NextResponse.json({ result: rawTickers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Tickers API error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
