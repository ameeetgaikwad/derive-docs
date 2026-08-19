import "dotenv/config";

import { lyraSpotFeedAbi, resolveAccount } from "@hedge/shared";
import { AuctionEngine } from "./auction.js";
import { makeViemChain } from "./chain.js";
import { loadConfig } from "./config.js";
import { Executor } from "./executor.js";
import { RfqEngineServer } from "./server.js";
import { InMemoryRfqStore, JsonlRfqStore } from "./store.js";
import { assertMarketFeedsReady, marketFeedUpdatedAt, marketStatus } from "./markets.js";
import { DynamoDbSubaccountDirectoryStore } from "./dynamodb-subaccount-directory.js";
import {
  StoredSubaccountDirectoryReader,
  SubaccountDirectoryIndexer,
  type DirectoryNetwork,
} from "./subaccount-directory.js";
import { SubaccountDirectoryWorker } from "./subaccount-directory-worker.js";
import { ViemDirectoryChainReader } from "./viem-subaccount-directory.js";
import { WithdrawalEngine } from "./withdrawal.js";
import { ViemWithdrawalGateway } from "./withdrawal-gateway.js";
import {
  InMemoryWithdrawalOperationStore,
  JsonlWithdrawalOperationStore,
} from "./withdrawal-store.js";
import type { WithdrawalAssetDefinition } from "./withdrawal-types.js";
import { AccountLock } from "./account-lock.js";

export * from "./types.js";
export * from "./store.js";
export * from "./chain.js";
export * from "./quotes.js";
export * from "./auction.js";
export * from "./executor.js";
export * from "./server.js";
export * from "./config.js";
export * from "./markets.js";
export * from "./subaccount-directory.js";
export * from "./subaccount-directory-worker.js";
export * from "./viem-subaccount-directory.js";
export * from "./dynamodb-subaccount-directory.js";
export * from "./withdrawal-types.js";
export * from "./withdrawal-store.js";
export * from "./withdrawal-gateway.js";
export * from "./withdrawal.js";
export * from "./account-lock.js";

