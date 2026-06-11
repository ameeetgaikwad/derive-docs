#!/usr/bin/env node
/**
 * Dev utility: a one-shot fake rfq-engine maker channel speaking the real
 * protocol (services/rfq-engine/src/server.ts): auth_challenge -> auth
 * (EIP-191 verified) -> auth_ok -> rfq_open -> waits for one quote, prints
 * it, replies quote_ack + rfq_closed{won}, then exits 0. Exits 1 on timeout.
 *
 * Usage:
 *   node scripts/fake-engine.mjs [--asset 0x<optionAsset>] [--strike 110000] [--days 7]
 *   PORT=3030 by default.
 */
import { WebSocketServer } from "ws";
import { verifyMessage } from "viem";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const port = Number(process.env.PORT ?? 3030);
const strike = BigInt(flag("strike", "110000")) * 10n ** 18n;
const days = Number(flag("days", "7"));

let asset = flag("asset", null);
if (!asset) {
  // default: btcOptionAsset from the anvil deployments file
  const p = resolve(import.meta.dirname, "../../../protocol/deployments/31337.json");
  asset = JSON.parse(readFileSync(p, "utf8")).btcOptionAsset;
}

// OptionEncoding subId: expiry | (strike/1e10) << 32 | isCall << 95
const expiry = BigInt(Math.floor(Date.now() / 1000) + days * 86_400);
const subId = expiry | ((strike / 10n ** 10n) << 32n) | (1n << 95n);

const wss = new WebSocketServer({ port });
console.log(`[fake-engine] listening on ws://127.0.0.1:${port}/maker`);

const timeout = setTimeout(() => {
  console.error("[fake-engine] timed out waiting for a quote");
  process.exit(1);
}, 30_000);

wss.on("connection", (sock) => {
  const challenge = `hedge rfq-engine maker auth ${randomUUID()} ${Date.now()}`;
  sock.send(JSON.stringify({ type: "auth_challenge", challenge }));

  sock.on("message", (raw) => {
    void (async () => {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "auth") {
        const ok = await verifyMessage({
          address: msg.address,
          message: challenge,
          signature: msg.signature,
        }).catch(() => false);
        if (!ok) {
          sock.send(JSON.stringify({ type: "error", message: "auth failed: bad signature" }));
          return;
        }
        console.log(`[fake-engine] maker authenticated: ${msg.address}`);
        sock.send(JSON.stringify({ type: "auth_ok", address: msg.address }));

        const rfq = {
          id: `rfq-${Date.now()}`,
          takerSubaccountId: "2",
          direction: "sell",
          instrument: {
            name: `BTC-${days}d-${strike / 10n ** 18n}-C`,
            currency: "BTC",
            optionAsset: asset,
            expiry: expiry.toString(),
            strike: strike.toString(),
            isCall: true,
            subId: subId.toString(),
          },
          amount: (10n ** 18n).toString(),
          createdAt: Date.now(),
          auctionEndsAt: Date.now() + 10_000,
          status: "open",
        };
        console.log(`[fake-engine] broadcasting RFQ: taker sells 1x call subId=${subId}`);
        sock.send(JSON.stringify({ type: "rfq_open", rfq }));
      } else if (msg.type === "quote") {
        clearTimeout(timeout);
        console.log("[fake-engine] received quote:");
        console.log(JSON.stringify(msg, null, 2));
        sock.send(JSON.stringify({ type: "quote_ack", rfqId: msg.rfqId, quoteId: randomUUID() }));
        sock.send(
          JSON.stringify({ type: "rfq_closed", rfqId: msg.rfqId, bestQuoteId: "fake", won: true }),
        );
        setTimeout(() => process.exit(0), 200);
      }
    })().catch((err) => {
      console.error("[fake-engine] error:", err);
      process.exit(1);
    });
  });
});
