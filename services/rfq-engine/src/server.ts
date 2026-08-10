import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { verifyMessage, type Address } from "viem";
import { AuctionEngine } from "./auction.js";
import { QuoteValidationError } from "./quotes.js";
import { marketStatus, type PublicMarketStatus } from "./markets.js";
import type { MarketDefinition } from "@hedge/shared";
import {
  addressEq,
  asAddress,
  asHex,
  parseAction,
  publicBestQuote,
  publicRfq,
  type AcceptRfqRequest,
  type CreateRfqRequest,
  type MakerClientMessage,
  type MakerServerMessage,
  type Quote,
  type Rfq,
  type RfqStatusResponse,
  type TakerClientMessage,
  type TakerServerMessage,
  wireFill,
} from "./types.js";

const MAX_BODY_BYTES = 1024 * 1024;
const DEFAULT_HEARTBEAT_MS = 30_000;
const DEFAULT_RFQ_RATE_LIMIT_PER_MIN = 30;

/** WS close codes (4000-4999 = application-defined). */
export const WS_CLOSE_SUPERSEDED = 4000;
export const WS_CLOSE_NOT_ALLOWLISTED = 4003;

interface MakerSession {
  socket: WebSocket;
  challenge: string;
  address: Address | null;
  isAlive: boolean;
}

interface TakerSession {
  socket: WebSocket;
  subscriptions: Set<string>;
  ip: string;
  isAlive: boolean;
}

export interface RfqEngineServerOptions {
  engine: AuctionEngine;
  /** 0 = ephemeral (tests) */
  port: number;
  /** listen address; default 127.0.0.1 — front with a TLS-terminating proxy in prod */
  host?: string;
  /** lowercase-insensitive maker address allowlist; empty/undefined = open (dev) */
  makerAllowlist?: string[];
  /** accept RFQ creation from any IP (default true); false = 403 every create */
  takerOpen?: boolean;
  /** RFQ creations allowed per IP per minute (REST + taker WS). 0 disables. */
  rfqRateLimitPerMin?: number;
  /** WS ping interval; a connection missing a pong for one full interval is dropped. 0 disables. */
  heartbeatMs?: number;
  /** canonical registry returned by GET /markets */
  markets?: MarketDefinition[];
  /** Optional live readiness projection used by GET /markets and /health. */
  marketStatusProvider?: (market: MarketDefinition) => Promise<PublicMarketStatus>;
}

/** Fixed-window-ish per-key rate limiter (sliding 60s window of timestamps). */
class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limitPerMin: number,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    if (this.limitPerMin <= 0) return true;
    const cutoff = this.now() - 60_000;
    const recent = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (recent.length >= this.limitPerMin) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(this.now());
    this.hits.set(key, recent);
    return true;
  }
}

/**
 * HTTP + WebSocket front-end.
 *
 * REST:
 *   GET  /health
 *   POST /rfq               open an auction { subaccountId, instrument, amount, direction }
 *   GET  /rfq/:id           auction state + best quote (orderHash + trades to sign over)
 *   POST /rfq/:id/accept    { action, signature } -> executes on-chain, returns tx hash
 *
 * WS:
 *   /maker   signature-authenticated; receives every open RFQ, pushes signed quotes
 *   /taker   create RFQs / subscribe to updates over WS instead of REST
 */
export class RfqEngineServer {
  readonly httpServer: Server;
  private readonly makerWss: WebSocketServer;
  private readonly takerWss: WebSocketServer;
  private readonly makers = new Map<WebSocket, MakerSession>();
  private readonly takers = new Map<WebSocket, TakerSession>();
  private readonly engine: AuctionEngine;
  private readonly port: number;
  private readonly host: string;
  private readonly allowlist: Set<string> | null;
  private readonly takerOpen: boolean;
  private readonly rfqLimiter: RateLimiter;
  private readonly heartbeatMs: number;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly markets: MarketDefinition[];
  private readonly marketStatusProvider: (market: MarketDefinition) => Promise<PublicMarketStatus>;

