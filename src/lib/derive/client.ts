import type {
  Instrument,
  Ticker,
  OrderParams,
  OrderResult,
  Order,
  Position,
  Subaccount,
  Collateral,
  MarginEstimate,
  Currency,
  InstrumentType,
  RegisterSessionKeyTx,
} from "./types";
import { getConfig, type DeriveEnv } from "./constants";

interface DeriveErrorBody {
  error: { code: number; message: string; data?: unknown };
}

/** Function that signs a message string and returns a hex signature. */
export type MessageSigner = (message: string) => Promise<`0x${string}`>;

export class DeriveRestClient {
  private baseUrl: string;
  private walletAddress: `0x${string}` | null = null;
  private signer: MessageSigner | null = null;

  constructor(env?: DeriveEnv) {
    const config = getConfig(env);
    // In the browser, proxy through Next.js rewrites to avoid CORS
    this.baseUrl = typeof window !== "undefined" ? "/api/derive" : config.restUrl;
  }

  /**
   * Set auth credentials for private endpoints.
   * X-LyraWallet = Derive smart contract wallet (SCW) on Derive Chain.
   * Signer can be EOA (for initial auth) or session key (for ongoing use).
   * The API verifies ecrecover(signature) is authorized for the SCW.
   */
  setAuth(walletAddress: `0x${string}`, signer: MessageSigner) {
    this.walletAddress = walletAddress;
    this.signer = signer;
  }

  clearAuth() {
    this.walletAddress = null;
    this.signer = null;
  }

  get currentWallet(): `0x${string}` | null {
    return this.walletAddress;
  }

  private async getAuthHeaders(): Promise<Record<string, string>> {
    if (!this.walletAddress || !this.signer) {
      throw new Error("Auth not configured. Call setAuth() first.");
    }
    const timestamp = Date.now().toString();
    const signature = await this.signer(timestamp);
    // Derive API expects signature WITHOUT 0x prefix (Python SDK uses .hex() which omits it)
    const sigNoPrefix = signature.startsWith("0x") ? signature.slice(2) : signature;
    return {
      "X-LyraWallet": this.walletAddress,
      "X-LyraTimestamp": timestamp,
      "X-LyraSignature": sigNoPrefix,
    };
  }

