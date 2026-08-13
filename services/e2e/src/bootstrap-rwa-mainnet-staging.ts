#!/usr/bin/env node
import { formatEther } from "viem";
import { getDeployedAddress, makeWalletClient } from "@hedge/shared";
import {
  fetchHermesUpdates,
  formatPythPrice,
  getPythPusherAccount,
  oracleSignerReadiness,
  pythAbi,
  pushPythUpdates,
  type PythBatchAddresses,
} from "@hedge/oracle-feeds";
import { marketFromManifest } from "./rwa-testnet.js";
import {
  assertStagingChain,
  loadMainnetStagingEnv,
  makeStagingClient,
  readPythBinding,
  readPythHealth,
  readStagingManifest,
  requireEnv,
  requireStagingHermes,
  requireStagingDeployments,
  requireStagingRwaMarket,
  verifyStagingMarket,
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
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--broadcast") broadcast = true;
    else if (arg === "--confirm") confirm = true;
    else if (arg === "--help" || arg === "-h") help = true;
    else if (arg === "--market") market = argv[++index];
    else if (arg.startsWith("--market=")) market = arg.slice("--market=".length);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (help) return { help: true };
  if (broadcast !== confirm) throw new Error("a broadcast requires both --broadcast and --confirm");
  return { market: requireStagingRwaMarket(market), broadcast, confirm, help: false };
}

function usage(): void {
  console.log(`Push one fresh Pyth source into a deployed, disabled chain-56 staging market.

Usage:
  pnpm bootstrap:rwa:mainnet-staging --market XAU
  pnpm bootstrap:rwa:mainnet-staging --market XAU --broadcast --confirm

This verifies the staged contracts and exact Pyth binding, rejects stale Hermes
data, checks pusher gas, submits one update, and verifies adapter freshness. It
does not enable the market or publish signed forward/vol/rate feeds.`);
}

function maximumAge(): bigint {
  const raw = process.env.ACTIVATION_MAX_PYTH_AGE_SEC?.trim() ?? "45";
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n || BigInt(raw) >= 60n) {
    throw new Error("ACTIVATION_MAX_PYTH_AGE_SEC must be between 1 and 59 seconds");
  }
  return BigInt(raw);
}

async function bootstrap(): Promise<void> {
  loadMainnetStagingEnv();
  const options = parseOptions(process.argv.slice(2));
  if (options.help) return usage();

  const manifest = readStagingManifest();
  const market = marketFromManifest(manifest, options.market);
  if (!market.contracts || !market.collateral.address || !market.pythPriceId) {
    throw new Error(`${market.id} is not staged; run the staging deploy command first`);
  }
  if (market.enabled) {
    throw new Error(`${market.id} is already enabled; let the singleton oracle task update it`);
  }

  const deployments = requireStagingDeployments();
  const client = makeStagingClient();
  await assertStagingChain(client);
  await verifyStagingMarket(client, deployments, market);
  const binding = await readPythBinding(client, market);
  const pyth = getDeployedAddress(deployments, "pyth");
  const batch: PythBatchAddresses = {
    pyth,
    markets: [{ marketId: market.id, priceId: binding.priceId, adapter: binding.adapter }],
  };

  const hermesUrl = requireStagingHermes();
  const hermes = await fetchHermesUpdates([binding.priceId], hermesUrl);
  const price = hermes.prices.get(binding.priceId.toLowerCase());
  if (!price || BigInt(price.price) <= 0n || price.publishTime <= 0) {
    throw new Error(`Hermes did not return a positive ${market.id} source price`);
  }
  const block = await client.getBlock();
  const publishTime = BigInt(price.publishTime);
  const age = block.timestamp > publishTime ? block.timestamp - publishTime : 0n;
  console.log(
    `[rwa-staging-bootstrap] Hermes ${market.id} price=` +
      `${formatPythPrice(price.price, price.expo)} publishTime=${price.publishTime} age=${age}s`,
  );
  if (age > maximumAge()) {
    throw new Error(`${market.id} Hermes source is stale (${age}s); refusing to broadcast`);
  }

  const fee = await client.readContract({
    address: pyth,
    abi: pythAbi,
    functionName: "getUpdateFee",
    args: [hermes.data],
  });
  await client.simulateContract({
    address: pyth,
    abi: pythAbi,
    functionName: "updatePriceFeeds",
    args: [hermes.data],
    value: fee,
  });
  console.log(`[rwa-staging-bootstrap] upgraded Pyth simulation passed fee=${fee} wei`);

  if (!options.broadcast) {
    console.log(`[rwa-staging-bootstrap] DRY RUN — ${market.id} remains disabled; no transaction sent`);
    return;
  }

  const account = await getPythPusherAccount(56);
  const minimumBalance = BigInt(process.env.ORACLE_MIN_SIGNER_BALANCE_WEI ?? "5000000000000000");
  const readiness = await oracleSignerReadiness(client, account.address, minimumBalance);
  if (!readiness.ready) {
    throw new Error(
      `Pyth pusher ${account.address} has ${readiness.balance} wei; need ${readiness.minimumBalance}`,
    );
  }
  console.log(
    `[rwa-staging-bootstrap] pusher=${account.address} balance=${formatEther(readiness.balance)} BNB`,
  );

  const wallet = makeWalletClient(account, { chainId: 56, rpcUrl: requireEnv("RPC_URL") });
  const pushed = await pushPythUpdates({
    publicClient: client,
    walletClient: wallet,
    account,
    addresses: batch,
    hermesUrl,
  });
  console.log(`[rwa-staging-bootstrap] update mined: ${pushed.txHash}`);

  const updatedBlock = await client.getBlock();
  const health = await readPythHealth(client, market);
  const updatedAge = updatedBlock.timestamp > health.publishTime
    ? updatedBlock.timestamp - health.publishTime
    : 0n;
  if (health.price <= 0n || health.publishTime === 0n || updatedAge > maximumAge()) {
    throw new Error(`${market.id} adapter is not fresh after the update (${updatedAge}s)`);
  }
  console.log(
    `[rwa-staging-bootstrap] ${market.id} fresh age=${updatedAge}s adapter=${health.adapter}; ` +
      "market remains disabled",
  );
}

bootstrap().catch((error) => {
  console.error(`[rwa-staging-bootstrap] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
