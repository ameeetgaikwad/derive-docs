#!/usr/bin/env node
import { formatEther } from "viem";
import { getDeployedAddress } from "@hedge/shared";
import { fetchHermesUpdates, formatPythPrice } from "@hedge/oracle-feeds";
import { ProcManager } from "./util.js";
import {
  mergeSidecarIntoManifest,
  priceIdForMarket,
  sameAddress,
  writeJsonAtomic,
} from "./rwa-testnet.js";
import {
  PROTOCOL_DIR,
  STAGING_MANIFEST_PATH,
  STAGING_REPORT_PATH,
  assertStagingChain,
  loadMainnetStagingEnv,
  makeStagingClient,
  readStagingManifest,
  readStagingSidecar,
  requireEnv,
  requireStagingHermes,
  requireStagingDeployments,
  requireStagingRwaMarket,
  verifyStagingAuthority,
  verifyStagingMarket,
  verifyStagingSequence,
} from "./rwa-mainnet-staging-operator.js";

interface Options {
  market: ReturnType<typeof requireStagingRwaMarket>;
  broadcast: boolean;
  confirm: boolean;
  help: boolean;
}

function parseOptions(argv: string[]): Options | { help: true } {
  let market: string | undefined;
  let broadcast = false;
  let confirm = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--broadcast") broadcast = true;
    else if (arg === "--confirm") confirm = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--market") market = argv[++i];
    else if (arg.startsWith("--market=")) market = arg.slice("--market=".length);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (help) return { help: true };
  if (broadcast !== confirm) throw new Error("a broadcast requires both --broadcast and --confirm");
  return { market: requireStagingRwaMarket(market), broadcast, confirm, help: false };
}

function usage(): void {
  console.log(`Deploy exactly one disabled RWA market to the isolated chain-56 staging stack.

Usage:
  pnpm deploy:rwa:mainnet-staging --market XAU
  pnpm deploy:rwa:mainnet-staging --market XAU --broadcast --confirm

The enforced order is XAU, then SPY, then NVDA. Every broadcast verifies chain,
ownership, signer gas, token metadata, borrowing=false, and the reviewed Pyth source ID and
expected SRM market id before sending transactions. The resulting manifest entry
remains disabled until the separate activation command is run.`);
}

async function verifyHermesSource(priceId: `0x${string}`, marketId: string): Promise<void> {
  let update: Awaited<ReturnType<typeof fetchHermesUpdates>>;
  try {
    update = await fetchHermesUpdates([priceId], requireStagingHermes());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Hermes 401") || message.includes("Hermes 403")) {
      throw new Error(
        `upgraded Hermes denied ${marketId}; verify PYTH_API_KEY includes this asset class ` +
          `and feed ${priceId} is Pro-compatible before deploying`,
      );
    }
    throw error;
  }
  const price = update.prices.get(priceId.toLowerCase());
  if (!price || BigInt(price.price) <= 0n || price.publishTime <= 0) {
    throw new Error(`Hermes did not return a positive ${marketId} source price`);
  }
  console.log(
    `[rwa-staging-deploy] Hermes ${marketId} source=` +
      `${formatPythPrice(price.price, price.expo)} publishTime=${price.publishTime}`,
  );
}

