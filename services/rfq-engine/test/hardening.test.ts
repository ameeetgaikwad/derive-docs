import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  buildAction,
  encodeOptionSubId,
  encodeRfqOrder,
  signAction,
  toUnit,
  type Action,
} from "@hedge/shared";
import { AuctionEngine } from "../src/auction.js";
import type { ChainReader, SubmitResult, TxSubmitter } from "../src/chain.js";
import { Executor } from "../src/executor.js";
import { QuoteValidationError } from "../src/quotes.js";
import { RfqEngineServer, WS_CLOSE_NOT_ALLOWLISTED, WS_CLOSE_SUPERSEDED } from "../src/server.js";
import { InMemoryRfqStore, JsonlRfqStore } from "../src/store.js";
import { serializeAction } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures (mirroring test/auction.test.ts)
// ---------------------------------------------------------------------------

const CHAIN_ID = 31337;
const MATCHING = "0x2E2Ed0Cfd3AD2f1d34481277b3204d807Ca2F8c2" as Address;
const RFQ_MODULE = "0x8198f5d8F8CfFE8f9C413d98a0A55aEB8ab9FbB7" as Address;
const OPTION_ASSET = "0x1291Be112d480055DaFd8a610b7d1e203891C274" as Address;
const FORWARD_FEED = "0x9E545E3C0baAB3E08CdfD552C960A1050f373042" as Address;

const maker1 = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // anvil #1
);
const maker2 = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // anvil #2
);

const MAKER1_SUBACC = 11n;
const MAKER2_SUBACC = 22n;
const TAKER_SUBACC = 33n;

const EXPIRY = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
const STRIKE = toUnit("110000");
const SUB_ID = encodeOptionSubId({ expiry: EXPIRY, strike: STRIKE, isCall: true });
const AMOUNT = toUnit("1");
const FAKE_TX = ("0x" + "ab".repeat(32)) as Hex;

class FakeChainReader implements ChainReader {
  owners = new Map<bigint, Address>();
  balances = new Map<bigint, bigint>();
  oiFeeRates = new Map<string, bigint>();
  forwardPrices = new Map<string, bigint>();
  minOIFee = 0n;
  async getMatchingSubaccountOwner(id: bigint): Promise<Address> {
    return this.owners.get(id) ?? zeroAddress;
  }
  async getCashBalance(id: bigint): Promise<bigint> {
    return this.balances.get(id) ?? 0n;
  }
  async isTradeExecutor(): Promise<boolean> {
    return true;
  }
  async getOIFeeRateBPS(asset: Address): Promise<bigint> {
    return this.oiFeeRates.get(asset.toLowerCase()) ?? 0n;
  }
  async getForwardPrice(feed: Address): Promise<bigint> {
    const price = this.forwardPrices.get(feed.toLowerCase());
    if (price === undefined) throw new Error(`no forward price for feed ${feed}`);
    return price;
  }
  async getMinOIFee(): Promise<bigint> {
    return this.minOIFee;
  }
}

class FakeSubmitter implements TxSubmitter {
  executorAddress = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
  calls: { actions: Action[]; signatures: Hex[]; actionData: Hex }[] = [];
  async submitVerifyAndMatch(
    actions: Action[],
    signatures: Hex[],
    actionData: Hex,
  ): Promise<SubmitResult> {
    this.calls.push({ actions, signatures, actionData });
    return { txHash: FAKE_TX, status: "success", blockNumber: 1n };
  }
}

/** Queued-message WS test client; records the close code. */
class WsClient {
  private queue: Record<string, unknown>[] = [];
  private waiters: { resolve: (m: Record<string, unknown>) => void; type?: string }[] = [];
  closeCode: number | null = null;
  readonly closed: Promise<number>;