  private async rpc<T>(method: string, params: object = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Add auth headers for private methods
    if (method.startsWith("private/")) {
      const authHeaders = await this.getAuthHeaders();
      Object.assign(headers, authHeaders);
    }

    const url = `${this.baseUrl}/${method}`;
    const isPrivate = method.startsWith("private/");
    console.log(`[Derive RPC] ${method}`, {
      params,
      wallet: this.walletAddress,
      hasAuth: isPrivate ? `wallet=${this.walletAddress}, timestamp=${headers["X-LyraTimestamp"]}` : "n/a",
    });

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
    });

    const text = await res.text();

    // Handle HTML error responses from nginx (401/403)
    if (text.startsWith("<") || text.startsWith("<!")) {
      const statusMsg = res.status === 401 ? "Authorization Required" :
                        res.status === 403 ? "Forbidden" : `HTTP ${res.status}`;
      console.error(`[Derive RPC] ${method} — nginx ${statusMsg} (HTML response)`);
      if (isPrivate) {
        console.error(`[Derive RPC] Auth headers sent: X-LyraWallet=${headers["X-LyraWallet"]}, X-LyraTimestamp=${headers["X-LyraTimestamp"]}, sig_len=${headers["X-LyraSignature"]?.length}`);
      }
      throw new DeriveApiError(res.status, `${statusMsg}: ${method} — auth headers may be invalid`);
    }

    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      console.error(`[Derive RPC] ${method} — non-JSON response:`, text.slice(0, 500));
      throw new DeriveApiError(-1, `HTTP ${res.status}: non-JSON response from ${method}`);
    }

    if (!res.ok || json.error) {
      const err = json.error as { code: number; message: string; data?: unknown } | undefined;
      if (err) {
        console.error(`[Derive RPC] ${method} — API error:`, err.code, err.message, err.data);
        throw new DeriveApiError(err.code, err.message, err.data);
      }
      console.error(`[Derive RPC] ${method} — HTTP ${res.status}:`, text.slice(0, 500));
      throw new DeriveApiError(res.status, `HTTP ${res.status}: ${res.statusText}`);
    }

    const result = (json.result !== undefined ? json.result : json) as T;
    console.log(`[Derive RPC] ${method} — OK`);
    return result;
  }

  // ===== Public Methods =====

  async getInstruments(currency: Currency, instrumentType: InstrumentType, expired = false) {
    return this.rpc<Instrument[]>("public/get_instruments", {
      currency,
      instrument_type: instrumentType,
      expired,
    });
  }

  async getTicker(instrumentName: string) {
    return this.rpc<Ticker>("public/get_ticker", {
      instrument_name: instrumentName,
    });
  }

  async getTickers(instrumentNames: string[]) {
    return Promise.all(instrumentNames.map((name) => this.getTicker(name)));
  }

  async getTime() {
    return this.rpc<number>("public/get_time");
  }

  async getAllCurrencies() {
    return this.rpc<{ currency: string; asset_name: string }[]>("public/get_all_currencies");
  }

  // ===== Private Methods (require auth) =====

  async getSubaccounts(wallet: `0x${string}`) {
    const res = await this.rpc<unknown>("private/get_subaccounts", {
      wallet,
    });
    console.log("getSubaccounts raw response:", JSON.stringify(res));

    // Handle various response formats from the API
    if (Array.isArray(res)) return res as Subaccount[];

    const obj = res as Record<string, unknown>;

    // Format: { subaccount_ids: [123, 456] }
    if (Array.isArray(obj.subaccount_ids)) {
      return (obj.subaccount_ids as number[]).map((id) => ({
        subaccount_id: id,
        label: "",
        manager: "",
        margin_type: "",
        portfolio_value: "0",
        initial_margin: "0",
        maintenance_margin: "0",
      })) as Subaccount[];
    }

    // Format: { subaccounts: [...] }
    if (Array.isArray(obj.subaccounts)) {
      return obj.subaccounts as Subaccount[];
    }

    // If the response itself has subaccount_id, wrap it
    if (typeof obj.subaccount_id === "number") {
      return [obj as unknown as Subaccount];
    }

    console.warn("Unexpected getSubaccounts response format:", res);
    return [];
  }

  async getAccount(wallet: `0x${string}`) {
    return this.rpc<{ wallet: string; subaccount_ids: number[] }>("private/get_account", {
      wallet,
    });
  }

  async buildRegisterSessionKeyTx(params: {
    wallet: `0x${string}`;
    public_session_key: `0x${string}`;
    expiry_sec: number;
    nonce?: number | null;
    gas?: string;
  }) {
    return this.rpc<{ tx_params: RegisterSessionKeyTx }>("public/build_register_session_key_tx", {
      wallet: params.wallet,
      public_session_key: params.public_session_key,
      expiry_sec: params.expiry_sec,
      nonce: params.nonce ?? null,
      gas: params.gas ?? "1000000",
    });
  }

  async registerSessionKey(params: {
    wallet: `0x${string}`;
    public_session_key: `0x${string}`;
    label: string;
    expiry_sec: number;
    signed_raw_tx: string;
  }) {
    return this.rpc<{ status: string }>("public/register_session_key", params);
  }

  /**
   * Register a scoped session key via private endpoint.
   * Uses standard auth headers (EOA can sign).
   * NOTE: "admin" scope may require signed_raw_tx on some API versions.
   * Scopes: "admin" (full), "account" (manage orders/RFQs), "read_only"
   */
  async registerScopedSessionKey(params: {
    wallet: `0x${string}`;
    public_session_key: `0x${string}`;
    expiry_sec: number;
    label?: string;
    scope?: string;
  }) {
    return this.rpc<{ status: string }>("private/register_scoped_session_key", {
      wallet: params.wallet,
      public_session_key: params.public_session_key,
      expiry_sec: params.expiry_sec,
      ...(params.label && { label: params.label }),
      scope: params.scope ?? "admin",
    });
  }

  async submitOrder(params: OrderParams) {
    return this.rpc<OrderResult>("private/order", params);
  }

  async cancelOrder(orderId: string, subaccountId: number, instrumentName: string) {
    return this.rpc<Order>("private/cancel", {
      order_id: orderId,
      subaccount_id: subaccountId,
      instrument_name: instrumentName,
    });
  }

  async cancelAllOrders(subaccountId: number, instrumentName?: string) {
    return this.rpc<{ cancelled_orders: number }>("private/cancel_all", {
      subaccount_id: subaccountId,
      ...(instrumentName && { instrument_name: instrumentName }),
    });
  }

  async getPositions(subaccountId: number, currency?: Currency, instrumentType?: InstrumentType) {
    const res = await this.rpc<{ positions: Position[] } | Position[]>("private/get_positions", {
      subaccount_id: subaccountId,
      ...(currency && { currency }),
      ...(instrumentType && { instrument_type: instrumentType }),
    });
    return Array.isArray(res) ? res : res.positions ?? [];
  }

  async getCollaterals(subaccountId: number) {
    const res = await this.rpc<{ collaterals: Collateral[] } | Collateral[]>("private/get_collaterals", {
      subaccount_id: subaccountId,
    });
    return Array.isArray(res) ? res : res.collaterals ?? [];
  }

  async getOpenOrders(subaccountId: number, instrumentName?: string) {
    const res = await this.rpc<{ orders: Order[] } | Order[]>("private/get_open_orders", {
      subaccount_id: subaccountId,
      ...(instrumentName && { instrument_name: instrumentName }),
    });
    return Array.isArray(res) ? res : res.orders ?? [];
  }

  async getMargin(subaccountId: number) {
    return this.rpc<MarginEstimate>("private/get_margin", {
      subaccount_id: subaccountId,
    });
  }

  async estimateOrderMargin(params: {
    subaccount_id: number;
    instrument_name: string;
    direction: "buy" | "sell";
    amount: string;
    limit_price: string;
  }) {
    return this.rpc<MarginEstimate>("private/estimate_order_margin", params);
  }

  /**
   * Create a new subaccount with an initial deposit.
   * Requires EIP-712 signature from the wallet owner.
   */
  async createSubaccount(params: {
    wallet: `0x${string}`;
    amount: string;
    asset_name: string;
    nonce: number;
    signature_expiry_sec: number;
    signer: string;
    signature: string;
    margin_type?: "SM" | "PM";
  }) {
    return this.rpc<{ subaccount_id: number; status: string }>("private/create_subaccount", params);
  }

  /**
   * Deposit to an existing subaccount.
   * Requires EIP-712 signature from the wallet owner.
   */
  async deposit(params: {
    subaccount_id: number;
    amount: string;
    asset_name: string;
    nonce: number;
    signature_expiry_sec: number;
    signer: string;
    signature: string;
  }) {
    return this.rpc<{ status: string }>("private/deposit", params);
  }
}

export class DeriveApiError extends Error {
  code: number;
  data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "DeriveApiError";
    this.code = code;
    this.data = data;
  }
}