  constructor(opts: RfqEngineServerOptions) {
    this.engine = opts.engine;
    this.port = opts.port;
    this.host = opts.host ?? "127.0.0.1";
    this.allowlist =
      opts.makerAllowlist && opts.makerAllowlist.length > 0
        ? new Set(opts.makerAllowlist.map((a) => a.toLowerCase()))
        : null;
    this.takerOpen = opts.takerOpen ?? true;
    this.rfqLimiter = new RateLimiter(opts.rfqRateLimitPerMin ?? DEFAULT_RFQ_RATE_LIMIT_PER_MIN);
    this.heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.markets = opts.markets ?? [];
    this.marketStatusProvider = opts.marketStatusProvider ?? (async (market) => marketStatus(market));

    this.httpServer = createServer((req, res) => {
      this.handleHttp(req, res).catch((err) => {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      });
    });

    this.makerWss = new WebSocketServer({ noServer: true });
    this.takerWss = new WebSocketServer({ noServer: true });

    this.httpServer.on("upgrade", (req, socket, head) => {
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      const ip = req.socket.remoteAddress ?? "unknown";
      if (pathname === "/maker") {
        this.makerWss.handleUpgrade(req, socket, head, (ws) => this.onMakerConnect(ws));
      } else if (pathname === "/taker") {
        this.takerWss.handleUpgrade(req, socket, head, (ws) => this.onTakerConnect(ws, ip));
      } else {
        socket.destroy();
      }
    });

    // Fan engine events out to connected clients
    this.engine.on("rfq_open", (rfq) => this.broadcastRfqOpen(rfq));
    this.engine.on("rfq_closed", (rfq, best) => {
      this.broadcastRfqClosed(rfq, best);
      void this.pushTakerUpdate(rfq);
    });
    this.engine.on("rfq_executed", (rfq, result) => {
      this.broadcastToMakers({
        type: "rfq_executed",
        rfqId: rfq.id,
        txHash: result.txHash,
        fill: wireFill(result.fill, result.blockNumber),
      });
      void this.pushTakerUpdate(rfq);
    });
    this.engine.on("rfq_failed", (rfq, error) => {
      void this.notifyWinningMaker(rfq, { type: "rfq_failed", rfqId: rfq.id, reason: error });
      void this.pushTakerUpdate(rfq);
    });
    this.engine.on("rfq_accept_expired", (rfq, winningQuote) => {
      if (winningQuote) {
        this.sendToMakerAddress(winningQuote.maker, {
          type: "rfq_expired",
          rfqId: rfq.id,
          reason: "taker did not accept before the deadline",
        });
      }
      void this.pushTakerUpdate(rfq);
    });
  }

