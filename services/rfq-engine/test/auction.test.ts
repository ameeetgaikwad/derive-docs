import { zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  buildAction,
  encodeOptionSubId,
  encodeRfqOrder,
  encodeTakerOrder,
  signAction,
  toUnit,
  type Action,
} from "@hedge/shared";
import { AuctionEngine } from "../src/auction.js";
import type { ChainReader, SubmitResult, TxSubmitter } from "../src/chain.js";
import { Executor } from "../src/executor.js";
import { RfqEngineServer } from "../src/server.js";
import { InMemoryRfqStore } from "../src/store.js";
import { serializeAction } from "../src/types.js";

// ---------------------------------------------------------------------------
// Fixtures — addresses from protocol/deployments/31337.json, anvil test keys
// ---------------------------------------------------------------------------

const CHAIN_ID = 31337;
const MATCHING = "0x2E2Ed0Cfd3AD2f1d34481277b3204d807Ca2F8c2" as Address;
const RFQ_MODULE = "0x8198f5d8F8CfFE8f9C413d98a0A55aEB8ab9FbB7" as Address;
const OPTION_ASSET = "0x1291Be112d480055DaFd8a610b7d1e203891C274" as Address;

const maker1 = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", // anvil #1
);
const maker2 = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // anvil #2
);
const taker = privateKeyToAccount(
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // anvil #3
);

const MAKER1_SUBACC = 11n;
const MAKER2_SUBACC = 22n;
const TAKER_SUBACC = 33n;

const EXPIRY = BigInt(Math.floor(Date.now() / 1000) + 7 * 86400);
const STRIKE = toUnit("110000");
const SUB_ID = encodeOptionSubId({ expiry: EXPIRY, strike: STRIKE, isCall: true });
const AMOUNT = toUnit("1");

const AUCTION_WINDOW_MS = 500;
const FAKE_TX = ("0x" + "ab".repeat(32)) as Hex;

class FakeChainReader implements ChainReader {
  owners = new Map<bigint, Address>();
  balances = new Map<bigint, bigint>();
  /** 18dp OI fee rate per option asset (BasePortfolioViewer.OIFeeRateBPS) */
  oiFeeRates = new Map<string, bigint>();
  /** 18dp forward price per feed address */
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

/** Tiny WS client that queues every JSON message for awaited consumption. */
class WsClient {
  private queue: Record<string, unknown>[] = [];
  private waiters: { resolve: (m: Record<string, unknown>) => void; type?: string }[] = [];

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
  }

