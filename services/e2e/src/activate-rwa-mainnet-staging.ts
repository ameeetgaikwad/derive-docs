#!/usr/bin/env node
import { formatEther } from "viem";
import {
  setManifestMarketEnabled,
  writeJsonAtomic,
} from "./rwa-testnet.js";
import {
  STAGING_MANIFEST_PATH,
  assertStagingChain,
  loadMainnetStagingEnv,
  makeStagingClient,
  readPythHealth,
  readStagingManifest,
  requireStagingDeployments,
  requireStagingRwaMarket,
  verifyStagingAuthority,
  verifyStagingMarket,
  verifyChainlinkSource,
  StaleChainlinkSourceError,
} from "./rwa-mainnet-staging-operator.js";

interface Options {
  market: ReturnType<typeof requireStagingRwaMarket>;
  confirm: boolean;
  deferred: boolean;
  disable: boolean;
  help: boolean;
}

function parseOptions(argv: string[]): Options | { help: true } {
  let market: string | undefined;
  let confirm = false;
  let deferred = false;
  let disable = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--confirm") confirm = true;
    else if (arg === "--deferred") deferred = true;
    else if (arg === "--disable") disable = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--market") market = argv[++i];
    else if (arg.startsWith("--market=")) market = arg.slice("--market=".length);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (help) return { help: true };
  if (disable && deferred) throw new Error("--deferred cannot be combined with --disable");
  return { market: requireStagingRwaMarket(market), confirm, deferred, disable, help: false };
}

function usage(): void {
  console.log(`Enable or disable one deployed chain-56 staging RWA market.

Usage:
  pnpm activate:rwa:mainnet-staging --market XAU
  pnpm activate:rwa:mainnet-staging --market XAU --confirm
  pnpm activate:rwa:mainnet-staging --market SPY --deferred --confirm
  pnpm activate:rwa:mainnet-staging --market XAU --disable --confirm

Normal activation requires a fresh manifest-selected Pyth or Chainlink source.
Deferred activation is for an equity feed outside its publishing window: it
allows only a verified Chainlink source with a stale last round. Identity,
configuration, and invalid-round failures remain hard stops, and the RFQ engine
stays fail-closed until the external oracle and signed feeds are fresh.`);
}

function maximumPythAge(): bigint {
  const raw = process.env.ACTIVATION_MAX_PYTH_AGE_SEC?.trim() ?? "45";
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n || BigInt(raw) >= 60n) {
    throw new Error("ACTIVATION_MAX_PYTH_AGE_SEC must be between 1 and 59 seconds");
  }
  return BigInt(raw);
}

async function activate(): Promise<void> {
  loadMainnetStagingEnv();
  const options = parseOptions(process.argv.slice(2));
  if (options.help) return usage();
  const manifest = readStagingManifest();
  const market = manifest.markets.find((candidate) => candidate.id === options.market);
  if (!market) throw new Error(`${options.market} is missing from the staging manifest`);

  if (options.disable) {
    console.log(`[rwa-staging-activate] ${options.confirm ? "DISABLE" : "DRY RUN disable"} ${options.market}`);
    if (!options.confirm) {
      console.log("[rwa-staging-activate] rerun with --disable --confirm to fail the market closed");
      return;
    }
    writeJsonAtomic(
      STAGING_MANIFEST_PATH,
      setManifestMarketEnabled(manifest, options.market, false),
    );
    console.log(`[rwa-staging-activate] ${options.market} disabled; publish images and roll all three services`);
    return;
  }

  const hasOracleSource = market.oracleProvider === "pyth"
    ? market.pythPriceId !== null
    : market.chainlinkAggregator !== null;
  if (!market.contracts || !market.collateral.address || !hasOracleSource) {
    throw new Error(`${options.market} is not deployed; run the staging deploy command first`);
  }
  if (options.deferred && options.market === "XAU" && market.oracleProvider === "pyth") {
    throw new Error("XAU publishes continuously during its 24/5 window; do not defer its activation");
  }

  const client = makeStagingClient();
  const deployments = requireStagingDeployments();
  await assertStagingChain(client);
  const authority = await verifyStagingAuthority(client, deployments);
  await verifyStagingMarket(client, deployments, market);

  let oracleStatus: string;
  if (market.oracleProvider === "chainlink") {
    if (options.deferred) {
      try {
        const health = await verifyChainlinkSource(client, market);
        oracleStatus = `deferred chainlinkAge=${health.age}s`;
      } catch (error) {
        if (!(error instanceof StaleChainlinkSourceError)) throw error;
        oracleStatus = `deferred chainlinkStale=${error.message.split("\n")[0]}`;
      }
    } else {
      const health = await verifyChainlinkSource(client, market);
      oracleStatus = `chainlinkAge=${health.age}s`;
    }
  } else if (options.deferred) {
    try {
      const health = await readPythHealth(client, market);
      const block = await client.getBlock();
      const age = block.timestamp > health.publishTime ? block.timestamp - health.publishTime : 0n;
      oracleStatus = `deferred pythAge=${age}s`;
    } catch (error) {
      oracleStatus = `deferred pythUnavailable=${(error as Error).message.split("\n")[0]}`;
    }
  } else {
    const health = await readPythHealth(client, market);
    if (health.price <= 0n || health.publishTime === 0n) {
      throw new Error(`${options.market} Pyth price is unavailable`);
    }
    const block = await client.getBlock();
    const age = block.timestamp > health.publishTime ? block.timestamp - health.publishTime : 0n;
    if (age > maximumPythAge()) {
      throw new Error(`${options.market} Pyth price is stale (${age}s); wait for or push a fresh update`);
    }
    oracleStatus = `pythAge=${age}s`;
  }

  console.log(
    `[rwa-staging-activate] readiness passed market=${options.market} ${oracleStatus} ` +
      `feedSigner=${authority.feedSigner} balance=${formatEther(authority.feedSignerBalance)} BNB`,
  );
  if (!options.confirm) {
    console.log(`[rwa-staging-activate] DRY RUN — ${options.market} remains ${market.enabled ? "enabled" : "disabled"}`);
    return;
  }
  if (market.enabled) {
    console.log(`[rwa-staging-activate] ${options.market} is already enabled`);
    return;
  }
  writeJsonAtomic(
    STAGING_MANIFEST_PATH,
    setManifestMarketEnabled(manifest, options.market, true),
  );
  console.log(`[rwa-staging-activate] ${options.market} enabled in the local staging manifest`);
  console.log(
    options.deferred
      ? "[rwa-staging-activate] runtime stays closed until fresh feeds arrive; publish and roll all services"
      : "[rwa-staging-activate] publish and roll oracle, RFQ engine, maker, and web; smoke test before the next market",
  );
}

activate().catch((error) => {
  console.error(`[rwa-staging-activate] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
