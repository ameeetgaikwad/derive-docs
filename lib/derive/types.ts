export interface DeriveRpcRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface DeriveRpcResponse<T = unknown> {
  id: string;
  result: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface Instrument {
  instrument_name: string;
  instrument_type: string;
  base_currency: string;
  quote_currency: string;
  is_active: boolean;
  // Legacy flat fields (may not be present in API response)
  option_type?: string;
  strike?: string;
  expiry?: number;
  // Nested option details from Derive API
  option_details?: {
    index: string;
    expiry: number;
    strike: string;
    option_type: string;
    settlement_price: string | null;
  };
  min_order_size?: string;
  minimum_amount?: string;
  tick_size: string;
}

export interface OptionPricing {
  bid_iv?: string;
  ask_iv?: string;
  mark_iv?: string;
  delta?: string;
  gamma?: string;
  vega?: string;
  theta?: string;
  rho?: string;
}

export interface Ticker {
  instrument_name: string;
  best_bid_price: string;
  best_bid_amount: string;
  best_ask_price: string;
  best_ask_amount: string;
  mark_price: string;
  index_price: string;
  last_price?: string;
  open_interest?: unknown;
  option_pricing?: OptionPricing;
  stats: {
    high: string;
    low: string;
    contract_volume: string;
    volume?: string;
    percent_change: string;
    price_change?: string;
    num_trades: string;
    open_interest: string;
    usd_change?: string;
  };
  timestamp?: number;
}

export interface OrderParams {
  instrument_name: string;
  subaccount_id: number;
  direction: "buy" | "sell";
  limit_price: string;
  amount: string;
  order_type: "limit" | "market";
  time_in_force?: "gtc" | "ioc" | "fok";
  max_fee: string;
  signature: string;
  signature_expiry_sec: number;
  nonce: number;
  signer: string;
  mmp: boolean;
  label?: string;
}

export interface Order {
  order_id: string;
  instrument_name: string;
  direction: "buy" | "sell";
  order_type: string;
  limit_price: string;
  amount: string;
  filled_amount: string;
  status: string;
  creation_timestamp: number;
  last_update_timestamp: number;
}

export interface Position {
  instrument_name: string;
  direction: "buy" | "sell";
  amount: string;
  average_price: string;
  mark_price: string;
  index_price: string;
  unrealized_pnl: string;
  realized_pnl: string;
  maintenance_margin: string;
}

export interface Account {
  subaccount_id: number;
  equity: string;
  initial_margin: string;
  maintenance_margin: string;
  margin_type: string;
  collaterals: Collateral[];
  positions: Position[];
}

export interface Collateral {
  asset_name: string;
  amount: string;
  value: string;
}

export interface LoginResult {
  access_token?: string;
}

export interface TradeHistoryItem {
  trade_id: string;
  instrument_name: string;
  direction: "buy" | "sell";
  price: string;
  amount: string;
  timestamp: number;
}