  private constructor(readonly ws: WebSocket) {
    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      const idx = this.waiters.findIndex((w) => !w.type || w.type === msg.type);
      if (idx >= 0) {
        const [waiter] = this.waiters.splice(idx, 1);
        waiter!.resolve(msg);
      } else {
        this.queue.push(msg);
      }
    });
    this.closed = new Promise<number>((resolve) => {
      ws.on("close", (code) => {
        this.closeCode = code;
        resolve(code);
      });
    });
  }

  static async connect(url: string, wsOpts?: Record<string, unknown>): Promise<WsClient> {
    const ws = new WebSocket(url, wsOpts);
    const client = new WsClient(ws);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    return client;
  }

  send(msg: unknown): void {
    this.ws.send(JSON.stringify(msg));
  }

  async next(type?: string): Promise<Record<string, unknown>> {
    const idx = this.queue.findIndex((m) => !type || m.type === type);
    if (idx >= 0) return this.queue.splice(idx, 1)[0]!;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timed out waiting for ws message${type ? ` "${type}"` : ""}`)),
        5000,
      );
      this.waiters.push({
        type,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m);
        },
      });
    });
  }

  close(): void {
    this.ws.terminate();
  }
}

async function authMaker(client: WsClient, account: typeof maker1): Promise<void> {
  const challenge = await client.next("auth_challenge");
  const signature = await account.signMessage({ message: challenge.challenge as string });
  client.send({ type: "auth", address: account.address, signature });
}

async function connectAuthedMaker(port: number, account: typeof maker1): Promise<WsClient> {
  const client = await WsClient.connect(`ws://127.0.0.1:${port}/maker`);
  await authMaker(client, account);
  const ok = await client.next("auth_ok");
  expect(ok.address).toBe(account.address);
  return client;
}

async function signedMakerQuote(params: {
  account: typeof maker1;
  subaccountId: bigint;
  premium: bigint;
  maxFee?: bigint;
  subId?: bigint;
}): Promise<{ action: Action; signature: Hex }> {
  const action = buildAction({
    subaccountId: params.subaccountId,
    module: RFQ_MODULE,
    data: encodeRfqOrder({
      maxFee: params.maxFee ?? 0n,
      trades: [
        {
          asset: OPTION_ASSET,
          subId: params.subId ?? SUB_ID,
          price: params.premium,
          amount: AMOUNT,
        },
      ],
    }),
    owner: params.account.address,
  });
  const signature = await signAction({
    action,
    signer: params.account,
    chainId: CHAIN_ID,
    matchingAddress: MATCHING,
  });
  return { action, signature };
}

interface Harness {
  engine: AuctionEngine;
  server: RfqEngineServer;
  reader: FakeChainReader;
  submitter: FakeSubmitter;
  port: number;
  base: string;
}

function makeReader(): FakeChainReader {
  const reader = new FakeChainReader();
  reader.owners.set(MAKER1_SUBACC, maker1.address);
  reader.owners.set(MAKER2_SUBACC, maker2.address);
  reader.balances.set(MAKER1_SUBACC, toUnit("1000000"));
  reader.balances.set(MAKER2_SUBACC, toUnit("1000000"));
  return reader;
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0)) await fn();
});

async function makeHarness(opts?: {
  auctionWindowMs?: number;
  acceptDeadlineMs?: number;
  makerAllowlist?: string[];
  heartbeatMs?: number;
  forwardFeeds?: Record<string, Address>;
  store?: InMemoryRfqStore;
  reader?: FakeChainReader;
}): Promise<Harness> {
  const reader = opts?.reader ?? makeReader();
  const submitter = new FakeSubmitter();
  const engine = new AuctionEngine({
    store: opts?.store ?? new InMemoryRfqStore(),
    chainReader: reader,
    executor: new Executor(submitter),
    chainId: CHAIN_ID,
    matching: MATCHING,
    rfqModule: RFQ_MODULE,
    optionAssets: { BTC: OPTION_ASSET },
    forwardFeeds: opts?.forwardFeeds,
    auctionWindowMs: opts?.auctionWindowMs ?? 500,
    acceptDeadlineMs: opts?.acceptDeadlineMs ?? 60_000,
  });
  const server = new RfqEngineServer({
    engine,
    port: 0,
    makerAllowlist: opts?.makerAllowlist,
    heartbeatMs: opts?.heartbeatMs ?? 0,
  });
  const { port } = await server.start();
  cleanups.push(() => server.stop());
  return { engine, server, reader, submitter, port, base: `http://127.0.0.1:${port}` };
}