async function deploy(): Promise<void> {
  loadMainnetStagingEnv();
  const options = parseOptions(process.argv.slice(2));
  if (options.help) return usage();

  let manifest = readStagingManifest();
  const market = manifest.markets.find((candidate) => candidate.id === options.market);
  if (!market) throw new Error(`${options.market} is missing from the staging manifest`);
  if (market.enabled && options.broadcast) {
    throw new Error(`${options.market} is already enabled; deployment is not a retry path`);
  }
  const client = makeStagingClient();
  const deployments = requireStagingDeployments();
  await assertStagingChain(client);
  const authority = await verifyStagingAuthority(client, deployments);
  console.log(
    `[rwa-staging-deploy] preflight deployer=${authority.deployer} ` +
      `balance=${formatEther(authority.deployerBalance)} BNB feedSigner=${authority.feedSigner} ` +
      `balance=${formatEther(authority.feedSignerBalance)} BNB`,
  );

  if (market.contracts) {
    await verifyStagingMarket(client, deployments, market);
    console.log(
      `[rwa-staging-deploy] ${options.market} is already staged and verified; ` +
        `${options.broadcast ? "no transaction sent" : "dry run complete"}`,
    );
    return;
  }

  let sidecar = readStagingSidecar(options.market);
  if (!sidecar) {
    const priceId = priceIdForMarket(manifest, options.market);
    await verifyHermesSource(priceId, options.market);
    // Feed access is independent of deployment ordering. Check it first so an
    // operator can validate every future market without broadcasting its
    // predecessors. The sequence guard still runs before any transaction.
    await verifyStagingSequence(client, deployments, options.market);
    if (!options.broadcast) {
      console.log("[rwa-staging-deploy] DRY RUN — preflight passed; no transactions or files changed");
      console.log(`[rwa-staging-deploy] chain=56 market=${options.market}`);
      console.log(`[rwa-staging-deploy] pyth=${priceId}`);
      console.log("[rwa-staging-deploy] action=deploy, verify, and leave disabled");
      console.log("[rwa-staging-deploy] rollout order is XAU -> SPY -> NVDA");
      return;
    }
    const processes = new ProcManager();
    await processes.run(
      `add-mainnet-staging-${options.market.toLowerCase()}`,
      "forge",
      [
        "script",
        "script/AddMainnetStagingRwaMarket.s.sol",
        "--rpc-url",
        requireEnv("RPC_URL"),
        "--broadcast",
        "--legacy",
        "--retries",
        "12",
        "--delay",
        "5",
        "--slow",
      ],
      {
        cwd: PROTOCOL_DIR,
        timeoutMs: 20 * 60_000,
        env: {
          PRIVATE_KEY: requireEnv("PRIVATE_KEY"),
          MARKET_ID: options.market,
          FEED_SIGNER: getDeployedAddress(deployments, "feedSigner"),
          MAINNET_STAGING_RWA_CONFIRM: "ADD_HEDGE_MAINNET_STAGING_RWA_CHAIN_56",
        },
      },
    );
    sidecar = readStagingSidecar(options.market);
    if (!sidecar) throw new Error("deployment completed without writing the staging sidecar");
  }

  if (!market.collateral.address || !sameAddress(sidecar.underlying, market.collateral.address)) {
    throw new Error(`${options.market} sidecar collateral does not match the reviewed staging manifest`);
  }
  const expectedPriceId = priceIdForMarket(manifest, options.market);
  if (sidecar.pythPriceId.toLowerCase() !== expectedPriceId.toLowerCase()) {
    throw new Error(`${options.market} sidecar Pyth id does not match the reviewed staging manifest`);
  }

  manifest = mergeSidecarIntoManifest(manifest, options.market, sidecar);
  const staged = manifest.markets.find((candidate) => candidate.id === options.market)!;
  await verifyStagingMarket(client, deployments, staged);
  if (!options.broadcast) {
    console.log(
      `[rwa-staging-deploy] DRY RUN — existing ${options.market} sidecar verified; ` +
        "rerun with --broadcast --confirm to merge it without redeploying",
    );
    return;
  }
  writeJsonAtomic(STAGING_MANIFEST_PATH, manifest);
  writeJsonAtomic(STAGING_REPORT_PATH, {
    chainId: 56,
    generatedAt: new Date().toISOString(),
    deployer: authority.deployer,
    feedSigner: authority.feedSigner,
    market: staged,
  });
  console.log(`[rwa-staging-deploy] ${options.market} staged, verified, and left disabled`);
  console.log(`[rwa-staging-deploy] report written to ${STAGING_REPORT_PATH}`);
}

deploy().catch((error) => {
  console.error(`[rwa-staging-deploy] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
