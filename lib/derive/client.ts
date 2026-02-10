import { DERIVE_API_URL } from "./constants";
import type {
  Ticker,
  Instrument,
  OrderParams,
  Order,
  Position,
  Account,
  TradeHistoryItem,
} from "./types";

export interface DeriveAuth {
  wallet: string;
  timestamp: string;
  signature: string;
}

async function post<T>(
  path: string,
  params: Record<string, unknown>,
  auth?: DeriveAuth
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (auth) {
    headers["X-LyraWallet"] = auth.wallet;
    headers["X-LyraTimestamp"] = auth.timestamp;
    headers["X-LyraSignature"] = auth.signature;
  }

  const url = `${DERIVE_API_URL}/${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });

  const text = await res.text();
  let data: T;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `Derive API returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`
    );
  }

  if (!res.ok) {
    const raw = data as Record<string, unknown>;
    const errField = raw?.error;
    let errMsg: string;
    if (typeof errField === "object" && errField !== null) {
      const errObj = errField as Record<string, unknown>;
      errMsg = (errObj.message as string) || (errObj.data as string) || JSON.stringify(errField);
    } else {
      errMsg = String(errField || raw?.message || text.slice(0, 200));
    }
    throw new Error(`Derive API error (${res.status}): ${errMsg}`);
  }

  // Derive API wraps responses in { result: ... }
  const wrapper = data as Record<string, unknown>;
  if (wrapper && typeof wrapper === "object" && "result" in wrapper) {
    const result = wrapper.result as Record<string, unknown>;
    // Derive sometimes returns errors inside result with 200 status
    if (result && typeof result === "object" && "error" in result) {
      const err = result.error as Record<string, unknown>;
      throw new Error(`Derive API error: ${err?.message || JSON.stringify(err)}`);
    }
    return result as T;
  }

  return data;
}

// Public endpoints
export async function getInstruments(params: {
  currency: string;
  instrument_type?: string;
  expired?: boolean;
}) {
  return post<{ result: Instrument[] }>("public/get_instruments", params);
}

export async function getTicker(instrument_name: string) {
  return post<Ticker>("public/get_ticker", { instrument_name });
}

export async function getTickers(params: {
  currency: string;
  instrument_type?: string;
  expiry?: number;
  expired?: boolean;
}) {
  return post<Ticker[]>("public/get_tickers", params);
}

export async function getOrderBook(params: {
  instrument_name: string;
  depth?: number;
}) {
  return post<{ bids: [string, string][]; asks: [string, string][] }>(
    "public/get_order_book",
    params
  );
}

export async function getTradeHistory(params: {
  instrument_name: string;
  count?: number;
}) {
  return post<{ trades: TradeHistoryItem[] }>(
    "public/get_trade_history",
    params
  );
}

// Private endpoints (require auth headers)
export async function submitOrder(params: OrderParams, auth: DeriveAuth) {
  return post<Order>(
    "private/order",
    params as unknown as Record<string, unknown>,
    auth
  );
}

export async function cancelOrder(
  params: { order_id: string; subaccount_id: number },
  auth: DeriveAuth
) {
  return post<{ order_id: string }>("private/cancel", params, auth);
}

export async function cancelAllOrders(
  params: { subaccount_id: number; instrument_name?: string },
  auth: DeriveAuth
) {
  return post<{ count: number }>("private/cancel_all", params, auth);
}

export async function getOpenOrders(
  params: { subaccount_id: number; instrument_name?: string },
  auth: DeriveAuth
) {
  return post<{ orders: Order[] }>(
    "private/get_open_orders",
    params,
    auth
  );
}

export async function getPositions(
  params: { subaccount_id: number; currency?: string },
  auth: DeriveAuth
) {
  return post<{ positions: Position[] }>(
    "private/get_positions",
    params,
    auth
  );
}

export async function getAccount(
  params: { subaccount_id: number },
  auth: DeriveAuth
) {
  return post<Account>("private/get_subaccount", params, auth);
}

export async function getSubaccounts(auth: DeriveAuth) {
  return post<{ subaccount_ids: number[] }>(
    "private/get_subaccounts",
    { wallet: auth.wallet },
    auth
  );
}

export async function createSubaccount(
  params: { wallet: string; asset_name?: string; amount?: string },
  auth: DeriveAuth
) {
  return post<{ subaccount_id: number }>(
    "private/create_subaccount",
    params,
    auth
  );
}
