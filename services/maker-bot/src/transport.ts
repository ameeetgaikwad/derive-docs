/**
 * Maker <-> rfq-engine WS transport.
 *
 * Speaks the maker channel protocol implemented by
 * services/rfq-engine/src/server.ts (wire types mirrored from
 * services/rfq-engine/src/types.ts — kept as local copies so the bot only
 * depends on ../shared). Everything protocol-shaped lives in this one file so
 * any engine wire change is a local adaptation.
 *
 * Flow (JSON frames, bigints as decimal strings):
 *   engine -> maker  {type:"auth_challenge", challenge}
 *   maker  -> engine {type:"auth", address, signature}   // EIP-191 personal-sign of challenge
 *   engine -> maker  {type:"auth_ok", address}           // then replays open RFQs
 *   engine -> maker  {type:"rfq_open", rfq: PublicRfq}
 *   maker  -> engine {type:"quote", rfqId, action, signature}
 *   engine -> maker  {type:"quote_ack"|"quote_rejected"|"rfq_closed"|"rfq_executed"|"error", ...}
 *
 * The quote carries only the fully-signed maker RfqModule Action — the engine
 * decodes RfqOrder{maxFee,trades[]} from action.data, validates it against
 * the RFQ (asset/subId/amount/price/cash) and uses it as actions[0] in
 * Matching.verifyAndMatch.
 */
import type { Address, Hex } from "viem";
import type { Action } from "@hedge/shared";

// ---------------------------------------------------------------------------
// Wire types (mirroring rfq-engine/src/types.ts)
// ---------------------------------------------------------------------------

export interface SerializedAction {
  subaccountId: string;
  nonce: string;
  module: Address;
  data: Hex;
  expiry: string;
  owner: Address;
  signer: Address;
}

/** RFQ view broadcast to makers. v1 direction is always "sell" (taker sells). */
export interface PublicRfq {
  id: string;
  takerSubaccountId: string;
  direction: "sell";
  instrument: {
    name: string;
    currency: string;
    optionAsset: Address;
    /** unix seconds, decimal string */
    expiry: string;
    /** 18dp string */
    strike: string;
    isCall: boolean;
    subId: string;
  };
  /** 18dp string, > 0; the maker must sign trade.amount == +amount */
  amount: string;
  createdAt: number;
  /** ms epoch — quotes accepted strictly before this */
  auctionEndsAt: number;
  status: string;
}

export type MakerServerMessage =
  | { type: "auth_challenge"; challenge: string }
  | { type: "auth_ok"; address: string }
  | { type: "rfq_open"; rfq: PublicRfq }
  | { type: "rfq_closed"; rfqId: string; bestQuoteId: string | null; won?: boolean }
  | { type: "rfq_executed"; rfqId: string; txHash: Hex }
  | { type: "quote_ack"; rfqId: string; quoteId: string }
  | { type: "quote_rejected"; rfqId: string; reason: string }
  | { type: "error"; message: string };

export type MakerClientMessage =
  | { type: "auth"; address: string; signature: string }
  | { type: "quote"; rfqId: string; action: SerializedAction; signature: string };

export function serializeAction(action: Action): SerializedAction {
  return {
    subaccountId: action.subaccountId.toString(),
    nonce: action.nonce.toString(),
    module: action.module,
    data: action.data,
    expiry: action.expiry.toString(),
    owner: action.owner,
    signer: action.signer,
  };
}

export function deserializeAction(wire: SerializedAction): Action {
  return {
    subaccountId: BigInt(wire.subaccountId),
    nonce: BigInt(wire.nonce),
    module: wire.module,
    data: wire.data,
    expiry: BigInt(wire.expiry),
    owner: wire.owner,
    signer: wire.signer,
  };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface MakerWsClientOptions {
  url: string;
  address: Address;
  /** EIP-191 personal-sign (viem account.signMessage). */
  signMessage: (message: string) => Promise<Hex>;
  onRfq: (rfq: PublicRfq) => void | Promise<void>;
  /** Auction results / acks — informational. */
  onEvent?: (msg: MakerServerMessage) => void;
  log?: (...args: unknown[]) => void;
  /** Initial reconnect delay ms (doubles up to 30s). Default 1000. */
  reconnectMs?: number;
}

/**
 * Tiny reconnecting maker-channel client over Node 22's global WebSocket
 * (no runtime deps). Authenticates on every (re)connect; the engine replays
 * currently-open RFQs after auth_ok, so reconnects never miss live auctions.
 */
export class MakerWsClient {
  private ws: WebSocket | null = null;
  private closed = false;
  private delay: number;
  private authed = false;
  private readonly opts: MakerWsClientOptions;

  constructor(opts: MakerWsClientOptions) {
    this.opts = opts;
    this.delay = opts.reconnectMs ?? 1000;
  }

  private log(...args: unknown[]) {
    (this.opts.log ?? console.log)("[transport]", ...args);
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get authenticated(): boolean {
    return this.connected && this.authed;
  }

  sendQuote(rfqId: string, action: Action, signature: Hex): void {
    this.send({ type: "quote", rfqId, action: serializeAction(action), signature });
  }

  private send(msg: MakerClientMessage): void {
    if (!this.connected) throw new Error("WS not connected");
    this.ws!.send(JSON.stringify(msg));
  }

  private connect(): void {
    if (this.closed) return;
    this.log(`connecting to ${this.opts.url}`);
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    this.authed = false;

    ws.addEventListener("message", (ev: MessageEvent) => {
      let msg: MakerServerMessage;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data));
      } catch {
        this.log("ignoring non-JSON frame");
        return;
      }
      void this.handle(msg).catch((err) => this.log("handler error:", err));
    });

    ws.addEventListener("close", () => {
      this.ws = null;
      this.authed = false;
      if (this.closed) return;
      this.log(`disconnected, retrying in ${this.delay}ms`);
      setTimeout(() => this.connect(), this.delay);
      this.delay = Math.min(this.delay * 2, 30_000);
    });

    ws.addEventListener("error", () => {
      // close fires next; logged there
    });
  }

  private async handle(msg: MakerServerMessage): Promise<void> {
    switch (msg.type) {
      case "auth_challenge": {
        const signature = await this.opts.signMessage(msg.challenge);
        this.send({ type: "auth", address: this.opts.address, signature });
        return;
      }
      case "auth_ok":
        this.authed = true;
        this.delay = this.opts.reconnectMs ?? 1000;
        this.log(`authenticated as ${msg.address}`);
        return;
      case "rfq_open":
        await this.opts.onRfq(msg.rfq);
        return;
      default:
        this.opts.onEvent?.(msg);
    }
  }
}