  async start(): Promise<{ port: number }> {
    await new Promise<void>((resolve, reject) => {
      this.httpServer.once("error", reject);
      this.httpServer.listen(this.port, this.host, () => resolve());
    });
    if (this.heartbeatMs > 0) {
      this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatMs);
      this.heartbeatTimer.unref?.();
    }
    const address = this.httpServer.address();
    const port = typeof address === "object" && address !== null ? address.port : this.port;
    return { port };
  }

  async stop(): Promise<void> {
    this.engine.stop();
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    for (const ws of [...this.makers.keys(), ...this.takers.keys()]) ws.terminate();
    this.makerWss.close();
    this.takerWss.close();
    await new Promise<void>((resolve, reject) =>
      this.httpServer.close((err) => (err ? reject(err) : resolve())),
    );
  }

  /**
   * WS liveness: every heartbeatMs we ping each connection; one that hasn't
   * ponged (or sent anything) since the previous round is terminated.
   */
  private heartbeat(): void {
    const sessions: { socket: WebSocket; session: { isAlive: boolean } }[] = [
      ...[...this.makers.values()].map((s) => ({ socket: s.socket, session: s })),
      ...[...this.takers.values()].map((s) => ({ socket: s.socket, session: s })),
    ];
    for (const { socket, session } of sessions) {
      if (!session.isAlive) {
        socket.terminate();
        continue;
      }
      session.isAlive = false;
      try {
        socket.ping();
      } catch {
        socket.terminate();
      }
    }
  }

  // -------------------------------------------------------------------------
  // REST
  // -------------------------------------------------------------------------

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // CORS: the hedge frontend calls this API straight from the
    // browser. Permissive by design — the API is unauthenticated and every
    // state-changing call is gated by EIP-712 signatures verified on-chain.
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    if (req.method === "GET" && path === "/health") {
      return sendJson(res, 200, {
        ok: true,
        service: "rfq-engine",
        markets: await Promise.all(this.markets.map((market) => this.marketStatusProvider(market))),
      });
    }

    if (req.method === "GET" && path === "/markets") {
      return sendJson(res, 200, {
        markets: await Promise.all(this.markets.map((market) => this.marketStatusProvider(market))),
      });
    }

    if (req.method === "POST" && path === "/rfq") {
      if (!this.takerOpen) {
        return sendJson(res, 403, { error: "rfq creation is disabled (TAKER_OPEN=false)" });
      }
      const ip = req.socket.remoteAddress ?? "unknown";
      if (!this.rfqLimiter.allow(ip)) {
        return sendJson(res, 429, { error: "rate limit exceeded — slow down" });
      }
      const body = (await readJsonBody(req)) as CreateRfqRequest;
      try {
        const rfq = await this.engine.openRfq(body);
        return sendJson(res, 201, { rfq: publicRfq(rfq) });
      } catch (err) {
        return sendJson(res, 400, { error: errMessage(err) });
      }
    }

    const statusMatch = path.match(/^\/rfq\/([0-9a-fA-F-]{8,64})$/);
    if (req.method === "GET" && statusMatch) {
      const rfq = await this.engine.getRfq(statusMatch[1] as string);
      if (!rfq) return sendJson(res, 404, { error: "rfq not found" });
      return sendJson(res, 200, await this.statusResponse(rfq));
    }

    const acceptMatch = path.match(/^\/rfq\/([0-9a-fA-F-]{8,64})\/accept$/);
    if (req.method === "POST" && acceptMatch) {
      const rfqId = acceptMatch[1] as string;
      const body = (await readJsonBody(req)) as AcceptRfqRequest;
      let action, signature;
      try {
        action = parseAction(body.action);
        signature = asHex(body.signature, "signature");
      } catch (err) {
        return sendJson(res, 400, { error: errMessage(err) });
      }
      try {
        const result = await this.engine.acceptRfq({ rfqId, action, signature });
        return sendJson(res, result.status === "success" ? 200 : 502, {
          txHash: result.txHash,
          status: result.status,
          blockNumber: result.blockNumber?.toString() ?? null,
          fill: {
            rfqId: result.fill.rfqId,
            quoteId: result.fill.quoteId,
            instrument: result.fill.instrument,
            maker: result.fill.maker,
            makerSubaccountId: result.fill.makerSubaccountId.toString(),
            takerSubaccountId: result.fill.takerSubaccountId.toString(),
            amount: result.fill.amount.toString(),
            premium: result.fill.premium.toString(),
            totalPremium: result.fill.totalPremium.toString(),
            makerFee: result.fill.makerFee.toString(),
            takerFee: result.fill.takerFee.toString(),
          },
        });
      } catch (err) {
        const status = err instanceof QuoteValidationError ? 409 : 502;
        return sendJson(res, status, { error: errMessage(err) });
      }
    }

    sendJson(res, 404, { error: `no route: ${req.method} ${path}` });
  }

  private async statusResponse(rfq: Rfq): Promise<RfqStatusResponse> {
    const best = await this.engine.getBestQuote(rfq);
    const quotes = await this.engine.listQuotes(rfq.id);
    return {
      rfq: publicRfq(rfq),
      quoteCount: quotes.length,
      bestQuote: best ? publicBestQuote(best) : null,
      execution: rfq.execution
        ? {
            txHash: rfq.execution.txHash,
            status: rfq.execution.status,
            blockNumber: rfq.execution.blockNumber?.toString() ?? null,
          }
        : null,
      error: rfq.error,
    };
  }

  // -------------------------------------------------------------------------
  // Maker WS channel
  // -------------------------------------------------------------------------

  private onMakerConnect(ws: WebSocket): void {
    const challenge = `hedge rfq-engine maker auth ${randomUUID()} ${Date.now()}`;
    const session: MakerSession = { socket: ws, challenge, address: null, isAlive: true };
    this.makers.set(ws, session);

    sendWs(ws, { type: "auth_challenge", challenge } satisfies MakerServerMessage);

    ws.on("pong", () => {
      session.isAlive = true;
    });
    ws.on("message", (raw) => {
      session.isAlive = true;
      this.onMakerMessage(session, raw.toString()).catch((err) => {
        sendWs(ws, { type: "error", message: errMessage(err) });
      });
    });
    ws.on("close", () => this.makers.delete(ws));
    ws.on("error", () => this.makers.delete(ws));
  }

  private async onMakerMessage(session: MakerSession, raw: string): Promise<void> {
    let msg: MakerClientMessage;
    try {
      msg = JSON.parse(raw) as MakerClientMessage;
    } catch {
      return sendWs(session.socket, { type: "error", message: "invalid JSON" });
    }

    if (msg.type === "auth") {
      const address = asAddress(msg.address, "auth.address");
      const signature = asHex(msg.signature, "auth.signature");
      const ok = await verifyMessage({
        address,
        message: session.challenge,
        signature,
      }).catch(() => false);
      if (!ok) {
        return sendWs(session.socket, { type: "error", message: "auth failed: bad signature" });
      }
      if (this.allowlist && !this.allowlist.has(address.toLowerCase())) {
        sendWs(session.socket, {
          type: "error",
          message: "auth failed: address not allowlisted",
        });
        session.socket.close(WS_CLOSE_NOT_ALLOWLISTED, "not allowlisted");
        return;
      }
      // one live connection per maker address: the newest wins
      for (const [otherWs, other] of this.makers) {
        if (other !== session && other.address && addressEq(other.address, address)) {
          sendWs(otherWs, {
            type: "superseded",
            message: "a newer connection authenticated for this maker address",
          } satisfies MakerServerMessage);
          this.makers.delete(otherWs);
          otherWs.close(WS_CLOSE_SUPERSEDED, "superseded");
        }
      }
      session.address = address;
      sendWs(session.socket, { type: "auth_ok", address } satisfies MakerServerMessage);
      // replay currently-open RFQs to the late joiner
      for (const rfq of await this.engine.listOpenRfqs()) {
        sendWs(session.socket, { type: "rfq_open", rfq: publicRfq(rfq) });
      }
      return;
    }

    if (msg.type === "quote") {
      if (!session.address) {
        return sendWs(session.socket, { type: "error", message: "authenticate first" });
      }
      const rfqId = String(msg.rfqId ?? "");
      try {
        const action = parseAction(msg.action);
        const signature = asHex(msg.signature, "quote.signature");
        const { quote, replacedQuoteId } = await this.engine.submitQuote({
          rfqId,
          maker: session.address,
          action,
          signature,
        });
        return sendWs(session.socket, {
          type: "quote_ack",
          rfqId,
          quoteId: quote.id,
          ...(replacedQuoteId ? { replacedQuoteId } : {}),
        } satisfies MakerServerMessage);
      } catch (err) {
        return sendWs(session.socket, {
          type: "quote_rejected",
          rfqId,
          reason: errMessage(err),
        });
      }
    }

    if (msg.type === "cancel") {
      if (!session.address) {
        return sendWs(session.socket, { type: "error", message: "authenticate first" });
      }
      const quoteId = String(msg.quoteId ?? "");
      try {
        const quote = await this.engine.cancelQuote({ quoteId, maker: session.address });
        return sendWs(session.socket, {
          type: "cancel_ack",
          rfqId: quote.rfqId,
          quoteId,
        } satisfies MakerServerMessage);
      } catch (err) {
        return sendWs(session.socket, {
          type: "cancel_rejected",
          quoteId,
          reason: errMessage(err),
        } satisfies MakerServerMessage);
      }
    }

    sendWs(session.socket, { type: "error", message: `unknown message type` });
  }

  private sendToMakerAddress(address: string, msg: MakerServerMessage): void {
    for (const session of this.makers.values()) {
      if (
        session.address &&
        addressEq(session.address, address) &&
        session.socket.readyState === WebSocket.OPEN
      ) {
        sendWs(session.socket, msg);
      }
    }
  }

  private async notifyWinningMaker(rfq: Rfq, msg: MakerServerMessage): Promise<void> {
    const best = await this.engine.getBestQuote(rfq).catch(() => null);
    if (best) this.sendToMakerAddress(best.maker, msg);
  }

  private broadcastToMakers(msg: MakerServerMessage): void {
    for (const session of this.makers.values()) {
      if (session.address && session.socket.readyState === WebSocket.OPEN) {
        sendWs(session.socket, msg);
      }
    }
  }

  private broadcastRfqOpen(rfq: Rfq): void {
    this.broadcastToMakers({ type: "rfq_open", rfq: publicRfq(rfq) });
  }

  private broadcastRfqClosed(rfq: Rfq, best: Quote | null): void {
    for (const session of this.makers.values()) {
      if (!session.address || session.socket.readyState !== WebSocket.OPEN) continue;
      const won = best !== null && addressEq(best.maker, session.address);
      const msg: MakerServerMessage = {
        type: "rfq_closed",
        rfqId: rfq.id,
        bestQuoteId: best?.id ?? null,
        ...(won ? { won: true } : {}),
        ...(won && rfq.acceptDeadlineAt !== null ? { acceptDeadlineAt: rfq.acceptDeadlineAt } : {}),
      };
      sendWs(session.socket, msg);
    }
  }

  // -------------------------------------------------------------------------
  // Taker WS channel
  // -------------------------------------------------------------------------

  private onTakerConnect(ws: WebSocket, ip: string): void {
    const session: TakerSession = { socket: ws, subscriptions: new Set(), ip, isAlive: true };
    this.takers.set(ws, session);
    ws.on("pong", () => {
      session.isAlive = true;
    });
    ws.on("message", (raw) => {
      session.isAlive = true;
      this.onTakerMessage(session, raw.toString()).catch((err) => {
        sendWs(ws, { type: "error", message: errMessage(err) } satisfies TakerServerMessage);
      });
    });
    ws.on("close", () => this.takers.delete(ws));
    ws.on("error", () => this.takers.delete(ws));
  }

  private async onTakerMessage(session: TakerSession, raw: string): Promise<void> {
    let msg: TakerClientMessage;
    try {
      msg = JSON.parse(raw) as TakerClientMessage;
    } catch {
      return sendWs(session.socket, { type: "error", message: "invalid JSON" });
    }

    if (msg.type === "create_rfq") {
      if (!this.takerOpen) {
        return sendWs(session.socket, {
          type: "error",
          message: "rfq creation is disabled (TAKER_OPEN=false)",
        });
      }
      if (!this.rfqLimiter.allow(session.ip)) {
        return sendWs(session.socket, {
          type: "error",
          message: "rate limit exceeded — slow down",
        });
      }
      try {
        const rfq = await this.engine.openRfq(msg.request);
        session.subscriptions.add(rfq.id);
        return sendWs(session.socket, {
          type: "rfq_created",
          rfq: publicRfq(rfq),
        } satisfies TakerServerMessage);
      } catch (err) {
        return sendWs(session.socket, { type: "error", message: errMessage(err) });
      }
    }

    if (msg.type === "subscribe") {
      const rfq = await this.engine.getRfq(String(msg.rfqId ?? ""));
      if (!rfq) return sendWs(session.socket, { type: "error", message: "rfq not found" });
      session.subscriptions.add(rfq.id);
      return sendWs(session.socket, {
        type: "rfq_update",
        update: await this.statusResponse(rfq),
      } satisfies TakerServerMessage);
    }

    sendWs(session.socket, { type: "error", message: "unknown message type" });
  }

  private async pushTakerUpdate(rfq: Rfq): Promise<void> {
    const interested = [...this.takers.values()].filter(
      (s) => s.subscriptions.has(rfq.id) && s.socket.readyState === WebSocket.OPEN,
    );
    if (interested.length === 0) return;
    const update = await this.statusResponse(rfq);
    for (const session of interested) {
      sendWs(session.socket, { type: "rfq_update", update } satisfies TakerServerMessage);
    }
  }
}

// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  "access-control-max-age": "86400",
} as const;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    ...CORS_HEADERS,
  });
  res.end(payload);
}

function sendWs(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("invalid JSON body");
  }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
