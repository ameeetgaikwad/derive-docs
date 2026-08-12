#!/usr/bin/env node
import { formatEther } from "viem";
import {
  getDeployedAddress,
  makeWalletClient,
  type MarketDefinition,
} from "@hedge/shared";
import {
  fetchHermesUpdates,
  formatPythPrice,
  getPythPusherAccount,
  oracleSignerReadiness,
  pushPythUpdates,
  type PythBatchAddresses,
} from "@hedge/oracle-feeds";
import {
  SUPPORTED_RWA_MARKET_IDS,
  marketFromManifest,
  parseDeployMarkets,
  type RwaMarketId,
} from "./rwa-testnet.js";
import {
  assertTestnetChain,
  loadTestnetEnv,
  makeTestnetClient,
  readPythBinding,
  readPythHealth,
  readTestnetManifest,
  requireEnv,
  requireTestnetDeployments,
  verifyMarket,
} from "./rwa-testnet-operator.js";

interface Options {
  broadcast: boolean;
  help: boolean;
  markets: RwaMarketId[];
}

function parseOptions(argv: string[]): Options {
  let broadcast = false;
  let help = false;
  const marketValues: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--broadcast") broadcast = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--market") {
      const value = argv[++index];
      if (!value) throw new Error("--market requires a value");
      marketValues.push(value);
    } else if (arg.startsWith("--market=")) {
      marketValues.push(arg.slice("--market=".length));
    } else throw new Error(`unknown argument ${arg}`);
  }
  const markets = parseDeployMarkets(marketValues);
  for (const market of markets) {
    if (!(SUPPORTED_RWA_MARKET_IDS as readonly string[]).includes(market)) {
      throw new Error(`${market} is not supported by the RWA bootstrap`);
    }
  }
  return { broadcast, help, markets };
}

function usage(): void {
  console.log(`Bootstrap staged RWA oracle prices on BSC testnet (chain 97).

Usage:
  pnpm bootstrap:rwa:testnet:plan  # fetch/validate Hermes data; no transaction
  pnpm bootstrap:rwa:testnet       # batch-push XAU/SPY/NVDA; keep disabled

Advanced package invocation:
  pnpm --filter @hedge/e2e bootstrap:rwa:testnet --market XAU --broadcast

Required (shell, protocol/.env, or services/oracle-feeds/.env):
  TESTNET_RPC_URL or RPC_URL
  TESTNET_FEED_SIGNER_KEY, FEED_SIGNER_KEY, or a PYTH_PUSHER_* account
  RWA_IV_XAU / RWA_IV_SPY / RWA_IV_NVDA (or RWA_CLOSES_<MARKET>)

The command verifies deployed adapters, price IDs, current Hermes data, pusher
and feed-signer gas, and post-update freshness. It never enables a market.`);
}

