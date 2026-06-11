import { privateKeyToAccount } from "viem/accounts";
import { AuctionEngine } from "./auction.js";
import { makeViemChain } from "./chain.js";
import { loadConfig } from "./config.js";
import { Executor } from "./executor.js";
import { RfqEngineServer } from "./server.js";
import { InMemoryRfqStore } from "./store.js";

export * from "./types.js";
export * from "./store.js";
export * from "./chain.js";
export * from "./quotes.js";
export * from "./auction.js";
export * from "./executor.js";
export * from "./server.js";
export * from "./config.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const account = privateKeyToAccount(config.executorPrivateKey);

  const { reader, submitter } = makeViemChain({
    chainId: config.chainId,
    rpcUrl: config.rpcUrl,
    account,
    addresses: {
      matching: config.matching,
      subAccounts: config.subAccounts,
      cashAsset: config.cashAsset,
    },
  });

  // The executor key must be a registered trade executor on Matching,
  // otherwise every verifyAndMatch will revert with M_OnlyTradeExecutor.
  const isExecutor = await reader.isTradeExecutor(account.address);
  if (!isExecutor) {
    throw new Error(
      `${account.address} is not a registered trade executor on Matching ${config.matching} ` +
        `(chain ${config.chainId}). Set EXECUTOR_PRIVATE_KEY to the registered key ` +
        `(deployments JSON field "tradeExecutor").`,
    );
  }

  const engine = new AuctionEngine({
    store: new InMemoryRfqStore(),
    chainReader: reader,
    executor: new Executor(submitter),
    chainId: config.chainId,
    matching: config.matching,
    rfqModule: config.rfqModule,
    optionAssets: config.optionAssets,
    auctionWindowMs: config.auctionWindowMs,
  });

  const server = new RfqEngineServer({ engine, port: config.port });
  const { port } = await server.start();

  // eslint-disable-next-line no-console
  console.log(
    `rfq-engine listening on :${port} ` +
      `(chain ${config.chainId}, rpc ${config.rpcUrl}, executor ${account.address}, ` +
      `auction window ${config.auctionWindowMs}ms)\n` +
      `  REST: POST /rfq | GET /rfq/:id | POST /rfq/:id/accept | GET /health\n` +
      `  WS:   /maker (auth handshake -> RFQ stream + quotes) | /taker`,
  );

  const shutdown = async () => {
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
