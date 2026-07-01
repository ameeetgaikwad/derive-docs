#!/usr/bin/env node
import {
  getChainId,
  makePublicClient,
  makeWalletClient,
  toUnit,
} from "@hedge/shared";
import { getDeadlineSec, getFeedSignerAccount } from "./env.js";
import { FeedPoster, feedAddressesFromDeployments, type SnapshotExpiryParams } from "./poster.js";
import { priceSourceFromEnv, StaticPriceSource, type PriceSource } from "./priceSource.js";
import { SettlementRunner, settlementAddressesFromDeployments } from "./settlement.js";
import { pushPythUpdate, pythAddressesFromDeployments, type PythAddresses } from "./pyth.js";

const USAGE = `oracle-feeds — signed feed poster + settlement runner (hedge)

Usage:
  oracle-feeds post   [--spot 100000] [--expiry <unix>]... [--forward <price>]
                      [--iv 0.6] [--rate 0.05] [--conf 1]
      One-shot: post spot (+ forward/rate/flat-IV SVI vol per --expiry).
      --spot falls back to the PRICE_SOURCE env config (static/chainlink).

  oracle-feeds daemon [--interval 15] [--spot ...] [--expiry <unix>]... [--iv 0.6] [--rate 0.05]
      Repost the same snapshot every --interval seconds (default 15).

  oracle-feeds pyth-push [--pyth 0x..] [--price-id 0x..] [--adapter 0x..] [--hermes <url>]
      Fetch the latest signed BTC/USD update from Pyth Hermes and submit it to the
      on-chain Pyth contract via updatePriceFeeds (paying the update fee), then read
      getSpot() back through the PythSpotFeed adapter. Defaults come from the
      deployments JSON (keys: pyth, btcPythPriceId, btcPythSpotFeed); HERMES_URL env
      overrides the Hermes endpoint. The sender (FEED_SIGNER_KEY) only needs gas.

  oracle-feeds settle --expiry <unix> --subaccounts 4,5
                      [--price <settlement price>] [--signed] [--skip-feed]
      Fix the settlement price and call StandardManager.settleOptions for each
      subaccount, then print balances. Chain time must be >= expiry (e2e warps
      anvil first). Default path: the PERMISSIONLESS
      AnchoredSettlementFeed.fixSettlementPrice (Chainlink round data,
      Pyth-cross-checked; --price is only a sanity log). --signed forces the
      legacy signed forward-feed path (requires --price; use for deployments
      whose OptionAsset still settles against LyraForwardFeed, e.g. anvil).

Env: RPC_URL (default http://127.0.0.1:8545), CHAIN_ID (default 31337),
     FEED_SIGNER_KEY (default: anvil key #0 on 31337), FEED_DEADLINE_SEC,
     PRICE_SOURCE=static|chainlink, SPOT_PRICE, CHAINLINK_AGGREGATOR.
`;

interface Args {
  flags: Map<string, string[]>;
  bools: Set<string>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string[]>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`Unexpected argument: ${a}`);
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      bools.add(name);
    } else {
      const list = flags.get(name) ?? [];
      list.push(next);
      flags.set(name, list);
      i++;
    }
  }
  return { flags, bools };
}

function one(args: Args, name: string): string | undefined {
  return args.flags.get(name)?.at(-1);
}

async function buildPoster() {
  const chainId = getChainId();
  const signer = await getFeedSignerAccount(chainId);
  const publicClient = makePublicClient({ chainId });
  const walletClient = makeWalletClient(signer, { chainId });
  const addresses = feedAddressesFromDeployments(chainId);
  const poster = new FeedPoster(
    publicClient,
    walletClient,
    signer,
    chainId,
    addresses,
    getDeadlineSec(),
  );
  return { chainId, signer, publicClient, walletClient, poster };
}

function expiriesFromArgs(args: Args): SnapshotExpiryParams[] {
  const expiries = args.flags.get("expiry") ?? [];
  const forward = one(args, "forward");
  const iv = one(args, "iv");
  const rate = one(args, "rate");
  return expiries.map((e) => ({
    expiry: BigInt(e),
    forwardPrice: forward ? toUnit(forward) : undefined,
    iv: iv ? toUnit(iv) : undefined,
    rate: rate ? toUnit(rate) : undefined,
  }));
}

