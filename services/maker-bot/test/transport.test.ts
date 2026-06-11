import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import { recoverAddress, verifyMessage, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { encodeOptionSubId, getActionDigest, hashRfqTrades, toUnit } from "@sats-options/shared";
import { decodeAbiParameters } from "viem";
import { buildSignedQuote } from "../src/quoter.js";
import {
  deserializeAction,
  MakerWsClient,
  type PublicRfq,
  type SerializedAction,
} from "../src/transport.js";

const CHAIN_ID = 31337;
const MATCHING = "0x2E2Ed0Cfd3AD2f1d34481277b3204d807Ca2F8c2" as Address;
const RFQ_MODULE = "0x8198f5d8F8CfFE8f9C413d98a0A55aEB8ab9FbB7" as Address;
const OPTION_ASSET = "0x1291Be112d480055DaFd8a610b7d1e203891C274" as Address;

const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

/**
 * Emulates the rfq-engine maker channel (services/rfq-engine/src/server.ts):
 * auth_challenge -> verify EIP-191 auth -> auth_ok -> rfq_open -> expect quote.
 */
describe("MakerWsClient against an engine-protocol fake", () => {
  let server: WebSocketServer;
  let port: number;

  beforeAll(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((res) => server.once("listening", res));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => server.close());

  it("authenticates with the challenge and pushes a valid signed quote", async () => {
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 7 * 86_400);
    const strike = toUnit("110000");
    const subId = encodeOptionSubId({ expiry, strike, isCall: true });
    const challenge = `sats-options rfq-engine maker auth test ${Date.now()}`;
    const auctionEndsAt = Date.now() + 3000;

    const rfq: PublicRfq = {
      id: "rfq-1",
      takerSubaccountId: "2",
      direction: "sell",
      instrument: {
        name: "BTC-TEST-110000-C",
        currency: "BTC",
        optionAsset: OPTION_ASSET,
        expiry: expiry.toString(),
        strike: strike.toString(),
        isCall: true,
        subId: subId.toString(),
      },
      amount: toUnit("1").toString(),
      createdAt: Date.now(),
      auctionEndsAt,
      status: "open",
    };

    const engineSide = new Promise<{
      authOk: boolean;
      quote: { rfqId: string; action: SerializedAction; signature: Hex };
    }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("engine timed out")), 5000);
      server.once("connection", (sock: WsSocket) => {
        sock.send(JSON.stringify({ type: "auth_challenge", challenge }));
        let authOk = false;
        sock.on("message", (raw: Buffer) => {
          void (async () => {
            const msg = JSON.parse(raw.toString());
            if (msg.type === "auth") {
              authOk = await verifyMessage({
                address: msg.address,
                message: challenge,
                signature: msg.signature,
              });
              if (!authOk) {
                clearTimeout(timer);
                return reject(new Error("auth signature failed verification"));
              }
              sock.send(JSON.stringify({ type: "auth_ok", address: msg.address }));
              sock.send(JSON.stringify({ type: "rfq_open", rfq }));
            } else if (msg.type === "quote") {
              clearTimeout(timer);
              resolve({ authOk, quote: msg });
            }
          })().catch(reject);
        });
      });
    });

    const client = new MakerWsClient({
      url: `ws://127.0.0.1:${port}/maker`,
      address: account.address,
      signMessage: (message) => account.signMessage({ message }),
      log: () => {},
      onRfq: async (openRfq) => {
        const quote = await buildSignedQuote({
          legs: [
            {
              asset: openRfq.instrument.optionAsset,
              subId: BigInt(openRfq.instrument.subId),
              amount: BigInt(openRfq.amount),
            },
          ],
          priceSource: { getInputs: async () => ({ forward: 100_000, vol: 0.6, rate: 0 }) },
          bidRatio: 0.95,
          askRatio: 1.05,
          maxFee: 0n,
          subaccountId: 42n,
          owner: account.address,
          signer: account,
          chainId: CHAIN_ID,
          matchingAddress: MATCHING,
          rfqModuleAddress: RFQ_MODULE,
          ttlSec: 300,
          actionExpirySec: BigInt(Math.ceil(openRfq.auctionEndsAt / 1000) + 60),
        });
        client.sendQuote(openRfq.id, quote.action, quote.signature);
      },
    });

    client.start();
    try {
      const { authOk, quote } = await engineSide;
      expect(authOk).toBe(true);
      expect(quote.rfqId).toBe("rfq-1");

      // Engine-side validation: decode RfqOrder from action.data ...
      const action = deserializeAction(quote.action);
      expect(action.module).toBe(RFQ_MODULE);
      expect(action.subaccountId).toBe(42n);
      expect(action.owner.toLowerCase()).toBe(account.address.toLowerCase());
      // action must outlive the auction window (quotes.ts check)
      expect(action.expiry).toBeGreaterThanOrEqual(BigInt(Math.ceil(auctionEndsAt / 1000)));

      const [order] = decodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "maxFee", type: "uint256" },
              {
                name: "trades",
                type: "tuple[]",
                components: [
                  { name: "asset", type: "address" },
                  { name: "subId", type: "uint256" },
                  { name: "price", type: "uint256" },
                  { name: "amount", type: "int256" },
                ],
              },
            ],
          },
        ],
        action.data,
      );
      expect(order.trades).toHaveLength(1);
      expect(order.trades[0]!.asset.toLowerCase()).toBe(OPTION_ASSET.toLowerCase());
      expect(order.trades[0]!.subId).toBe(subId);
      expect(order.trades[0]!.amount).toBe(toUnit("1")); // maker receives what taker sells
      expect(order.trades[0]!.price).toBeGreaterThan(0n);
      expect(hashRfqTrades([...order.trades])).toBeTruthy();

      // ... and the EIP-712 signature recovers to action.signer.
      const recovered = await recoverAddress({
        hash: getActionDigest(action, CHAIN_ID, MATCHING),
        signature: quote.signature,
      });
      expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
    } finally {
      client.stop();
    }
  }, 10_000);
});
