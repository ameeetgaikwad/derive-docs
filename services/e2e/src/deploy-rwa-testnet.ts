#!/usr/bin/env node
import { existsSync } from "node:fs";
import { formatEther, type Address } from "viem";
import { getDeployedAddress } from "@hedge/shared";
import { ProcManager } from "./util.js";
import {
  MOCK_KEY_BY_MARKET,
  TOKEN_ENV_BY_MARKET,
  mergeSidecarIntoManifest,
  parseDeployMarkets,
  priceIdForMarket,
  sameAddress,
  writeJsonAtomic,
  type ManifestFile,
  type RwaMarketId,
  type RwaMocksFile,
} from "./rwa-testnet.js";
import {
  DEPLOYMENT_REPORT_PATH,
  PROTOCOL_DIR,
  RWA_MOCKS_PATH,
  TESTNET_MANIFEST_PATH,
  assertTestnetChain,
  loadTestnetEnv,
  makeTestnetClient,
  readRwaMocks,
  readSidecar,
  readTestnetManifest,
  requireEnv,
  requireTestnetDeployments,
  verifyDeploymentAuthority,
  verifyMarket,
  verifyMocks,
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
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--broadcast") broadcast = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--market") {
      const value = argv[++i];
      if (!value) throw new Error("--market requires a value");
      marketValues.push(value);
    } else if (arg.startsWith("--market=")) {
      marketValues.push(arg.slice("--market=".length));
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return { broadcast, help, markets: parseDeployMarkets(marketValues) };
}

function usage(): void {
  console.log(`Deploy staged RWA markets to BSC testnet (chain 97).

Usage:
  pnpm deploy:rwa:testnet:plan                    # non-broadcasting plan
  pnpm deploy:rwa:testnet                         # deploy mocks + XAU/SPY/NVDA

Advanced package invocation:
  pnpm --filter @hedge/e2e deploy:rwa:testnet --market XAU,NVDA
  pnpm --filter @hedge/e2e deploy:rwa:testnet --market XAU,NVDA --broadcast

Required for --broadcast (shell or protocol/.env):
  TESTNET_RPC_URL or RPC_URL
  TESTNET_DEPLOYER_KEY or PRIVATE_KEY
  XAU_PYTH_PRICE_ID, SPY_PYTH_PRICE_ID, NVDA_PYTH_PRICE_ID,
  SPCX_PYTH_PRICE_ID (only for selected undeployed markets)

Safety:
  - hard-fails unless eth_chainId is 97
  - verifies the deployer owns StandardManager and SRMPortfolioViewer
  - verifies deployer and feed-signer tBNB balances
  - reuses verified mock/sidecar artifacts after an interrupted run
  - writes markets into the manifest with enabled=false`);
}

function mockAddress(mocks: RwaMocksFile, marketId: RwaMarketId): Address {
  return mocks[MOCK_KEY_BY_MARKET[marketId]] as Address;
}

function dryRun(manifest: ManifestFile, markets: RwaMarketId[]): void {
  console.log("[rwa-deploy] DRY RUN — no transactions will be sent");
  console.log(`[rwa-deploy] chain=97 markets=${markets.join(",")}`);
  console.log(`[rwa-deploy] mocks=${existsSync(RWA_MOCKS_PATH) ? "reuse + verify" : "deploy"}`);
  for (const marketId of markets) {
    const market = manifest.markets.find((candidate) => candidate.id === marketId)!;
    let priceId = "missing";
    try {
      priceId = priceIdForMarket(manifest, marketId);
    } catch {
      // The plan should remain printable before operators populate feed ids.
    }
    const action = market.contracts
      ? "already staged; verify and skip"
      : readSidecar(marketId)
        ? "merge existing sidecar, verify, keep disabled"
        : "deploy market, verify, keep disabled";
    console.log(`[rwa-deploy] ${marketId}: ${action}; pyth=${priceId}`);
  }
  console.log("[rwa-deploy] run pnpm deploy:rwa:testnet to broadcast the reviewed market set");
}

async function runForge(
  processes: ProcManager,
  name: string,
  script: string,
  env: Record<string, string>,
): Promise<void> {
  await processes.run(
    name,
    "forge",
    [
      "script",
      script,
      "--rpc-url",
      requireEnv("RPC_URL"),
      "--broadcast",
      "--legacy",
      "--with-gas-price",
      "200000000",
      "--retries",
      "12",
      "--delay",
      "5",
      "--slow",
    ],
    { cwd: PROTOCOL_DIR, env, timeoutMs: 20 * 60_000 },
  );
}