async function resolveSpot(args: Args, source: () => PriceSource): Promise<bigint> {
  const spotArg = one(args, "spot");
  const s = spotArg ? new StaticPriceSource(toUnit(spotArg)) : source();
  return s.getSpotPrice();
}

async function cmdPost(args: Args): Promise<void> {
  const { poster, publicClient, signer, chainId } = await buildPoster();
  console.log(`[oracle-feeds] chain=${chainId} signer=${signer.address}`);
  const spot = await resolveSpot(args, () => priceSourceFromEnv(publicClient));
  const conf = one(args, "conf");
  await poster.postSnapshot({
    spot,
    confidence: conf ? toUnit(conf) : undefined,
    expiries: expiriesFromArgs(args),
  });
}

async function cmdDaemon(args: Args): Promise<void> {
  const { poster, publicClient, signer, chainId } = await buildPoster();
  const intervalSec = Number(one(args, "interval") ?? "15");
  const source = one(args, "spot")
    ? new StaticPriceSource(toUnit(one(args, "spot")!))
    : priceSourceFromEnv(publicClient);
  const expiries = expiriesFromArgs(args);
  console.log(
    `[oracle-feeds] daemon chain=${chainId} signer=${signer.address} ` +
      `source=${source.name} interval=${intervalSec}s expiries=[${expiries.map((e) => e.expiry).join(",")}]`,
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const spot = await source.getSpotPrice();
      await poster.postSnapshot({ spot, expiries });
    } catch (err) {
      console.error(`[oracle-feeds] post failed: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, intervalSec * 1000));
  }
}

async function cmdPythPush(args: Args): Promise<void> {
  const chainId = getChainId();
  const account = await getFeedSignerAccount(chainId);
  const publicClient = makePublicClient({ chainId });
  const walletClient = makeWalletClient(account, { chainId });

  let addresses: PythAddresses;
  const pythArg = one(args, "pyth");
  const priceIdArg = one(args, "price-id");
  if (pythArg && priceIdArg) {
    addresses = {
      pyth: pythArg as PythAddresses["pyth"],
      priceId: priceIdArg as PythAddresses["priceId"],
      adapter: one(args, "adapter") as PythAddresses["adapter"],
    };
  } else {
    addresses = pythAddressesFromDeployments(chainId);
    if (pythArg) addresses.pyth = pythArg as PythAddresses["pyth"];
    if (priceIdArg) addresses.priceId = priceIdArg as PythAddresses["priceId"];
    const adapterArg = one(args, "adapter");
    if (adapterArg) addresses.adapter = adapterArg as PythAddresses["adapter"];
  }

  console.log(`[oracle-feeds] pyth-push chain=${chainId} sender=${account.address}`);
  await pushPythUpdate({
    publicClient,
    walletClient,
    account,
    addresses,
    hermesUrl: one(args, "hermes"),
  });
}

async function cmdSettle(args: Args): Promise<void> {
  const expiry = one(args, "expiry");
  const price = one(args, "price");
  const subs = one(args, "subaccounts");
  const signed = args.bools.has("signed");
  if (!expiry || !subs) {
    throw new Error("settle requires --expiry and --subaccounts (comma-separated)");
  }
  if (signed && !price) {
    throw new Error("settle --signed requires --price (the signed path posts the price)");
  }
  const { poster, publicClient, walletClient, signer, chainId } = await buildPoster();
  const runner = new SettlementRunner(
    publicClient,
    walletClient,
    signer,
    poster,
    settlementAddressesFromDeployments(chainId),
  );
  await runner.run({
    expiry: BigInt(expiry),
    price: price ? toUnit(price) : undefined,
    subaccounts: subs.split(",").map((s) => BigInt(s.trim())),
    signed,
    skipFeed: args.bools.has("skip-feed"),
  });
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(USAGE);
    return;
  }
  const args = parseArgs(rest);
  switch (cmd) {
    case "post":
      return cmdPost(args);
    case "daemon":
      return cmdDaemon(args);
    case "pyth-push":
      return cmdPythPush(args);
    case "settle":
      return cmdSettle(args);
    default:
      console.log(USAGE);
      throw new Error(`Unknown command: ${cmd}`);
  }
}

main().catch((err) => {
  console.error(`[oracle-feeds] error: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