async function main(): Promise<void> {
  const config = loadConfig();
  // KMS-backed when EXECUTOR_KMS_KEY_ID is set; raw EXECUTOR_PRIVATE_KEY otherwise.
  const account = await resolveAccount({
    role: "EXECUTOR",
    privateKey: config.executorPrivateKey,
  });

  const { reader, submitter, publicClient } = makeViemChain({
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    account,
    addresses: {
      matching: config.matching,
      subAccounts: config.subAccounts,
      cashAsset: config.cashAsset,
      srmViewer: config.srmViewer,
      standardManager: config.standardManager,
    },
  });

  // The executor key must be a registered trade executor on Matching,
  // otherwise every verifyAndMatch will revert with M_OnlyTradeExecutor.
  const isExecutor = await reader.isTradeExecutor(account.address);
  if (!isExecutor) {
    throw new Error(
      `${account.address} is not a registered trade executor on Matching ${config.matching} ` +
        `(chain ${config.chainId}). Set EXECUTOR_PRIVATE_KEY (or EXECUTOR_KMS_KEY_ID) to ` +
        `the registered key (deployments JSON field "tradeExecutor"), or register this ` +
        `address via Matching.setTradeExecutor.`,
    );
  }

  const store = config.storePath ? new JsonlRfqStore(config.storePath) : new InMemoryRfqStore();

  let directoryWorker: SubaccountDirectoryWorker | null = null;
  let subaccountDirectory: StoredSubaccountDirectoryReader | undefined;
  if (config.subaccountDirectory) {
    const network: DirectoryNetwork = {
      chainId: config.chainId,
      matching: config.matching,
      deploymentBlock: config.subaccountDirectory.deploymentBlock,
    };
    const directoryStore = new DynamoDbSubaccountDirectoryStore(
      config.subaccountDirectory.tableName,
    );
    const directoryIndexer = new SubaccountDirectoryIndexer({
      network,
      chain: new ViemDirectoryChainReader(publicClient, config.matching),
      store: directoryStore,
      confirmationBlocks: config.subaccountDirectory.confirmationBlocks,
      chunkSize: config.subaccountDirectory.chunkSize,
    });
    subaccountDirectory = new StoredSubaccountDirectoryReader(network, directoryStore);
    directoryWorker = new SubaccountDirectoryWorker(
      directoryIndexer,
      config.subaccountDirectory.pollMs,
      (error) => {
        // Keep RFQ execution available: the browser treats directory failures as
        // unavailable and falls back to a wallet-filtered RPC scan.
        // eslint-disable-next-line no-console
        console.error("subaccount directory sync failed:", error);
      },
    );
  }

  const accountLock = new AccountLock();
  const engine = new AuctionEngine({
    store,
    chainReader: reader,
    executor: new Executor(submitter),
    chainId: config.chainId,
    matching: config.matching,
    rfqModule: config.rfqModule,
    optionAssets: config.optionAssets,
    forwardFeeds: config.forwardFeeds,
    markets: config.markets,
    marketReadiness: (market, expiry, strike, rawAmount) =>
      assertMarketFeedsReady(publicClient, market, expiry, strike, rawAmount),
    auctionWindowMs: config.auctionWindowMs,
    acceptDeadlineMs: config.takerAcceptDeadlineMs,
    accountLock,
  });

  const withdrawalAssets: WithdrawalAssetDefinition[] = [
    {
      assetId: "cash",
      kind: "cash",
      marketId: null,
      symbol: "Cash",
      assetAddress: config.cashAsset,
      configuredTokenAddress: config.cashToken,
      // CashAsset supports whatever native decimals its configured stablecoin
      // exposes. The gateway validates/read-backs the live ERC-20 value at
      // startup and every preview keeps amounts in those native units.
      configuredTokenDecimals: null,
      scaledUi: false,
    },
    ...config.markets
      // Disabled trading markets remain exit-enabled so collateral is never trapped.
      .filter((market) => market.contracts !== null && market.collateral.address !== null)
      .map((market): WithdrawalAssetDefinition => ({
        assetId: `market:${market.id}`,
        kind: "market-collateral",
        marketId: market.id,
        symbol: market.collateral.symbol,
        assetAddress: market.contracts!.baseAsset,
        configuredTokenAddress: market.collateral.address,
        configuredTokenDecimals: market.collateral.decimals,
        scaledUi: market.collateral.scaledUi,
      })),
  ];
  const withdrawalStore = config.fundsStorePath
    ? new JsonlWithdrawalOperationStore(config.fundsStorePath)
    : new InMemoryWithdrawalOperationStore();
  const withdrawalGateway = new ViemWithdrawalGateway(publicClient, submitter, {
    matching: config.matching,
    withdrawalModule: config.withdrawalModule,
    subAccounts: config.subAccounts,
    standardManager: config.standardManager,
    cashAsset: config.cashAsset,
  });
  if (config.withdrawalsEnabled) {
    await withdrawalGateway.validateConfiguration(withdrawalAssets);
  }
  const withdrawals = new WithdrawalEngine({
    chainId: config.chainId,
    matching: config.matching,
    withdrawalModule: config.withdrawalModule,
    standardManager: config.standardManager,
    assets: withdrawalAssets,
    gateway: withdrawalGateway,
    store: withdrawalStore,
    reservedCash: (subaccountId) => engine.reservedFor(subaccountId),
    accountLock,
  });

  if (config.storePath) {
    const recovered = await engine.recover();
    // eslint-disable-next-line no-console
    console.log(
      `rfq-engine store ${config.storePath}: recovered ` +
        `${recovered.rearmed} re-armed, ${recovered.closed} closed, ` +
        `${recovered.expired} expired, ${recovered.resolved} reconciled, ` +
        `${recovered.unresolved} unresolved-in-flight`,
    );
  }
  if (config.fundsStorePath) {
    const withdrawalRecovery = await withdrawals.recover();
    // eslint-disable-next-line no-console
    console.log(
      `withdrawal store ${config.fundsStorePath}: ` +
        `${withdrawalRecovery.confirmed} confirmed, ${withdrawalRecovery.reverted} reverted, ` +
        `${withdrawalRecovery.expired} expired, ${withdrawalRecovery.unknown} unknown, ` +
        `${withdrawalRecovery.pending} pending`,
    );
  }

  const server = new RfqEngineServer({
    engine,
    chainId: config.chainId,
    host: config.host,
    port: config.port,
    makerAllowlist: config.makerAllowlist,
    takerOpen: config.takerOpen,
    rfqRateLimitPerMin: config.rfqRateLimitPerMin,
    trustProxy: config.trustProxy,
    heartbeatMs: config.heartbeatMs,
    markets: config.markets,
    subaccountDirectory,
    withdrawals,
    withdrawalsEnabled: config.withdrawalsEnabled,
    withdrawalPreviewRateLimitPerMin: config.withdrawalPreviewRateLimitPerMin,
    withdrawalExecutionRateLimitPerMin: config.withdrawalExecutionRateLimitPerMin,
    marketStatusProvider: async (market) => {
      const status = marketStatus(market);
      if (status.status !== "open" || market.marketHours !== "24/5" || !market.contracts) {
        return status;
      }
      try {
        const [spot] = await publicClient.readContract({
          address: market.contracts.spotFeed,
          abi: lyraSpotFeedAbi,
          functionName: "getSpot",
        });
        const expiry = status.supportedExpiries[0];
        if (!expiry) throw new Error("no supported expiry is available");
        await assertMarketFeedsReady(publicClient, market, BigInt(expiry), spot);
        return { ...status, feedUpdatedAt: await marketFeedUpdatedAt(publicClient, market) };
      } catch (error) {
        return {
          ...status,
          status: "closed" as const,
          disableReason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
  const { port } = await server.start();
  directoryWorker?.start();

  // eslint-disable-next-line no-console
  console.log(
    `rfq-engine listening on ${config.host}:${port} ` +
      `(chain ${config.chainId}, rpc ${config.rpcUrl}, executor ${account.address}, ` +
      `auction window ${config.auctionWindowMs}ms, accept deadline ${config.takerAcceptDeadlineMs}ms, ` +
      `heartbeat ${config.heartbeatMs}ms, ` +
      `makers ${config.makerAllowlist.length > 0 ? `allowlist[${config.makerAllowlist.length}]` : "open"}, ` +
      `store ${config.storePath ?? "in-memory"}, ` +
      `directory ${config.subaccountDirectory?.tableName ?? "disabled"})\n` +
      `  REST: POST /rfq | GET /rfq/:id | POST /rfq/:id/accept | POST /withdrawals/preview | ` +
      `POST /withdrawals | POST /withdrawals/:id/submit | GET /withdrawals/:id | GET /subaccounts | GET /health\n` +
      `  WS:   /maker (auth handshake -> RFQ stream + quotes) | /taker`,
  );

  const shutdown = async () => {
    directoryWorker?.stop();
    await server.stop().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Run only when invoked directly (node dist/index.js / tsx src/index.ts)
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "");
if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error("rfq-engine failed to start:", err);
    process.exit(1);
  });
}
