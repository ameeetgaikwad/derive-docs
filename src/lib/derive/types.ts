// ===== Common Types =====

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

// ===== Instrument Types =====

export type InstrumentType = "option" | "perp" | "erc20";
export type OptionType = "C" | "P";
export type Currency = "ETH" | "BTC" | "USDC";

export interface OptionDetails {
  index: string;
  expiry: number; // Unix timestamp
  strike: string;
  option_type: OptionType;
  settlement_price: string | null;
}

export interface PerpDetails {
  index: string;
  max_rate_per_hour: string;
  min_rate_per_hour: string;
  static_interest_rate: string;
  aggregate_funding: string;
  funding_rate: string;
}

export interface Instrument {
  instrument_name: string;
  instrument_type: InstrumentType;
  base_currency: Currency;
  quote_currency: Currency;
  base_asset_address: string;
  base_asset_sub_id: string;
  is_active: boolean;
  tick_size: string;
  minimum_amount: string;
  maximum_amount: string;
  amount_step: string;
  scheduled_activation: number;
  scheduled_deactivation: number;
  maker_fee_rate: string;
  taker_fee_rate: string;
  base_fee: string;
  option_details: OptionDetails | null;
  perp_details: PerpDetails | null;
  erc20_details: unknown | null;
  // Convenience accessors (derived)
  /** @deprecated Use option_details.option_type */
  option_type?: OptionType;
  /** @deprecated Use option_details.strike */
  strike?: string;
  /** @deprecated Use option_details.expiry */
  expiry?: number;
}

export interface GetInstrumentsRequest {
  currency: Currency;
  instrument_type: InstrumentType;
  expired?: boolean;
}

export interface GetInstrumentsResponse {
  result: Instrument[];
}

// ===== Ticker Types =====

export interface TickerStats {
  contract_volume: string;
  num_trades: string;
  open_interest: string;
  high: string;
  low: string;
  percent_change: string;
  usd_change: string;
}

export interface OptionPricing {
  delta: string;
  theta: string;
  gamma: string;
  vega: string;
  iv: string;
  rho: string;
  mark_price: string;
  forward_price: string;
  discount_factor: string;
  bid_iv: string;
  ask_iv: string;
}

export interface Ticker {
  instrument_name: string;
  instrument_type: InstrumentType;
  best_bid_price: string;
  best_bid_amount: string;
  best_ask_price: string;
  best_ask_amount: string;
  mark_price: string;
  index_price: string;
  timestamp: number;
  min_price: string;
  max_price: string;
  stats: TickerStats;
  option_pricing: OptionPricing | null;
  option_details: OptionDetails | null;
  perp_details: PerpDetails | null;
}

export interface GetTickerRequest {
  instrument_name: string;
}

// ===== Orderbook Types (WebSocket only — no REST endpoint) =====

export type OrderbookEntry = [string, string]; // [price, amount]

export interface Orderbook {
  instrument_name: string;
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
  timestamp: number;
}

// ===== Order Types =====

export type OrderType = "limit" | "market";
export type OrderDirection = "buy" | "sell";
export type OrderStatus = "open" | "filled" | "cancelled" | "expired" | "rejected";
export type TimeInForce = "gtc" | "ioc" | "fok";

export interface OrderParams {
  instrument_name: string;
  direction: OrderDirection;
  order_type: OrderType;
  amount: string;
  limit_price?: string;
  time_in_force?: TimeInForce;
  label?: string;
  mmp?: boolean;
  // Signed fields
  subaccount_id: number;
  nonce: number;
  signature_expiry_sec: number;
  signer: string;
  signature: string;
  max_fee: string;
}

export interface Order {
  order_id: string;
  instrument_name: string;
  direction: OrderDirection;
  order_type: OrderType;
  amount: string;
  filled_amount: string;
  limit_price: string;
  average_price: string;
  status: OrderStatus;
  creation_timestamp: number;
  last_update_timestamp: number;
  label: string;
  subaccount_id: number;
}

export interface OrderResult {
  order: Order;
  trades: Trade[];
}

// ===== Trade Types =====

export interface Trade {
  trade_id: string;
  instrument_name: string;
  direction: OrderDirection;
  amount: string;
  price: string;
  fee: string;
  timestamp: number;
  order_id: string;
  subaccount_id: number;
}

// ===== Position Types =====

export interface Position {
  instrument_name: string;
  direction: OrderDirection;
  amount: string;
  average_price: string;
  mark_price: string;
  index_price: string;
  unrealized_pnl: string;
  realized_pnl: string;
  net_settlements: string;
  open_orders_margin: string;
  creation_timestamp: number;
  greeks?: {
    delta: string;
    gamma: string;
    theta: string;
    vega: string;
  };
}

export interface GetPositionsRequest {
  subaccount_id: number;
  currency?: Currency;
  instrument_type?: InstrumentType;
}

// ===== Account / Subaccount Types =====

export interface Subaccount {
  subaccount_id: number;
  label: string;
  manager: string;
  margin_type: string;
  portfolio_value: string;
  initial_margin: string;
  maintenance_margin: string;
}

export interface Collateral {
  asset_name: string;
  asset_type: string;
  amount: string;
  mark_price: string;
  mark_value: string;
}

export interface SessionKey {
  public_key: `0x${string}`;
  private_key: `0x${string}`;
  expiry: number;
  subaccount_id: number;
  /** Tx hash of on-chain registration. Null if not yet sent. */
  registration_tx_hash?: string;
  /** Whether register_session_key API call succeeded. */
  api_registered?: boolean;
}

// ===== Session Key Registration Types =====

export interface RegisterSessionKeyTx {
  chainId: number;
  data: `0x${string}`;
  from: `0x${string}`;
  gas: number;
  gasLimit: number;
  maxFeePerGas: number;
  maxPriorityFeePerGas: number;
  nonce: number;
  to: `0x${string}`;
  type: number;
  value: number;
}

// ===== WebSocket Types =====

export interface WsSubscription {
  channel: string;
  instrument_name?: string;
}

export interface WsMessage<T = unknown> {
  jsonrpc: "2.0";
  method?: string;
  params?: {
    channel: string;
    data: T;
  };
  id?: number;
  result?: T;
  error?: { code: number; message: string };
}

export interface WsOrderbookData {
  instrument_name: string;
  bids: OrderbookEntry[];
  asks: OrderbookEntry[];
  timestamp: number;
  publish_id: number;
}

/** ticker_slim WS data — abbreviated field names */
export interface WsTickerSlimInstrument {
  t: number; // timestamp
  A: string; // best_ask_amount
  a: string; // best_ask_price
  B: string; // best_bid_amount
  b: string; // best_bid_price
  f?: string; // funding_rate
  I: string; // index_price
  M: string; // mark_price
  minp: string; // min_price
  maxp: string; // max_price
  option_pricing: {
    d?: string; // delta
    g?: string; // gamma
    v?: string; // vega
    th?: string; // theta
    r?: string; // rho
    iv?: string; // implied vol
  } | null;
  stats: {
    c: string; // contract_volume
    v: string; // notional_volume
    pr: string; // premium_volume
    n: number; // num_trades
    oi: string; // open_interest
    h: string; // high
    l: string; // low
    p: string; // percent_change
  };
}

export interface WsTickerSlimData {
  timestamp: number;
  instrument_ticker: WsTickerSlimInstrument;
}

export interface WsTradeData {
  instrument_name: string;
  trades: Trade[];
}

// ===== Margin Types =====

export interface MarginEstimate {
  initial_margin: string;
  maintenance_margin: string;
  margin_used: string;
  available_margin: string;
}
