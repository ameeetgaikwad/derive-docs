#!/usr/bin/env node
import "dotenv/config";

/**
 * maker-bot — reference market maker for hedge.
 *
 *   maker-bot                  run the quoting bot (needs PRIVATE_KEY + subaccount)
 *   maker-bot --setup          create subaccount under Matching + deposit USDT cash
 *   maker-bot price --forward 100000 --strike 110000 --days 7 --vol 0.6 [--rate 0] [--put]
 *                              offline Black-76 sanity check (no chain, no WS)
 */
import {
  fromUnit,
  getDeployedAddress,
  makePublicClient,
  makeWalletClient,
  readDeployments,
  readMarketManifest,
  enabledMarkets,
  toUnit,
} from "@hedge/shared";
import type { PublicClient } from "viem";
import { black76Price } from "./black76.js";
import { loadAccount, loadConfig } from "./config.js";
import { makePriceSource } from "./pricing.js";
import { buildSignedQuote, type QuoteLeg } from "./quoter.js";
import { resolveSubaccountId, runSetup } from "./setup.js";
import { MakerWsClient, type PublicRfq } from "./transport.js";

function parseFlags(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function cmdPrice(argv: string[]): void {
  const f = parseFlags(argv);
  const need = (k: string): number => {
    const v = f[k];
    if (typeof v !== "string") throw new Error(`--${k} <number> is required`);
    return Number(v);
  };
  const days = need("days");
  const params = {
    forward: need("forward"),
    strike: need("strike"),
    timeToExpiryYears: days / 365,
    vol: need("vol"),
    rate: typeof f.rate === "string" ? Number(f.rate) : 0,
    isCall: !f.put,
  };
  const theo = black76Price(params);
  const cfg = loadConfig();
  console.log(JSON.stringify(
    {
      ...params,
      theo,
      bid: theo * cfg.bidRatio,
      ask: theo * cfg.askRatio,
    },
    null,
    2,
  ));
}

async function cmdSetup(): Promise<void> {
  const cfg = loadConfig();
  const account = loadAccount();
  const publicClient = makePublicClient({ chainId: cfg.chainId, rpcUrl: cfg.rpcUrl });
  const walletClient = makeWalletClient(account, { chainId: cfg.chainId, rpcUrl: cfg.rpcUrl });
  const result = await runSetup({ cfg, account, publicClient, walletClient });
  console.log(
    `[setup] done: subaccount=${result.subaccountId} cash=${fromUnit(result.cashBalance18)} USDT`,
  );
}

async function cmdRun(): Promise<void> {
  const cfg = loadConfig();
  const account = loadAccount();
  const deployments = readDeployments(cfg.chainId);

  let publicClient: PublicClient | null = null;
  try {
    publicClient = makePublicClient({ chainId: cfg.chainId, rpcUrl: cfg.rpcUrl });
  } catch {
    publicClient = null;
  }

  if (!deployments) {
    throw new Error(
      `No deployments file for chain ${cfg.chainId} — run the protocol deploy script first`,
    );
  }
  const matching = getDeployedAddress(deployments, "matching");
  const rfqModule = getDeployedAddress(deployments, "rfqModule");
  const activeMarkets = enabledMarkets(readMarketManifest(cfg.chainId));
  const marketsById = new Map<string, (typeof activeMarkets)[number]>(
    activeMarkets.map((market) => [market.id, market]),
  );

  const subaccountId = resolveSubaccountId(cfg, account.address);
  const priceSources = new Map<string, ReturnType<typeof makePriceSource>>(
    activeMarkets.map((market) => [market.id, makePriceSource(cfg, publicClient, market)]),
  );
  const maxFee = toUnit(cfg.maxFee);

  console.log(`[maker-bot] chain=${cfg.chainId} owner=${account.address} subaccount=${subaccountId}`);
  console.log(`[maker-bot] enabled markets=${activeMarkets.map((market) => market.id).join(",")} maxFee=${cfg.maxFee}`);

  const quoted = new Set<string>();

  const client = new MakerWsClient({
    url: cfg.wsUrl,
    address: account.address,
    signMessage: (message) => account.signMessage({ message }),
    onRfq: async (rfq: PublicRfq) => {
      try {
        if (quoted.has(rfq.id)) return; // engine replays open RFQs after re-auth
        if (Date.now() >= rfq.auctionEndsAt) {
          console.log(`[maker-bot] skipping rfq ${rfq.id}: auction already over`);
          return;
        }
        const market = marketsById.get(rfq.instrument.currency);
        const priceSource = priceSources.get(rfq.instrument.currency);
        if (!market || !priceSource) {
          console.log(`[maker-bot] skipping rfq ${rfq.id}: ${rfq.instrument.currency} is not enabled locally`);
          return;
        }
        // v1: direction "sell" = taker sells, maker receives => positive amount.
        const legs: QuoteLeg[] = [
          {
            asset: rfq.instrument.optionAsset,
            subId: BigInt(rfq.instrument.subId),
            amount: BigInt(rfq.amount),
          },
        ];

        // The engine rejects actions expiring before the auction window ends.
        const minExpiry = Math.ceil(rfq.auctionEndsAt / 1000) + 60;
        const ttlExpiry = Math.floor(Date.now() / 1000) + cfg.quoteTtlSec;
        const quote = await buildSignedQuote({
          legs,
          priceSource,
          bidRatio: cfg.marketBidRatios[market.id] ?? cfg.bidRatio,
          askRatio: cfg.marketAskRatios[market.id] ?? cfg.askRatio,
          maxFee,
          subaccountId,
          owner: account.address,
          signer: account,
          chainId: cfg.chainId,
          matchingAddress: matching,
          rfqModuleAddress: rfqModule,
          ttlSec: cfg.quoteTtlSec,
          actionExpirySec: BigInt(Math.max(minExpiry, ttlExpiry)),
        });

        client.sendQuote(rfq.id, quote.action, quote.signature);
        quoted.add(rfq.id);

        for (const leg of quote.pricedLegs) {
          console.log(
            `[maker-bot] quoted rfq=${rfq.id} ${leg.instrument} amount=${fromUnit(leg.amount)} ` +
              `F=${leg.inputs.forward} iv=${leg.inputs.vol} theo=${leg.theo.toFixed(2)} ` +
              `px=${leg.unitPrice.toFixed(2)}`,
          );
        }
      } catch (err) {
        console.error(`[maker-bot] failed to quote rfq ${rfq.id}:`, err);
      }
    },
    onEvent: (msg) => {
      switch (msg.type) {
        case "quote_ack":
          console.log(
            `[maker-bot] quote accepted: rfq=${msg.rfqId} quote=${msg.quoteId}` +
              (msg.replacedQuoteId ? ` (replaced ${msg.replacedQuoteId})` : ""),
          );
          break;
        case "quote_rejected":
          console.warn(`[maker-bot] quote rejected: rfq=${msg.rfqId} reason=${msg.reason}`);
          break;
        case "rfq_closed":
          console.log(
            `[maker-bot] auction closed: rfq=${msg.rfqId} ${msg.won ? "WON" : `best=${msg.bestQuoteId}`}` +
              (msg.won && msg.acceptDeadlineAt
                ? ` (taker must accept by ${new Date(msg.acceptDeadlineAt).toISOString()})`
                : ""),
          );
          quoted.delete(msg.rfqId);
          break;
        case "rfq_executed": {
          const fill = msg.fill
            ? ` fill: ${fromUnit(BigInt(msg.fill.amount))}x ${msg.fill.instrument} @ ${fromUnit(
                BigInt(msg.fill.premium),
              )} (premium paid ${fromUnit(BigInt(msg.fill.totalPremium))}, makerFee ${fromUnit(
                BigInt(msg.fill.makerFee),
              )})`
            : "";
          console.log(`[maker-bot] executed on-chain: rfq=${msg.rfqId} tx=${msg.txHash}${fill}`);
          break;
        }
        case "rfq_failed":
          console.warn(`[maker-bot] execution FAILED: rfq=${msg.rfqId} reason=${msg.reason}`);
          break;
        case "rfq_expired":
          console.log(`[maker-bot] won auction expired unaccepted: rfq=${msg.rfqId} (${msg.reason})`);
          break;
        case "cancel_ack":
          console.log(`[maker-bot] quote cancelled: rfq=${msg.rfqId} quote=${msg.quoteId}`);
          break;
        case "cancel_rejected":
          console.warn(`[maker-bot] cancel rejected: quote=${msg.quoteId} reason=${msg.reason}`);
          break;
        case "superseded":
          console.warn(`[maker-bot] connection superseded: ${msg.message}`);
          break;
        case "error":
          console.warn(`[maker-bot] engine error: ${msg.message}`);
          break;
      }
    },
  });

  client.start();

  const shutdown = () => {
    console.log("\n[maker-bot] shutting down");
    client.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === "price") {
    cmdPrice(argv.slice(1));
    return;
  }
  if (argv.includes("--setup")) {
    await cmdSetup();
    return;
  }
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "usage: maker-bot [--setup] | maker-bot price --forward F --strike K --days D --vol V [--rate R] [--put]",
    );
    return;
  }
  await cmdRun();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
