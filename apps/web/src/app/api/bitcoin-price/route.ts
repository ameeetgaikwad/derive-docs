import { NextResponse } from "next/server";
import {
  parseBinanceKlines,
  parseCoinbaseCandles,
  type BitcoinPriceHistoryPoint,
} from "@/lib/market/bitcoin-history";

const BINANCE_US_API_BASE_URL = "https://api.binance.us/api/v3";
const COINBASE_API_BASE_URL = "https://api.exchange.coinbase.com";
const CACHE_SECONDS = 300;
const REQUEST_TIMEOUT_MS = 8_000;
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "Hedge-BTC-History/1.0",
};

export const revalidate = 300;

type HistoryProvider = {
  name: "binance.us" | "coinbase";
  load: (signal: AbortSignal) => Promise<BitcoinPriceHistoryPoint[]>;
};

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: HEADERS,
    next: { revalidate: CACHE_SECONDS },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Price history provider returned ${response.status}`);
  }

  return response.json();
}

async function fetchBinanceHistory(
  symbol: "BTCUSD" | "BTCUSDT",
  signal: AbortSignal,
): Promise<BitcoinPriceHistoryPoint[]> {
  const payload = await fetchJson(
    `${BINANCE_US_API_BASE_URL}/klines?symbol=${symbol}&interval=1d&limit=30`,
    signal,
  );
  return parseBinanceKlines(payload);
}

async function fetchCoinbaseHistory(
  signal: AbortSignal,
): Promise<BitcoinPriceHistoryPoint[]> {
  const payload = await fetchJson(
    `${COINBASE_API_BASE_URL}/products/BTC-USD/candles?granularity=86400`,
    signal,
  );
  return parseCoinbaseCandles(payload);
}

async function loadHistory(): Promise<{
  points: BitcoinPriceHistoryPoint[];
  provider: HistoryProvider["name"];
}> {
  const providers: HistoryProvider[] = [
    {
      name: "binance.us",
      load: (signal) => fetchBinanceHistory("BTCUSD", signal),
    },
    {
      name: "binance.us",
      load: (signal) => fetchBinanceHistory("BTCUSDT", signal),
    },
    { name: "coinbase", load: fetchCoinbaseHistory },
  ];
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  for (const provider of providers) {
    try {
      const points = await provider.load(signal);
      if (points.length >= 2) return { points, provider: provider.name };
    } catch {
      // Continue to the next public market-data source.
    }
  }

  throw new Error("No BTC history provider returned usable data");
}

export async function GET(request: Request) {
  const history = new URL(request.url).searchParams.get("history");
  if (history !== "30d") {
    return NextResponse.json(
      { success: false, error: "Only 30-day BTC history is supported" },
      { status: 400 },
    );
  }

  try {
    const { points, provider } = await loadHistory();

    return NextResponse.json(
      {
        success: true,
        symbol: "BTC",
        points,
        provider,
        requestedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 2}`,
        },
      },
    );
  } catch {
    return NextResponse.json(
      { success: false, error: "BTC price history is temporarily unavailable" },
      { status: 503 },
    );
  }
}