async function ensureMocks(
  processes: ProcManager,
  manifest: ManifestFile,
): Promise<RwaMocksFile> {
  const client = makeTestnetClient();
  const existing = readRwaMocks();
  if (existing) {
    await verifyMocks(client, manifest, existing);
    console.log("[rwa-deploy] verified existing RWA mock deployment");
    return existing;
  }
  await runForge(processes, "deploy-rwa-mocks", "script/DeployRwaMocks.s.sol", {
    PRIVATE_KEY: requireEnv("PRIVATE_KEY"),
  });
  const deployed = readRwaMocks();
  if (!deployed) throw new Error("DeployRwaMocks completed without writing 97-rwa-mocks.json");
  await verifyMocks(client, manifest, deployed);
  console.log("[rwa-deploy] deployed and verified RWA mocks");
  return deployed;
}

async function deploy(): Promise<void> {
  loadTestnetEnv();
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }
  let manifest = readTestnetManifest();
  if (!options.broadcast) {
    dryRun(manifest, options.markets);
    return;
  }

  // Resolve every required ID before sending the first transaction.
  const priceIds = new Map<RwaMarketId, string>();
  for (const marketId of options.markets) {
    const market = manifest.markets.find((candidate) => candidate.id === marketId)!;
    if (!market.contracts) priceIds.set(marketId, priceIdForMarket(manifest, marketId));
  }

  const client = makeTestnetClient();
  const deployments = requireTestnetDeployments();
  await assertTestnetChain(client);
  const authority = await verifyDeploymentAuthority(client, deployments);
  const pyth = getDeployedAddress(deployments, "pyth");
  const pythCode = await client.getCode({ address: pyth });
  if (!pythCode || pythCode === "0x") throw new Error(`configured Pyth contract has no code at ${pyth}`);
  console.log(
    `[rwa-deploy] preflight passed deployer=${authority.deployer} ` +
      `balance=${formatEther(authority.deployerBalance)} tBNB feedSigner=${authority.feedSigner} ` +
      `balance=${formatEther(authority.feedSignerBalance)} tBNB`,
  );
  if (!authority.feedSignerReady) {
    console.warn(
      `[rwa-deploy] WARNING: feed signer needs at least ` +
        `${formatEther(authority.minimumFeedSignerBalance)} tBNB before activation; ` +
        `deployment will continue because new markets remain disabled`,
    );
  }

  const processes = new ProcManager();
  const mocks = await ensureMocks(processes, manifest);
  const report: Record<string, unknown> = {
    chainId: 97,
    generatedAt: new Date().toISOString(),
    deployer: authority.deployer,
    feedSigner: authority.feedSigner,
    mocks,
    markets: {},
  };

  for (const marketId of options.markets) {
    const token = mockAddress(mocks, marketId);
    let market = manifest.markets.find((candidate) => candidate.id === marketId)!;
    if (market.contracts) {
      if (!market.collateral.address || !sameAddress(market.collateral.address, token)) {
        throw new Error(`${marketId} manifest collateral does not match the testnet mock artifact`);
      }
      await verifyMarket(client, deployments, market);
      console.log(`[rwa-deploy] ${marketId} already staged and verified; skipping`);
    } else {
      let sidecar = readSidecar(marketId);
      if (!sidecar) {
        const priceId = priceIds.get(marketId);
        if (!priceId) throw new Error(`${marketId} is missing its Pyth price id`);
        await runForge(processes, `add-market-${marketId.toLowerCase()}`, "script/AddMarket.s.sol", {
          PRIVATE_KEY: requireEnv("PRIVATE_KEY"),
          MARKET_ID: marketId,
          FEED_SIGNER: getDeployedAddress(deployments, "feedSigner"),
          [TOKEN_ENV_BY_MARKET[marketId]]: token,
          [`${marketId}_PYTH_PRICE_ID`]: priceId,
        });
        sidecar = readSidecar(marketId);
        if (!sidecar) throw new Error(`${marketId} deployment completed without writing its sidecar`);
      }
      if (!sameAddress(sidecar.underlying, token)) {
        throw new Error(`${marketId} sidecar underlying does not match the RWA mock artifact`);
      }
      const configuredId = priceIdForMarket(manifest, marketId);
      if (sidecar.pythPriceId.toLowerCase() !== configuredId.toLowerCase()) {
        throw new Error(`${marketId} sidecar Pyth id does not match the reviewed configuration`);
      }
      manifest = mergeSidecarIntoManifest(manifest, marketId, sidecar);
      writeJsonAtomic(TESTNET_MANIFEST_PATH, manifest);
      market = manifest.markets.find((candidate) => candidate.id === marketId)!;
      await verifyMarket(client, deployments, market);
      console.log(`[rwa-deploy] ${marketId} staged, verified, and left disabled`);
    }
    (report.markets as Record<string, unknown>)[marketId] = market;
  }

  writeJsonAtomic(DEPLOYMENT_REPORT_PATH, report);
  console.log(`[rwa-deploy] report written to ${DEPLOYMENT_REPORT_PATH}`);
  console.log("[rwa-deploy] no RWA market was enabled; activate one explicitly after oracle readiness checks");
}

deploy().catch((error) => {
  console.error(`[rwa-deploy] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
