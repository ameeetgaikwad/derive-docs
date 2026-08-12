#!/usr/bin/env node
import { formatEther } from "viem";
import { getDeployedAddress } from "@hedge/shared";
import {
  requireRwaMarket,
  setManifestMarketEnabled,
  writeJsonAtomic,
  type RwaMarketId,
} from "./rwa-testnet.js";
import {
  TESTNET_MANIFEST_PATH,
  assertTestnetChain,
  loadTestnetEnv,
  makeTestnetClient,
  readPythHealth,
  readTestnetManifest,
  requireTestnetDeployments,
  verifyMarket,
} from "./rwa-testnet-operator.js";

interface Options {
  market: RwaMarketId;
  confirm: boolean;
  disable: boolean;
  help: boolean;
}

function parseOptions(argv: string[]): Options | { help: true } {
  let market: string | undefined;
  let confirm = false;
  let disable = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--confirm") confirm = true;
    else if (arg === "--disable") disable = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--market") {
      market = argv[++i];
      if (!market) throw new Error("--market requires a value");
    } else if (arg.startsWith("--market=")) {
      market = arg.slice("--market=".length);
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (help) return { help: true };
  return { market: requireRwaMarket(market), confirm, disable, help: false };
}

function usage(): void {
  console.log(`Enable or disable one staged RWA market in the BSC-testnet manifest.

Usage:
  pnpm activate:rwa:testnet --market XAU              # readiness check only
  pnpm activate:rwa:testnet --market XAU --confirm    # enable after checks
  pnpm activate:rwa:testnet --market XAU --disable --confirm

Enable checks:
  - RPC is chain 97
  - contracts, collateral metadata, ERC-8056, and SRM wiring are valid
  - the configured Pyth price is positive and fresh
  - the oracle feed signer has sufficient tBNB
  - RWA_IV_<MARKET> or RWA_CLOSES_<MARKET> is configured

This command changes the local canonical manifest only. Restart the oracle,
RFQ engine, maker, and web deployment after enabling. Disabling is allowed
without RPC readiness so an affected market can be failed closed.`);
}

function requiredOraclePricing(marketId: RwaMarketId): void {
  const hasIv = Boolean(process.env[`RWA_IV_${marketId}`]?.trim());
  const hasCloses = Boolean(process.env[`RWA_CLOSES_${marketId}`]?.trim());
  if (!hasIv && !hasCloses) {
    throw new Error(
      `configure RWA_IV_${marketId} or RWA_CLOSES_${marketId} before enabling ${marketId}`,
    );
  }
}

function maxPythAge(): bigint {
  const raw = process.env.ACTIVATION_MAX_PYTH_AGE_SEC?.trim() ?? "120";
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw new Error("ACTIVATION_MAX_PYTH_AGE_SEC must be a positive integer");
  }
  return BigInt(raw);
}

async function activate(): Promise<void> {
  loadTestnetEnv();
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const manifest = readTestnetManifest();
  const market = manifest.markets.find((candidate) => candidate.id === options.market);
  if (!market) throw new Error(`${options.market} is missing from the testnet manifest`);

  if (options.disable) {
    console.log(`[rwa-activate] ${options.confirm ? "DISABLE" : "DRY RUN disable"} ${options.market}`);
    if (!options.confirm) {
      console.log(`[rwa-activate] rerun with --disable --confirm to fail ${options.market} closed`);
      return;
    }
    writeJsonAtomic(
      TESTNET_MANIFEST_PATH,
      setManifestMarketEnabled(manifest, options.market, false),
    );
    console.log(`[rwa-activate] ${options.market} disabled in markets/97.json`);
    console.log("[rwa-activate] restart the oracle, RFQ engine, maker, and web deployment");
    return;
  }

  if (!market.contracts || !market.collateral.address || !market.pythPriceId) {
    throw new Error(`${options.market} is not deployed; run pnpm deploy:rwa:testnet --broadcast first`);
  }
  requiredOraclePricing(options.market);
  const client = makeTestnetClient();
  const deployments = requireTestnetDeployments();
  await assertTestnetChain(client);
  await verifyMarket(client, deployments, market);

  const health = await readPythHealth(client, market);
  if (health.price <= 0n) throw new Error(`${options.market} Pyth price is not positive`);
  const block = await client.getBlock();
  const age = block.timestamp > health.publishTime ? block.timestamp - health.publishTime : 0n;
  const maximumAge = maxPythAge();
  if (health.publishTime === 0n || age > maximumAge) {
    throw new Error(
      `${options.market} Pyth price is stale (${age}s old; maximum ${maximumAge}s); push an update first`,
    );
  }

  const feedSigner = getDeployedAddress(deployments, "feedSigner");
  const feedSignerBalance = await client.getBalance({ address: feedSigner });
  const minimum = BigInt(process.env.ORACLE_MIN_SIGNER_BALANCE_WEI ?? "5000000000000000");
  if (feedSignerBalance < minimum) {
    throw new Error(
      `feed signer ${feedSigner} has ${feedSignerBalance} wei; fund at least ${minimum} wei`,
    );
  }

  console.log(
    `[rwa-activate] readiness passed market=${options.market} pythAge=${age}s ` +
      `feedSignerBalance=${formatEther(feedSignerBalance)} tBNB`,
  );
  if (!options.confirm) {
    console.log(`[rwa-activate] DRY RUN — ${options.market} remains ${market.enabled ? "enabled" : "disabled"}`);
    console.log(`[rwa-activate] rerun with --market ${options.market} --confirm to enable it`);
    return;
  }
  if (market.enabled) {
    console.log(`[rwa-activate] ${options.market} is already enabled; no manifest change needed`);
    return;
  }
  writeJsonAtomic(
    TESTNET_MANIFEST_PATH,
    setManifestMarketEnabled(manifest, options.market, true),
  );
  console.log(`[rwa-activate] ${options.market} enabled in markets/97.json`);
  console.log("[rwa-activate] restart services, then run the live RFQ smoke test before enabling another market");
}

activate().catch((error) => {
  console.error(`[rwa-activate] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