async function openRfqViaRest(base: string): Promise<{ id: string }> {
  const res = await fetch(`${base}/rfq`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subaccountId: TAKER_SUBACC.toString(),
      instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
      amount: "1",
      direction: "sell",
    }),
  });
  expect(res.status).toBe(201);
  const { rfq } = (await res.json()) as { rfq: { id: string } };
  return rfq;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------

describe("maker allowlist", () => {
  it("admits allowlisted makers and rejects others with close code 4003", async () => {
    const h = await makeHarness({ makerAllowlist: [maker1.address] });

    // allowlisted maker authenticates fine
    const ok = await connectAuthedMaker(h.port, maker1);
    cleanups.push(() => ok.close());

    // non-allowlisted maker: valid signature, still refused
    const bad = await WsClient.connect(`ws://127.0.0.1:${h.port}/maker`);
    await authMaker(bad, maker2);
    const err = await bad.next("error");
    expect(String(err.message)).toContain("not allowlisted");
    expect(await bad.closed).toBe(WS_CLOSE_NOT_ALLOWLISTED);
  });

  it("allowlist matching is case-insensitive", async () => {
    const h = await makeHarness({ makerAllowlist: [maker1.address.toUpperCase().replace("0X", "0x")] });
    const ok = await connectAuthedMaker(h.port, maker1);
    cleanups.push(() => ok.close());
  });
});

describe("quote cancel / replace", () => {
  it("replaces a maker's earlier quote on the same RFQ and supports cancel", async () => {
    const h = await makeHarness({ auctionWindowMs: 1500 });
    const ws = await connectAuthedMaker(h.port, maker1);
    cleanups.push(() => ws.close());

    const rfq = await openRfqViaRest(h.base);
    await ws.next("rfq_open");

    const q1 = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1200"),
    });
    ws.send({ type: "quote", rfqId: rfq.id, action: serializeAction(q1.action), signature: q1.signature });
    const ack1 = await ws.next("quote_ack");
    expect(ack1.replacedQuoteId).toBeUndefined();

    // same maker + same rfq -> replace, only the latest survives
    const q2 = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1300"),
    });
    ws.send({ type: "quote", rfqId: rfq.id, action: serializeAction(q2.action), signature: q2.signature });
    const ack2 = await ws.next("quote_ack");
    expect(ack2.replacedQuoteId).toBe(ack1.quoteId);

    const status = (await (await fetch(`${h.base}/rfq/${rfq.id}`)).json()) as any;
    expect(status.quoteCount).toBe(1);

    // cancel the live quote
    ws.send({ type: "cancel", quoteId: ack2.quoteId });
    const cancelAck = await ws.next("cancel_ack");
    expect(cancelAck.quoteId).toBe(ack2.quoteId);
    expect(cancelAck.rfqId).toBe(rfq.id);

    // double-cancel and foreign/unknown ids are rejected
    ws.send({ type: "cancel", quoteId: ack2.quoteId });
    const rej = await ws.next("cancel_rejected");
    expect(String(rej.reason)).toContain("unknown quote");

    // with the only quote cancelled the auction expires
    await ws.next("rfq_closed");
    const finalStatus = (await (await fetch(`${h.base}/rfq/${rfq.id}`)).json()) as any;
    expect(finalStatus.rfq.status).toBe("expired");
    expect(finalStatus.quoteCount).toBe(0);
  });

  it("a maker cannot cancel someone else's quote", async () => {
    const h = await makeHarness({ auctionWindowMs: 1500 });
    const ws1 = await connectAuthedMaker(h.port, maker1);
    const ws2 = await connectAuthedMaker(h.port, maker2);
    cleanups.push(() => ws1.close(), () => ws2.close());

    const rfq = await openRfqViaRest(h.base);
    await ws1.next("rfq_open");
    await ws2.next("rfq_open");

    const q1 = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1200"),
    });
    ws1.send({ type: "quote", rfqId: rfq.id, action: serializeAction(q1.action), signature: q1.signature });
    const ack = await ws1.next("quote_ack");

    ws2.send({ type: "cancel", quoteId: ack.quoteId });
    const rej = await ws2.next("cancel_rejected");
    expect(String(rej.reason)).toContain("unknown quote");
  });
});