  static async connect(url: string): Promise<WsClient> {
    const ws = new WebSocket(url);
    // attach the message listener BEFORE awaiting open: the server pushes
    // auth_challenge immediately and the frame can arrive in the same tick
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

  /** Next message (optionally of a given type), FIFO, 5s timeout. */
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

async function connectAuthedMaker(
  port: number,
  account: typeof maker1,
): Promise<WsClient> {
  const client = await WsClient.connect(`ws://127.0.0.1:${port}/maker`);
  const challenge = await client.next("auth_challenge");
  const signature = await account.signMessage({ message: challenge.challenge as string });
  client.send({ type: "auth", address: account.address, signature });
  const ok = await client.next("auth_ok");
  expect(ok.address).toBe(account.address);
  return client;
}

async function signedMakerQuote(params: {
  account: typeof maker1;
  subaccountId: bigint;
  premium: bigint;
  subId?: bigint;
}): Promise<{ action: Action; signature: Hex }> {
  const action = buildAction({
    subaccountId: params.subaccountId,
    module: RFQ_MODULE,
    data: encodeRfqOrder({
      maxFee: 0n,
      trades: [
        {
          asset: OPTION_ASSET,
          subId: params.subId ?? SUB_ID,
          price: params.premium,
          amount: AMOUNT, // maker receives the option the taker sells
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

// ---------------------------------------------------------------------------

describe("rfq auction over WS + REST", () => {
  let server: RfqEngineServer;
  let submitter: FakeSubmitter;
  let reader: FakeChainReader;
  let port: number;
  let base: string;
  const clients: WsClient[] = [];

  beforeEach(async () => {
    reader = new FakeChainReader();
    reader.owners.set(MAKER1_SUBACC, maker1.address);
    reader.owners.set(MAKER2_SUBACC, maker2.address);
    reader.owners.set(TAKER_SUBACC, taker.address);
    reader.balances.set(MAKER1_SUBACC, toUnit("1000000"));
    reader.balances.set(MAKER2_SUBACC, toUnit("1000000"));

    submitter = new FakeSubmitter();
    const engine = new AuctionEngine({
      store: new InMemoryRfqStore(),
      chainReader: reader,
      executor: new Executor(submitter),
      chainId: CHAIN_ID,
      matching: MATCHING,
      rfqModule: RFQ_MODULE,
      optionAssets: { BTC: OPTION_ASSET },
      auctionWindowMs: AUCTION_WINDOW_MS,
    });
    server = new RfqEngineServer({ engine, port: 0 });
    ({ port } = await server.start());
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    for (const c of clients.splice(0)) c.close();
    await server.stop();
  });

  it("runs a full auction: broadcast, competing quotes, best-quote selection, accept + execution", async () => {
    const ws1 = await connectAuthedMaker(port, maker1);
    const ws2 = await connectAuthedMaker(port, maker2);
    clients.push(ws1, ws2);

    // Taker opens an RFQ over REST
    const createRes = await fetch(`${base}/rfq`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subaccountId: TAKER_SUBACC.toString(),
        instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
        amount: "1",
        direction: "sell",
      }),
    });
    expect(createRes.status).toBe(201);
    const { rfq } = (await createRes.json()) as { rfq: { id: string; instrument: any } };
    expect(rfq.instrument.subId).toBe(SUB_ID.toString());

    // Both makers receive the broadcast
    const bc1 = await ws1.next("rfq_open");
    const bc2 = await ws2.next("rfq_open");
    expect((bc1.rfq as any).id).toBe(rfq.id);
    expect((bc2.rfq as any).amount).toBe(AMOUNT.toString());

    // maker1 quotes 1200, maker2 quotes 1500 (better for the selling taker)
    const q1 = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1200"),
    });
    const q2 = await signedMakerQuote({
      account: maker2,
      subaccountId: MAKER2_SUBACC,
      premium: toUnit("1500"),
    });
    ws1.send({
      type: "quote",
      rfqId: rfq.id,
      action: serializeAction(q1.action),
      signature: q1.signature,
    });
    ws2.send({
      type: "quote",
      rfqId: rfq.id,
      action: serializeAction(q2.action),
      signature: q2.signature,
    });
    await ws1.next("quote_ack");
    await ws2.next("quote_ack");

    // Auction closes; maker2 wins
    const closed1 = await ws1.next("rfq_closed");
    const closed2 = await ws2.next("rfq_closed");
    expect(closed1.won).toBeUndefined();
    expect(closed2.won).toBe(true);

    // Best quote via REST
    const statusRes = await fetch(`${base}/rfq/${rfq.id}`);
    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as any;
    expect(status.rfq.status).toBe("closed");
    expect(status.quoteCount).toBe(2);
    expect(status.bestQuote.maker).toBe(maker2.address);
    expect(status.bestQuote.premium).toBe(toUnit("1500").toString());
    expect(status.bestQuote.totalPremium).toBe(toUnit("1500").toString());
    expect(status.bestQuote.trades).toHaveLength(1);
    expect(status.bestQuote.trades[0].subId).toBe(SUB_ID.toString());

    // Taker signs the TakerOrder over the winning orderHash and accepts
    const takerAction = buildAction({
      subaccountId: TAKER_SUBACC,
      module: RFQ_MODULE,
      data: encodeTakerOrder({ orderHash: status.bestQuote.orderHash, maxFee: 0n }),
      owner: taker.address,
    });
    const takerSig = await signAction({
      action: takerAction,
      signer: taker,
      chainId: CHAIN_ID,
      matchingAddress: MATCHING,
    });
    const acceptRes = await fetch(`${base}/rfq/${rfq.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: serializeAction(takerAction), signature: takerSig }),
    });
    expect(acceptRes.status).toBe(200);
    const accept = (await acceptRes.json()) as any;
    expect(accept.txHash).toBe(FAKE_TX);
    expect(accept.status).toBe("success");
    expect(accept.fill.maker).toBe(maker2.address);
    expect(accept.fill.totalPremium).toBe(toUnit("1500").toString());

    // The executor submitted [makerAction, takerAction] with the maker's signature first
    expect(submitter.calls).toHaveLength(1);
    const call = submitter.calls[0]!;
    expect(call.actions).toHaveLength(2);
    expect(call.actions[0]).toEqual(q2.action);
    expect(call.actions[1]).toEqual(takerAction);
    expect(call.signatures).toEqual([q2.signature, takerSig]);

    // Final state
    const finalRes = (await (await fetch(`${base}/rfq/${rfq.id}`)).json()) as any;
    expect(finalRes.rfq.status).toBe("executed");
    expect(finalRes.execution.txHash).toBe(FAKE_TX);

    // Winning maker is notified of execution
    const executed = await ws2.next("rfq_executed");
    expect(executed.txHash).toBe(FAKE_TX);
  });

  it("rejects malformed and undercollateralized quotes, expires quoteless auctions", async () => {
    const ws1 = await connectAuthedMaker(port, maker1);
    clients.push(ws1);

    const createRes = await fetch(`${base}/rfq`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subaccountId: TAKER_SUBACC.toString(),
        instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
        amount: "1",
        direction: "sell",
      }),
    });
    const { rfq } = (await createRes.json()) as { rfq: { id: string } };
    await ws1.next("rfq_open");

    // wrong subId -> rejected
    const wrongInstrument = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1000"),
      subId: SUB_ID + 1n,
    });
    ws1.send({
      type: "quote",
      rfqId: rfq.id,
      action: serializeAction(wrongInstrument.action),
      signature: wrongInstrument.signature,
    });
    const rej1 = await ws1.next("quote_rejected");
    expect(String(rej1.reason)).toContain("subId");

    // insufficient maker cash -> rejected
    reader.balances.set(MAKER1_SUBACC, toUnit("10"));
    const poorQuote = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1000"),
    });
    ws1.send({
      type: "quote",
      rfqId: rfq.id,
      action: serializeAction(poorQuote.action),
      signature: poorQuote.signature,
    });
    const rej2 = await ws1.next("quote_rejected");
    expect(String(rej2.reason)).toContain("insufficient maker cash");

    // signature by someone else -> rejected
    reader.balances.set(MAKER1_SUBACC, toUnit("1000000"));
    const good = await signedMakerQuote({
      account: maker1,
      subaccountId: MAKER1_SUBACC,
      premium: toUnit("1000"),
    });
    const foreignSig = await signAction({
      action: good.action,
      signer: maker2,
      chainId: CHAIN_ID,
      matchingAddress: MATCHING,
    });
    ws1.send({
      type: "quote",
      rfqId: rfq.id,
      action: serializeAction(good.action),
      signature: foreignSig,
    });
    const rej3 = await ws1.next("quote_rejected");
    expect(String(rej3.reason)).toContain("signature");

    // no valid quotes -> auction expires
    await ws1.next("rfq_closed");
    const status = (await (await fetch(`${base}/rfq/${rfq.id}`)).json()) as any;
    expect(status.rfq.status).toBe("expired");
    expect(status.bestQuote).toBeNull();

    // accepting an expired auction fails
    const takerAction = buildAction({
      subaccountId: TAKER_SUBACC,
      module: RFQ_MODULE,
      data: encodeTakerOrder({ orderHash: ("0x" + "00".repeat(32)) as Hex, maxFee: 0n }),
      owner: taker.address,
    });
    const takerSig = await signAction({
      action: takerAction,
      signer: taker,
      chainId: CHAIN_ID,
      matchingAddress: MATCHING,
    });
    const acceptRes = await fetch(`${base}/rfq/${rfq.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: serializeAction(takerAction), signature: takerSig }),
    });
    expect(acceptRes.status).toBe(409);
  });

  it("rejects unauthenticated quotes and bad auth signatures", async () => {
    const ws = await WsClient.connect(`ws://127.0.0.1:${port}/maker`);
    clients.push(ws);
    await ws.next("auth_challenge");

    // quote before auth
    ws.send({ type: "quote", rfqId: "x", action: {}, signature: "0x" });
    const err1 = await ws.next("error");
    expect(String(err1.message)).toContain("authenticate");

    // auth with a signature over the wrong message
    const badSig = await maker1.signMessage({ message: "not the challenge" });
    ws.send({ type: "auth", address: maker1.address, signature: badSig });
    const err2 = await ws.next("error");
    expect(String(err2.message)).toContain("auth failed");
  });

  it("rejects bad create requests", async () => {
    const bad = await fetch(`${base}/rfq`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subaccountId: "1",
        instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
        amount: "1",
        direction: "buy",
      }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as any).error).toContain("sell");

    const badAsset = await fetch(`${base}/rfq`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subaccountId: "1",
        instrument: { asset: "DOGE", expiry: EXPIRY.toString(), strike: "1", isCall: true },
        amount: "1",
        direction: "sell",
      }),
    });
    expect(badAsset.status).toBe(400);
  });

  it("supports the taker WS channel: create_rfq + push updates on close", async () => {
    const takerWs = await WsClient.connect(`ws://127.0.0.1:${port}/taker`);
    clients.push(takerWs);

    takerWs.send({
      type: "create_rfq",
      request: {
        subaccountId: TAKER_SUBACC.toString(),
        instrument: { asset: "BTC", expiry: EXPIRY.toString(), strike: "110000", isCall: true },
        amount: "1",
        direction: "sell",
      },
    });
    const created = await takerWs.next("rfq_created");
    expect((created.rfq as any).status).toBe("open");

    const update = await takerWs.next("rfq_update");
    expect((update.update as any).rfq.status).toBe("expired");
  });
});
