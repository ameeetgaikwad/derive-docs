import { NextResponse } from "next/server";

const BINANCE_US_API_BASE_URL = "https://api.binance.us/api/v3";
const PRIMARY_SYMBOL = "BTCUSD";
const FALLBACK_SYMBOL = "BTCUSDT";
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; Hedge-BTC-Price-Fetcher/1.0)",
  Accept: "application/json",
};

export const revalidate = 30;

type BinanceTickerResponse = {
  symbol?: string;
  price?: string | number;
};

type PriceHistoryRow = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

function parseTickerPrice(payload: unknown): number {
  if (!payload || typeof payload !== "object" || !("price" in payload)) {
    throw new Error("Invalid response format from BTC price API");
  }

  const price = Number((payload as BinanceTickerResponse).price);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("Invalid BTC price received from price API");
  }

  return price;
}

function parseTimestamp(at: string): number {
  if (/^\d+$/.test(at)) return Number(at);

  const timestamp = Date.parse(at);
  if (Number.isNaN(timestamp)) {
    throw new Error("Invalid timestamp. Use ISO format or milliseconds.");
  }

  return timestamp;
}

async function fetchHistoricalPrice(symbol: string, timestamp: number) {
  const response = await fetch(
    `${BINANCE_US_API_BASE_URL}/aggTrades?symbol=${symbol}&endTime=${timestamp}&limit=1`,
    {
      headers: HEADERS,
      next: { revalidate },
    },
  );

  if (!response.ok) return null;

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const price = Number((payload[0] as { p?: string | number }).p);
  if (!Number.isFinite(price) || price <= 0) return null;
  const tradeTimestamp = Number((payload[0] as { T?: number }).T);

  return {
    price,
    tradeTime: Number.isFinite(tradeTimestamp)
      ? new Date(tradeTimestamp).toISOString()
      : new Date(timestamp).toISOString(),
  };
}

async function fetchDailyPriceHistory(symbol: string) {
  const response = await fetch(
    `${BINANCE_US_API_BASE_URL}/klines?symbol=${symbol}&interval=1d&limit=30`,
    {
      headers: HEADERS,
      next: { revalidate },
    },
  );

  if (!response.ok) return null;

  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const points = payload.flatMap((row): Array<{ time: number; value: number }> => {
    if (!Array.isArray(row)) return [];

    const [openTime, , , , closePrice] = row as PriceHistoryRow;
    const value = Number(closePrice);
    const time = Number(openTime);

    if (!Number.isFinite(time) || !Number.isFinite(value) || value <= 0) {
      return [];
    }

    return [{ time: Math.floor(time / 1000), value }];
  });

  return points.length > 0 ? points : null;
}

async function fetchTicker(symbol: string) {
  const response = await fetch(
    `${BINANCE_US_API_BASE_URL}/ticker/price?symbol=${symbol}`,
    {
      headers: HEADERS,
      next: { revalidate },
    },
  );

  if (!response.ok) {
    throw new Error(
      `BTC price API failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as unknown;
  return {
    price: parseTickerPrice(payload),
    symbol: "BTC",
  };
}

async function getCurrentPrice() {
  try {
    return await fetchTicker(PRIMARY_SYMBOL);
  } catch {
    return fetchTicker(FALLBACK_SYMBOL);
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const at = url.searchParams.get("at");
    const history = url.searchParams.get("history");

    if (history === "30d") {
      const points =
        (await fetchDailyPriceHistory(PRIMARY_SYMBOL)) ??
        (await fetchDailyPriceHistory(FALLBACK_SYMBOL));

      if (!points) {
        throw new Error("No historical BTC data found");
      }

      return NextResponse.json({
        success: true,
        symbol: "BTC",
        points,
        requestedAt: new Date().toISOString(),
      });
    }

    if (at) {
      const timestamp = parseTimestamp(at);
      const historical =
        (await fetchHistoricalPrice(PRIMARY_SYMBOL, timestamp)) ??
        (await fetchHistoricalPrice(FALLBACK_SYMBOL, timestamp));

      if (!historical) {
        throw new Error("No historical BTC data found");
      }

      return NextResponse.json({
        success: true,
        price: historical.price,
        symbol: "BTC",
        tradeTime: historical.tradeTime,
        requestedAt: new Date(timestamp).toISOString(),
      });
    }

    const current = await getCurrentPrice();

    return NextResponse.json({
      success: true,
      ...current,
      requestedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: "Failed to fetch BTC price",
        details:
          error instanceof Error && error.message === "No historical BTC data found"
            ? error.message
            : "BTC price unavailable",
      },
      { status: 500 },
    );
  }
}