describe("connection dedupe (superseded)", () => {
  it("closes the older connection when the same maker authenticates again", async () => {
    const h = await makeHarness();
    const first = await connectAuthedMaker(h.port, maker1);
    const second = await connectAuthedMaker(h.port, maker1);
    cleanups.push(() => first.close(), () => second.close());

    const superseded = await first.next("superseded");
    expect(String(superseded.message)).toContain("newer connection");
    expect(await first.closed).toBe(WS_CLOSE_SUPERSEDED);

    // the new connection still receives broadcasts
    await openRfqViaRest(h.base);
    await second.next("rfq_open");
  });
});

describe("taker-accept deadline", () => {
  it("expires a won-but-unaccepted RFQ, notifies the winner and releases collateral", async () => {
    const h = await makeHarness({ auctionWindowMs: 300, acceptDeadlineMs: 300 });
    const ws = await connectAuthedMaker(h.port, maker1);
    cleanups.push(() => ws.close());

    const rfq = await openRfqViaRest(h.base);
    await ws.next("rfq_open");
    const q = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1500"),
    });
    ws.send({ type: "quote", rfqId: rfq.id, action: serializeAction(q.action), signature: q.signature });
    await ws.next("quote_ack");
    expect(h.engine.reservedFor(MAKER1_SUBACC)).toBe(toUnit("1500"));

    const closed = await ws.next("rfq_closed");
    expect(closed.won).toBe(true);
    expect(typeof closed.acceptDeadlineAt).toBe("number");

    // taker never accepts -> deadline passes
    const expired = await ws.next("rfq_expired");
    expect(expired.rfqId).toBe(rfq.id);
    expect(String(expired.reason)).toContain("deadline");
    expect(h.engine.reservedFor(MAKER1_SUBACC)).toBe(0n);

    const status = (await (await fetch(`${h.base}/rfq/${rfq.id}`)).json()) as any;
    expect(status.rfq.status).toBe("expired");
    expect(String(status.error)).toContain("deadline");

    // a late accept is refused
    const acceptRes = await fetch(`${h.base}/rfq/${rfq.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: serializeAction(q.action), signature: q.signature }),
    });
    expect(acceptRes.status).toBe(409);
  });
});

describe("ws heartbeat", () => {
  it("terminates connections that stop answering pings, keeps live ones", async () => {
    const h = await makeHarness({ heartbeatMs: 120 });

    // autoPong: false simulates a dead/zombied peer (no pong responses)
    const dead = await WsClient.connect(`ws://127.0.0.1:${h.port}/maker`, { autoPong: false });
    const live = await connectAuthedMaker(h.port, maker1);
    cleanups.push(() => dead.close(), () => live.close());

    const code = await Promise.race([
      dead.closed,
      sleep(2000).then(() => -1),
    ]);
    expect(code).toBe(1006); // terminated without a close frame

    // the responsive connection survives several heartbeat rounds
    await sleep(400);
    expect(live.ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe("fee-aware collateral pre-check", () => {
  it("includes the live SRM OI fee (incl. minOIFee floor) in the maker cash requirement", async () => {
    const reader = makeReader();
    // OIFeeRateBPS = 0.001e18, forward = 100k -> oiFee = 1 * 100000 * 0.001 = 100
    reader.oiFeeRates.set(OPTION_ASSET.toLowerCase(), toUnit("0.001"));
    reader.forwardPrices.set(FORWARD_FEED.toLowerCase(), toUnit("100000"));
    const h = await makeHarness({
      reader,
      auctionWindowMs: 60_000,
      forwardFeeds: { BTC: FORWARD_FEED },
    });

    const rfq = await h.engine.openRfq({
      subaccountId: TAKER_SUBACC.toString(),
      instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
      amount: "1",
      direction: "sell",
    });

    const q = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1500"),
    });

    // premium 1500 + maxFee 0 + oiFee 100 = 1600 required
    reader.balances.set(MAKER1_SUBACC, toUnit("1599"));
    await expect(
      h.engine.submitQuote({ rfqId: rfq.id, maker: maker1.address, ...q }),
    ).rejects.toThrowError(/insufficient maker cash.*OI fee 100000000000000000000/s);

    reader.balances.set(MAKER1_SUBACC, toUnit("1600"));
    const { quote } = await h.engine.submitQuote({
      rfqId: rfq.id,
      maker: maker1.address,
      ...q,
    });
    expect(quote.reservedCash).toBe(toUnit("1600"));

    // minOIFee floor: with a dust rate the fee is bumped to the floor
    reader.oiFeeRates.set(OPTION_ASSET.toLowerCase(), 1n); // 1e-18
    reader.minOIFee = toUnit("5");
    reader.balances.set(MAKER2_SUBACC, toUnit("1504"));
    const q2 = await signedMakerQuote({
      account: maker2,
      subaccountId: MAKER2_SUBACC,
      premium: toUnit("1500"),
    });
    await expect(
      h.engine.submitQuote({ rfqId: rfq.id, maker: maker2.address, ...q2 }),
    ).rejects.toThrow(QuoteValidationError);
    reader.balances.set(MAKER2_SUBACC, toUnit("1505"));
    const { quote: quote2 } = await h.engine.submitQuote({
      rfqId: rfq.id,
      maker: maker2.address,
      ...q2,
    });
    expect(quote2.reservedCash).toBe(toUnit("1505"));
  });

  it("rejects the quote when the OI fee cannot be estimated (stale feed)", async () => {
    const reader = makeReader();
    reader.oiFeeRates.set(OPTION_ASSET.toLowerCase(), toUnit("0.001"));
    // no forward price registered -> feed read throws
    const h = await makeHarness({
      reader,
      auctionWindowMs: 60_000,
      forwardFeeds: { BTC: FORWARD_FEED },
    });
    const rfq = await h.engine.openRfq({
      subaccountId: TAKER_SUBACC.toString(),
      instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
      amount: "1",
      direction: "sell",
    });
    const q = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1500"),
    });
    await expect(
      h.engine.submitQuote({ rfqId: rfq.id, maker: maker1.address, ...q }),
    ).rejects.toThrowError(/cannot estimate SRM OI fee/);
  });

  it("reserves collateral across concurrent open quotes per maker", async () => {
    const reader = makeReader();
    reader.balances.set(MAKER1_SUBACC, toUnit("2999")); // enough for one 1500 quote, not two
    const h = await makeHarness({ reader, auctionWindowMs: 60_000 });

    const open = (n: number) =>
      h.engine.openRfq({
        subaccountId: (TAKER_SUBACC + BigInt(n)).toString(),
        instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
        amount: "1",
        direction: "sell",
      });
    const rfqA = await open(0);
    const rfqB = await open(1);

    const qA = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1500"),
    });
    await h.engine.submitQuote({ rfqId: rfqA.id, maker: maker1.address, ...qA });
    expect(h.engine.reservedFor(MAKER1_SUBACC)).toBe(toUnit("1500"));

    const qB = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1500"),
    });
    await expect(
      h.engine.submitQuote({ rfqId: rfqB.id, maker: maker1.address, ...qB }),
    ).rejects.toThrowError(/reserved 1500000000000000000000/);

    // replacing the quote on the SAME rfq does not double-count the reservation
    const qA2 = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1600"),
    });
    const { quote, replacedQuoteId } = await h.engine.submitQuote({
      rfqId: rfqA.id,
      maker: maker1.address,
      ...qA2,
    });
    expect(replacedQuoteId).not.toBeNull();
    expect(h.engine.reservedFor(MAKER1_SUBACC)).toBe(toUnit("1600"));

    // cancelling releases the reservation, freeing the other quote
    await h.engine.cancelQuote({ quoteId: quote.id, maker: maker1.address });
    expect(h.engine.reservedFor(MAKER1_SUBACC)).toBe(0n);
    await h.engine.submitQuote({ rfqId: rfqB.id, maker: maker1.address, ...qB });
    expect(h.engine.reservedFor(MAKER1_SUBACC)).toBe(toUnit("1500"));
  });
});