function configuredPricing(market: MarketDefinition): string {
  const ivName = `RWA_IV_${market.id}`;
  const closesName = `RWA_CLOSES_${market.id}`;
  const iv = process.env[ivName]?.trim();
  if (iv) {
    const parsed = Number(iv);
    if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${ivName} must be positive`);
    return `${ivName}=${iv}`;
  }
  if (process.env[closesName]?.trim()) return closesName;
  throw new Error(`configure ${ivName} or ${closesName} before bootstrapping ${market.id}`);
}

function maximumAge(): bigint {
  const raw = process.env.ACTIVATION_MAX_PYTH_AGE_SEC?.trim() ?? "120";
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw new Error("ACTIVATION_MAX_PYTH_AGE_SEC must be a positive integer");
  }
  return BigInt(raw);
}

async function bootstrap(): Promise<void> {
  loadTestnetEnv();
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const manifest = readTestnetManifest();
  const deployments = requireTestnetDeployments();
  const client = makeTestnetClient();
  await assertTestnetChain(client);

  const markets = options.markets.map((marketId) =>
    marketFromManifest(manifest, marketId)
  );
  for (const market of markets) {
    if (!market.contracts || !market.collateral.address || !market.pythPriceId) {
      throw new Error(`${market.id} is not deployed; run pnpm deploy:rwa:testnet first`);
    }
    await verifyMarket(client, deployments, market);
    console.log(`[rwa-bootstrap] verified ${market.id} contracts; pricing=${configuredPricing(market)}`);
  }

  const configuredPyth = getDeployedAddress(deployments, "pyth");
  const bindings = await Promise.all(markets.map((market) => readPythBinding(client, market)));
  const batch: PythBatchAddresses = {
    pyth: configuredPyth,
    markets: markets.map((market, index) => {
      const binding = bindings[index]!;
      if (binding.pyth.toLowerCase() !== configuredPyth.toLowerCase()) {
        throw new Error(`${market.id} adapter points to an unexpected Pyth contract ${binding.pyth}`);
      }
      return { marketId: market.id, priceId: binding.priceId, adapter: binding.adapter };
    }),
  };

  const hermes = await fetchHermesUpdates(batch.markets.map((market) => market.priceId));
  const sourceBlock = await client.getBlock();
  const maxAge = maximumAge();
  const staleSources: string[] = [];
  for (const market of batch.markets) {
    const price = hermes.prices.get(market.priceId.toLowerCase());
    if (!price) throw new Error(`Hermes did not return parsed price data for ${market.marketId}`);
    if (BigInt(price.price) <= 0n) throw new Error(`Hermes returned a non-positive ${market.marketId} price`);
    const publishTime = BigInt(price.publishTime);
    const age = sourceBlock.timestamp > publishTime ? sourceBlock.timestamp - publishTime : 0n;
    console.log(
      `[rwa-bootstrap] Hermes ${market.marketId} price=` +
        `${formatPythPrice(price.price, price.expo)} publishTime=${price.publishTime} age=${age}s`,
    );
    if (publishTime === 0n || age > maxAge) staleSources.push(`${market.marketId} (${age}s old)`);
  }
  if (staleSources.length > 0) {
    throw new Error(
      `Hermes source data is stale: ${staleSources.join(", ")}; ` +
        `wait for those markets to resume before broadcasting`,
    );
  }

  if (!options.broadcast) {
    console.log("[rwa-bootstrap] DRY RUN — no transaction sent and all markets remain disabled");
    console.log(
      `[rwa-bootstrap] rerun with --market ${options.markets.join(",")} --broadcast ` +
        "to push this reviewed selection",
    );
    return;
  }

  const account = await getPythPusherAccount(97);
  const minimumBalance = BigInt(process.env.ORACLE_MIN_SIGNER_BALANCE_WEI ?? "5000000000000000");
  const pusherReadiness = await oracleSignerReadiness(client, account.address, minimumBalance);
  if (!pusherReadiness.ready) {
    throw new Error(
      `Pyth pusher ${account.address} has ${pusherReadiness.balance} wei; ` +
        `fund at least ${pusherReadiness.minimumBalance} wei`,
    );
  }
  console.log(
    `[rwa-bootstrap] pusher=${account.address} balance=${formatEther(pusherReadiness.balance)} tBNB`,
  );

  const wallet = makeWalletClient(account, { chainId: 97, rpcUrl: requireEnv("RPC_URL") });
  const pushed = await pushPythUpdates({
    publicClient: client,
    walletClient: wallet,
    account,
    addresses: batch,
  });
  console.log(`[rwa-bootstrap] batch update mined: ${pushed.txHash}`);

  const block = await client.getBlock();
  for (const market of markets) {
    const health = await readPythHealth(client, market);
    const age = block.timestamp > health.publishTime ? block.timestamp - health.publishTime : 0n;
    if (health.price <= 0n) throw new Error(`${market.id} Pyth price is not positive after update`);
    if (health.publishTime === 0n || age > maxAge) {
      throw new Error(`${market.id} Pyth price is stale after update (${age}s; maximum ${maxAge}s)`);
    }
    console.log(`[rwa-bootstrap] ${market.id} fresh age=${age}s adapter=${health.adapter}`);
  }

  const feedSigner = getDeployedAddress(deployments, "feedSigner");
  const signerReadiness = await oracleSignerReadiness(client, feedSigner, minimumBalance);
  if (!signerReadiness.ready) {
    throw new Error(
      `feed signer ${feedSigner} has ${signerReadiness.balance} wei; ` +
        `fund at least ${signerReadiness.minimumBalance} wei before activation`,
    );
  }
  console.log(
    `[rwa-bootstrap] readiness passed; feedSigner=${feedSigner} ` +
      `balance=${formatEther(signerReadiness.balance)} tBNB`,
  );
  console.log("[rwa-bootstrap] all markets remain disabled; activate XAU first after reviewing this output");
}

bootstrap().catch((error) => {
  console.error(`[rwa-bootstrap] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