describe("persistent store + restart recovery", () => {
  const tmp = () => join(mkdtempSync(join(tmpdir(), "rfq-store-")), "rfq.jsonl");

  function makeEngine(storePath: string, reader: FakeChainReader): AuctionEngine {
    const engine = new AuctionEngine({
      store: new JsonlRfqStore(storePath),
      chainReader: reader,
      executor: new Executor(new FakeSubmitter()),
      chainId: CHAIN_ID,
      matching: MATCHING,
      rfqModule: RFQ_MODULE,
      optionAssets: { BTC: OPTION_ASSET },
      auctionWindowMs: 60_000,
      acceptDeadlineMs: 60_000,
    });
    cleanups.push(() => engine.stop());
    return engine;
  }

  it("recovers a still-open auction with quotes and rebuilt reservations", async () => {
    const path = tmp();
    const reader = makeReader();

    const engine1 = makeEngine(path, reader);
    const rfq = await engine1.openRfq({
      subaccountId: TAKER_SUBACC.toString(),
      instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
      amount: "1",
      direction: "sell",
    });
    const q = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1500"),
    });
    await engine1.submitQuote({ rfqId: rfq.id, maker: maker1.address, ...q });
    engine1.stop(); // simulated crash/restart — JSONL already has everything

    const engine2 = makeEngine(path, reader);
    const summary = await engine2.recover();
    expect(summary.rearmed).toBe(1);

    const recovered = await engine2.getRfq(rfq.id);
    expect(recovered?.status).toBe("open");
    const quotes = await engine2.listQuotes(rfq.id);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.premium).toBe(toUnit("1500"));
    // reservations are rebuilt so the pre-check still holds across restarts
    expect(engine2.reservedFor(MAKER1_SUBACC)).toBe(toUnit("1500"));
  });

  it("closes auctions whose window elapsed while down, expires stale accepts, fails in-flight executions", async () => {
    const path = tmp();
    const reader = makeReader();

    // Drive engine1 with a clock in the past so that, on restart with the
    // real clock, the auction window has already elapsed "while down".
    const nowMs = Date.now() - 7_200_000;
    const engine1 = new AuctionEngine({
      store: new JsonlRfqStore(path),
      chainReader: reader,
      executor: new Executor(new FakeSubmitter()),
      chainId: CHAIN_ID,
      matching: MATCHING,
      rfqModule: RFQ_MODULE,
      optionAssets: { BTC: OPTION_ASSET },
      auctionWindowMs: 3_600_000, // timer far in the future; never fires in-test
      acceptDeadlineMs: 60_000,
      now: () => nowMs,
    });
    cleanups.push(() => engine1.stop());

    const rfqOpen = await engine1.openRfq({
      subaccountId: TAKER_SUBACC.toString(),
      instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
      amount: "1",
      direction: "sell",
    });
    const q = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1500"),
    });
    await engine1.submitQuote({ rfqId: rfqOpen.id, maker: maker1.address, ...q });

    // a second RFQ stuck in "executing" when the process died
    const rfqExecuting = await engine1.openRfq({
      subaccountId: TAKER_SUBACC.toString(),
      instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
      amount: "1",
      direction: "sell",
    });
    const store1 = new JsonlRfqStore(path); // poke the raw store to fake the state
    const stuck = (await store1.getRfq(rfqExecuting.id))!;
    stuck.status = "executing";
    await store1.putRfq(stuck);
    engine1.stop();

    // restart far past the auction window
    const engine2 = makeEngine(path, reader);
    const summary = await engine2.recover();
    expect(summary.closed).toBe(1);
    expect(summary.failed).toBe(1);

    const closed = await engine2.getRfq(rfqOpen.id);
    expect(closed?.status).toBe("closed"); // best quote selected post-restart
    expect(closed?.bestQuoteId).not.toBeNull();
    expect(closed?.acceptDeadlineAt).not.toBeNull();
    expect(engine2.reservedFor(MAKER1_SUBACC)).toBe(toUnit("1500"));

    const failed = await engine2.getRfq(rfqExecuting.id);
    expect(failed?.status).toBe("failed");
    expect(String(failed?.error)).toContain("restarted during execution");

    // a third boot sees the durable post-recovery state (trade history intact)
    engine2.stop();
    const engine3 = makeEngine(path, reader);
    expect((await engine3.getRfq(rfqOpen.id))?.status).toBe("closed");
    expect((await engine3.getRfq(rfqExecuting.id))?.status).toBe("failed");
    expect(await engine3.listQuotes(rfqOpen.id)).toHaveLength(1);
  });
});

describe("taker gating", () => {
  it("rate-limits POST /rfq per IP and honors TAKER_OPEN=false", async () => {
    // tiny limit for the test
    const reader = makeReader();
    const submitter = new FakeSubmitter();
    const engine = new AuctionEngine({
      store: new InMemoryRfqStore(),
      chainReader: reader,
      executor: new Executor(submitter),
      chainId: CHAIN_ID,
      matching: MATCHING,
      rfqModule: RFQ_MODULE,
      optionAssets: { BTC: OPTION_ASSET },
      auctionWindowMs: 60_000,
    });
    const server = new RfqEngineServer({
      engine,
      port: 0,
      heartbeatMs: 0,
      rfqRateLimitPerMin: 2,
    });
    const { port } = await server.start();
    cleanups.push(() => server.stop());
    const base = `http://127.0.0.1:${port}`;

    await openRfqViaRest(base);
    await openRfqViaRest(base);
    const third = await fetch(`${base}/rfq`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subaccountId: TAKER_SUBACC.toString(),
        instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
        amount: "1",
        direction: "sell",
      }),
    });
    expect(third.status).toBe(429);

    // TAKER_OPEN=false -> 403 on every create
    const closedServer = new RfqEngineServer({ engine, port: 0, heartbeatMs: 0, takerOpen: false });
    const { port: closedPort } = await closedServer.start();
    cleanups.push(() => closedServer.stop());
    const res = await fetch(`http://127.0.0.1:${closedPort}/rfq`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(403);
  });

  it("rate-limits forwarded client IPs independently only when proxy trust is enabled", async () => {
    const engine = new AuctionEngine({
      store: new InMemoryRfqStore(),
      chainReader: makeReader(),
      executor: new Executor(new FakeSubmitter()),
      chainId: CHAIN_ID,
      matching: MATCHING,
      rfqModule: RFQ_MODULE,
      optionAssets: { BTC: OPTION_ASSET },
      auctionWindowMs: 60_000,
    });
    const server = new RfqEngineServer({
      engine,
      port: 0,
      heartbeatMs: 0,
      rfqRateLimitPerMin: 1,
      trustProxy: true,
    });
    const { port } = await server.start();
    cleanups.push(() => server.stop());
    const url = `http://127.0.0.1:${port}/rfq`;
    const body = JSON.stringify({
      subaccountId: TAKER_SUBACC.toString(),
      instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
      amount: "1",
      direction: "sell",
    });
    const create = (forwardedFor: string) => fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": forwardedFor },
      body,
    });

    expect((await create("198.51.100.10")).status).toBe(201);
    expect((await create("198.51.100.11")).status).toBe(201);
    expect((await create("198.51.100.10, 10.0.0.1")).status).toBe(429);
  });
});
