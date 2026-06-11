#!/usr/bin/env node
/**
 * hedge E2E acceptance (SPEC.md "E2E acceptance", run on anvil 31337):
 *
 *   fresh anvil -> forge DeployAll -> oracle-feeds posts spot/forward/vol/rate
 *   (+ USDT stable feed) -> maker & taker EOAs funded with mock USDT/BTCB ->
 *   maker-bot --setup opens + funds the maker subaccount, harness opens the
 *   taker subaccount and deposits 1 BTCB -> rfq-engine + maker-bot up ->
 *   POST /rfq (sell 1x BTC 110k call, 7d) -> bot quotes (Black-76 on the
 *   posted feeds) -> taker signs TakerOrder -> engine executes
 *   Matching.verifyAndMatch on-chain -> balance assertions (option/cash/BTCB,
 *   OI fees, SRM margin) -> evm_snapshot -> warp + settle OTM -> evm_revert ->
 *   warp + settle ITM -> final balance assertions.
 *
 * One command: `pnpm e2e` (from services/e2e). Results: protocol/E2E.md.
 * Every spawned process (anvil, rfq-engine, maker-bot) is killed on exit.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTestClient,
  http,
  toHex,
  type Address,
  type Hex,
  type PublicClient,
  type TestClient,
  type WalletClient,
} from "viem";
import { mnemonicToAccount, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  buildAction,
  encodeOptionSubId,
  encodeSpotData,
  encodeTakerOrder,
  fromUnit,
  getDeployedAddress,
  lyraForwardFeedAbi,
  lyraSpotFeedAbi,
  makePublicClient,
  makeWalletClient,
  matchingAbi,
  mockErc20Abi,
  readDeployments,
  signAction,
  signFeedData,
  standardManagerAbi,
  subAccountsAbi,
  toUnit,
  wrappedErc20AssetAbi,
  type DeploymentsFile,
} from "@hedge/shared";
import { FeedPoster, feedAddressesFromDeployments } from "@hedge/oracle-feeds";
import {
  assert,
  assertApprox,
  assertEq,
  httpJson,
  ProcManager,
  Report,
  sleep,
  waitFor,
  type StageLog,
} from "./util.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVICES_DIR = resolve(HERE, "..", "..");
const ROOT = resolve(SERVICES_DIR, "..");
const PROTOCOL_DIR = join(ROOT, "protocol");
const DEPLOYMENTS_DIR = join(PROTOCOL_DIR, "deployments");
const E2E_MD = join(PROTOCOL_DIR, "E2E.md");
const TMP_DIR = join(SERVICES_DIR, "e2e", ".tmp");

const CHAIN_ID = 31337;
const ANVIL_PORT = Number(process.env.ANVIL_PORT ?? 8545);
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;
const RFQ_PORT = Number(process.env.RFQ_PORT ?? 3030);
const ENGINE_URL = `http://127.0.0.1:${RFQ_PORT}`;

// anvil's default HD mnemonic — keys are DERIVED, never copied from memory.
const ANVIL_MNEMONIC =
  process.env.ANVIL_MNEMONIC ?? "test test test test test test test test test test test junk";

const SPOT = toUnit("100000"); // $100k spot & forward
const IV = toUnit("0.6"); // flat 60% vol surface
const RATE = toUnit("0.05"); // 5% annualized
const STRIKE = toUnit("110000"); // $110k call
const AMOUNT = toUnit("1"); // 1x option / 1 BTCB collateral
const MAKER_USDT_DEPOSIT = "150000"; // maker cash (token units, 18dp on BNB)
const OTM_SETTLEMENT = toUnit("90000"); // below strike -> option expires worthless
const ITM_SETTLEMENT = toUnit("130000"); // above strike -> payout 20k/option

// OI fee per DeployAll.s.sol: viewer rate 0.1e18, SRM minOIFee 10e18.
const OI_FEE_RATE = toUnit("0.1");
const MIN_OI_FEE = toUnit("10");
const ONE = 10n ** 18n;

// interest accrues on the taker's borrow during the 7-day warp; settlement
// cash assertions use this absolute tolerance (USDT, 18dp).
const SETTLE_TOL = toUnit("25");

// ---------------------------------------------------------------------------
// Accounts (derived from the anvil mnemonic — see oracle-feeds report on
// why hardcoded "well-known key" strings are dangerous)
// ---------------------------------------------------------------------------

function anvilKey(index: number): Hex {
  const hd = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index });
  const pk = hd.getHdKey().privateKey;
  if (!pk) throw new Error(`cannot derive anvil key #${index}`);
  return toHex(pk);
}

const DEPLOYER_KEY = anvilKey(0); // deployer == feedSigner == tradeExecutor
const MAKER_KEY = anvilKey(1);
const TAKER_KEY = anvilKey(2);
const deployer = privateKeyToAccount(DEPLOYER_KEY);
const maker = privateKeyToAccount(MAKER_KEY);
const taker = privateKeyToAccount(TAKER_KEY);

// ---------------------------------------------------------------------------
// Chain helpers
// ---------------------------------------------------------------------------

interface Ctx {
  procs: ProcManager;
  report: Report;
  publicClient: PublicClient;
  testClient: TestClient;
  deployerWallet: WalletClient;
  takerWallet: WalletClient;
  d: DeploymentsFile;
  addr: (key: string) => Address;
  poster: FeedPoster;
  expiry: bigint;
  subId: bigint;
  makerSubaccount: bigint;
  takerSubaccount: bigint;
  feeRecipientSubaccount: bigint;
}

async function writeTx(
  ctx: Ctx,
  wallet: WalletClient,
  account: PrivateKeyAccount,
  params: { address: Address; abi: readonly unknown[]; functionName: string; args: unknown[] },
): Promise<Hex> {
  const hash = await wallet.writeContract({
    address: params.address,
    abi: params.abi as never,
    functionName: params.functionName as never,
    args: params.args as never,
    account,
    chain: wallet.chain ?? null,
  });
  const receipt = await ctx.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`${params.functionName} reverted (tx ${hash})`);
  }
  return hash;
}

async function getBalance(ctx: Ctx, sub: bigint, asset: Address, subId: bigint): Promise<bigint> {
  return ctx.publicClient.readContract({
    address: ctx.addr("subAccounts"),
    abi: subAccountsAbi,
    functionName: "getBalance",
    args: [sub, asset, subId],
  }) as Promise<bigint>;
}

interface Balances {
  takerCash: bigint;
  takerBase: bigint;
  takerOption: bigint;
  makerCash: bigint;
  makerOption: bigint;
  feeRecipientCash: bigint;
}

async function readBalances(ctx: Ctx): Promise<Balances> {
  const cash = ctx.addr("cashAsset");
  const base = ctx.addr("btcBaseAsset");
  const option = ctx.addr("btcOptionAsset");
  const [takerCash, takerBase, takerOption, makerCash, makerOption, feeRecipientCash] =
    await Promise.all([
      getBalance(ctx, ctx.takerSubaccount, cash, 0n),
      getBalance(ctx, ctx.takerSubaccount, base, 0n),
      getBalance(ctx, ctx.takerSubaccount, option, ctx.subId),
      getBalance(ctx, ctx.makerSubaccount, cash, 0n),
      getBalance(ctx, ctx.makerSubaccount, option, ctx.subId),
      getBalance(ctx, ctx.feeRecipientSubaccount, cash, 0n),
    ]);
  return { takerCash, takerBase, takerOption, makerCash, makerOption, feeRecipientCash };
}

function balanceTable(stage: StageLog, label: string, b: Balances): void {
  stage.note(`Balances — ${label}:`);
  stage.table(
    ["subaccount", "USDT cash", "BTCB", "option (BTC call)"],
    [
      ["taker", fromUnit(b.takerCash), fromUnit(b.takerBase), fromUnit(b.takerOption)],
      ["maker", fromUnit(b.makerCash), "0", fromUnit(b.makerOption)],
      ["fee recipient (3)", fromUnit(b.feeRecipientCash), "0", "0"],
    ],
  );
}

// ---------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------

async function stageAnvilAndDeploy(procs: ProcManager, report: Report): Promise<Ctx> {
  const stage = report.stage("fresh anvil + DeployAll.s.sol");

  // refuse to run if the ports are taken (we must not kill processes we did not start)
  for (const [port, what] of [
    [ANVIL_PORT, "anvil"],
    [RFQ_PORT, "rfq-engine"],
  ] as const) {
    const busy = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(700) })
      .then(() => true)
      .catch(() => false);
    if (busy) throw new Error(`port ${port} (${what}) is already in use — stop that process first`);
  }

  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });

  procs.spawnProc("anvil", "anvil", ["--port", String(ANVIL_PORT), "--chain-id", String(CHAIN_ID)], {
    quiet: true,
  });
  await waitFor("anvil RPC", async () => {
    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    const j = (await res.json()) as { result?: string };
    return j.result === "0x7a69";
  });
  stage.note(`anvil up on ${RPC_URL} (chainId ${CHAIN_ID})`);

  // deploy — run as an awaited foreground child (see contracts report re: automine)
  await procs.run(
    "forge-deploy",
    "forge",
    ["script", "script/DeployAll.s.sol", "--rpc-url", RPC_URL, "--broadcast"],
    { cwd: PROTOCOL_DIR, env: { PRIVATE_KEY: DEPLOYER_KEY }, quiet: true, timeoutMs: 240_000 },
  );

  const d = readDeployments(CHAIN_ID);
  if (!d) throw new Error("deployments/31337.json missing after deploy");
  const addr = (key: string) => getDeployedAddress(d, key);

  // sanity: derived key #0 matches the deployer recorded by the script
  assertEq(BigInt(deployer.address), BigInt(addr("deployer")), "derived anvil key #0 address");

  const publicClient = makePublicClient({ chainId: CHAIN_ID, rpcUrl: RPC_URL });
  const onchainDomain = (await publicClient.readContract({
    address: addr("matching"),
    abi: matchingAbi,
    functionName: "domainSeparator",
  })) as Hex;
  assert(
    onchainDomain.toLowerCase() === String(d.matchingDomainSeparator).toLowerCase(),
    `Matching.domainSeparator on-chain ${onchainDomain} != deployments JSON ${d.matchingDomainSeparator}`,
  );
  stage.note(`deployments/31337.json written; Matching domain separator verified on-chain (\`${onchainDomain}\`)`);
  stage.note(`- Matching: \`${addr("matching")}\` RfqModule: \`${addr("rfqModule")}\``);
  stage.note(`- OptionAsset: \`${addr("btcOptionAsset")}\` CashAsset: \`${addr("cashAsset")}\` BTCB base: \`${addr("btcBaseAsset")}\``);

  const block = await publicClient.getBlock();
  const expiry = block.timestamp + 7n * 86400n; // 7-day expiry
  const subId = encodeOptionSubId({ expiry, strike: STRIKE, isCall: true });
  stage.note(`option: BTC call, strike ${fromUnit(STRIKE)}, expiry ${expiry} (chain now + 7d), subId ${subId}`);

  const testClient = createTestClient({ mode: "anvil", chain: foundry, transport: http(RPC_URL) });
  const deployerWallet = makeWalletClient(deployer, { chainId: CHAIN_ID, rpcUrl: RPC_URL });
  const takerWallet = makeWalletClient(taker, { chainId: CHAIN_ID, rpcUrl: RPC_URL });

  process.env.SATS_DEPLOYMENTS_DIR = DEPLOYMENTS_DIR;
  process.env.RPC_URL = RPC_URL;
  process.env.CHAIN_ID = String(CHAIN_ID);
  const poster = new FeedPoster(
    publicClient,
    deployerWallet,
    deployer,
    CHAIN_ID,
    feedAddressesFromDeployments(CHAIN_ID),
  );

  const ctx: Ctx = {
    procs,
    report,
    publicClient,
    testClient,
    deployerWallet,
    takerWallet,
    d,
    addr,
    poster,
    expiry,
    subId,
    makerSubaccount: 0n,
    takerSubaccount: 0n,
    feeRecipientSubaccount: BigInt(String(d.feeRecipientSubAccount ?? 3)),
  };
  stage.status = "passed";
  return ctx;
}

/** USDT/USD stable feed (SRM depeg check reads it on every IM check). */
async function postStableFeed(ctx: Ctx): Promise<Hex> {
  const stableFeed = ctx.addr("stableFeed");
  const now = await ctx.poster.chainNow();
  const encoded = await signFeedData({
    kind: "spot", // the stable feed IS a LyraSpotFeed (domain LyraSpotFeed/1 at its own address)
    payload: {
      data: encodeSpotData({ price: toUnit("1"), confidence: toUnit("1") }),
      deadline: now + 3600n,
      timestamp: now,
    },
    signers: [deployer],
    chainId: CHAIN_ID,
    feedAddress: stableFeed,
  });
  return writeTx(ctx, ctx.deployerWallet, deployer, {
    address: stableFeed,
    abi: lyraSpotFeedAbi,
    functionName: "acceptData",
    args: [encoded],
  });
}

async function stageFeeds(ctx: Ctx): Promise<void> {
  const stage = ctx.report.stage("oracle-feeds: spot / forward / rate / vol (+ USDT stable)");

  const spotTx = await ctx.poster.postSpot(SPOT);
  stage.tx(`BTC spot = ${fromUnit(SPOT)}`, spotTx);
  const fwdTx = await ctx.poster.postForward(ctx.expiry, SPOT);
  stage.tx(`BTC forward(expiry) = ${fromUnit(SPOT)}`, fwdTx);
  const rateTx = await ctx.poster.postRate(ctx.expiry, RATE);
  stage.tx(`BTC rate(expiry) = ${fromUnit(RATE)}`, rateTx);
  const volTx = await ctx.poster.postFlatVol(ctx.expiry, IV, SPOT);
  stage.tx(`BTC vol surface flat IV = ${fromUnit(IV)} (SVI)`, volTx);
  const stableTx = await postStableFeed(ctx);
  stage.tx("USDT stable feed = 1.0", stableTx);

  // read-back verification
  const spot = await ctx.poster.readSpot();
  assertEq(spot, SPOT, "spot feed read-back");
  const fwd = await ctx.poster.readForward(ctx.expiry);
  assertEq(fwd, SPOT, "forward feed read-back");
  stage.note(`read-back OK: getSpot=${fromUnit(spot)}, getForwardPrice(${ctx.expiry})=${fromUnit(fwd)}`);
  stage.status = "passed";
}

async function stageFundAndSubaccounts(ctx: Ctx): Promise<void> {
  const stage = ctx.report.stage("fund EOAs + open maker/taker subaccounts");
  const usdt = ctx.addr("usdt");
  const btcb = ctx.addr("btcb");

  // mock tokens have open mint on anvil
  const mintUsdtTx = await writeTx(ctx, ctx.deployerWallet, deployer, {
    address: usdt,
    abi: mockErc20Abi,
    functionName: "mint",
    args: [maker.address, toUnit(MAKER_USDT_DEPOSIT)],
  });
  stage.tx(`mint ${MAKER_USDT_DEPOSIT} mock USDT -> maker EOA ${maker.address}`, mintUsdtTx);
  const mintBtcbTx = await writeTx(ctx, ctx.deployerWallet, deployer, {
    address: btcb,
    abi: mockErc20Abi,
    functionName: "mint",
    args: [taker.address, AMOUNT],
  });
  stage.tx(`mint 1 mock BTCB -> taker EOA ${taker.address}`, mintBtcbTx);

  // maker: the maker-bot's own --setup path (createSubAccount + USDT cash deposit)
  const stateFile = join(TMP_DIR, `maker-state.${CHAIN_ID}.json`);
  await ctx.procs.run("maker-setup", "node", [join(SERVICES_DIR, "maker-bot", "dist", "index.js"), "--setup"], {
    env: {
      PRIVATE_KEY: MAKER_KEY,
      RPC_URL,
      CHAIN_ID: String(CHAIN_ID),
      SATS_DEPLOYMENTS_DIR: DEPLOYMENTS_DIR,
      DEPOSIT_USDT: MAKER_USDT_DEPOSIT,
      MAKER_STATE_FILE: stateFile,
    },
    timeoutMs: 60_000,
  });
  const state = JSON.parse(readFileSync(stateFile, "utf8")) as { subaccountId: string };
  ctx.makerSubaccount = BigInt(state.subaccountId);
  stage.note(
    `maker-bot --setup: subaccount ${ctx.makerSubaccount} created under Matching, ${MAKER_USDT_DEPOSIT} USDT cash deposited`,
  );
  const makerCash = await getBalance(ctx, ctx.makerSubaccount, ctx.addr("cashAsset"), 0n);
  assertEq(makerCash, toUnit(MAKER_USDT_DEPOSIT), "maker cash after setup");

  // taker: Matching.createSubAccount(SRM) + 1 BTCB into WrappedERC20Asset
  const matching = ctx.addr("matching");
  const { result: takerSub, request } = await ctx.publicClient.simulateContract({
    address: matching,
    abi: matchingAbi,
    functionName: "createSubAccount",
    args: [ctx.addr("standardManager")],
    account: taker,
    chain: ctx.takerWallet.chain ?? undefined,
  });
  const createTx = await ctx.takerWallet.writeContract(request);
  await ctx.publicClient.waitForTransactionReceipt({ hash: createTx });
  ctx.takerSubaccount = takerSub as bigint;
  stage.tx(`taker Matching.createSubAccount(SRM) -> subaccount ${ctx.takerSubaccount}`, createTx);

  const owner = (await ctx.publicClient.readContract({
    address: matching,
    abi: matchingAbi,
    functionName: "subAccountToOwner",
    args: [ctx.takerSubaccount],
  })) as Address;
  assert(
    owner.toLowerCase() === taker.address.toLowerCase(),
    `Matching.subAccountToOwner(${ctx.takerSubaccount}) = ${owner}, expected taker ${taker.address}`,
  );

  const approveTx = await writeTx(ctx, ctx.takerWallet, taker, {
    address: btcb,
    abi: mockErc20Abi,
    functionName: "approve",
    args: [ctx.addr("btcBaseAsset"), AMOUNT],
  });
  stage.tx("taker BTCB.approve(WrappedERC20Asset)", approveTx);
  const depositTx = await writeTx(ctx, ctx.takerWallet, taker, {
    address: ctx.addr("btcBaseAsset"),
    abi: wrappedErc20AssetAbi,
    functionName: "deposit",
    args: [ctx.takerSubaccount, AMOUNT],
  });
  stage.tx("taker WrappedERC20Asset.deposit(1 BTCB) — covered-call collateral", depositTx);

  const takerBase = await getBalance(ctx, ctx.takerSubaccount, ctx.addr("btcBaseAsset"), 0n);
  assertEq(takerBase, AMOUNT, "taker BTCB subaccount balance");
  balanceTable(stage, "after setup", await readBalances(ctx));
  stage.status = "passed";
}

async function stageServicesUp(ctx: Ctx): Promise<void> {
  const stage = ctx.report.stage("rfq-engine + maker-bot up");

  ctx.procs.spawnProc("rfq-engine", "node", [join(SERVICES_DIR, "rfq-engine", "dist", "index.js")], {
    env: {
      RPC_URL,
      CHAIN_ID: String(CHAIN_ID),
      RFQ_PORT: String(RFQ_PORT),
      AUCTION_WINDOW_MS: "4000",
      SATS_DEPLOYMENTS_DIR: DEPLOYMENTS_DIR,
      EXECUTOR_PRIVATE_KEY: DEPLOYER_KEY, // registered trade executor
    },
  });
  await waitFor("rfq-engine /health", async () => {
    const { status } = await httpJson<{ ok: boolean }>("GET", `${ENGINE_URL}/health`);
    return status === 200;
  });
  stage.note(`rfq-engine healthy on ${ENGINE_URL} (executor = registered tradeExecutor ${deployer.address})`);

  ctx.procs.spawnProc("maker-bot", "node", [join(SERVICES_DIR, "maker-bot", "dist", "index.js")], {
    env: {
      PRIVATE_KEY: MAKER_KEY,
      RPC_URL,
      CHAIN_ID: String(CHAIN_ID),
      SATS_DEPLOYMENTS_DIR: DEPLOYMENTS_DIR,
      RFQ_ENGINE_WS: `ws://127.0.0.1:${RFQ_PORT}/maker`,
      MAKER_STATE_FILE: join(TMP_DIR, `maker-state.${CHAIN_ID}.json`),
      // no FORWARD_PRICE/IV overrides: the bot must price from the on-chain feeds
    },
  });
  await sleep(1500); // WS auth handshake; engine also replays open RFQs to late joiners
  stage.note("maker-bot connected (prices from on-chain feeds: forward/vol/rate — no env overrides)");
  stage.status = "passed";
}

interface BestQuote {
  maker: string;
  premium: string;
  totalPremium: string;
  orderHash: Hex;
  trades: { asset: string; subId: string; price: string; amount: string }[];
  actionExpiry: string;
}
interface RfqStatus {
  rfq: { id: string; status: string; instrument: { subId: string; name: string }; auctionEndsAt: number };
  quoteCount: number;
  bestQuote: BestQuote | null;
  execution: { txHash: string; status: string; blockNumber: string | null } | null;
  error: string | null;
}

async function stageAuction(ctx: Ctx): Promise<RfqStatus> {
  const stage = ctx.report.stage("RFQ auction: taker sells 1x BTC-110000-C (7d)");

  // spot heartbeat is 3 minutes — repost a fresh snapshot right before trading
  const spotTx = await ctx.poster.postSpot(SPOT);
  stage.tx("re-post BTC spot (3-minute heartbeat)", spotTx);

  const { status, json } = await httpJson<{ rfq: RfqStatus["rfq"] & { auctionEndsAt: number } }>(
    "POST",
    `${ENGINE_URL}/rfq`,
    {
      subaccountId: ctx.takerSubaccount.toString(),
      instrument: { asset: "BTC", expiry: Number(ctx.expiry), strike: "110000", isCall: true },
      amount: "1",
      direction: "sell",
    },
  );
  assert(status === 201, `POST /rfq -> ${status}: ${JSON.stringify(json)}`);
  const rfq = json.rfq;
  stage.note(`RFQ \`${rfq.id}\` opened: ${rfq.instrument.name}, auction window 4s`);
  assertEq(BigInt(rfq.instrument.subId), ctx.subId, "engine OptionEncoding subId vs local encoding");

  await sleep(Math.max(0, rfq.auctionEndsAt - Date.now()) + 1000);

  const res = await httpJson<RfqStatus>("GET", `${ENGINE_URL}/rfq/${rfq.id}`);
  assert(res.status === 200, `GET /rfq/${rfq.id} -> ${res.status}`);
  const st = res.json;
  assert(st.rfq.status === "closed", `auction status: expected closed, got ${st.rfq.status} (${st.error ?? ""})`);
  assert(st.quoteCount >= 1, `expected >= 1 quote, got ${st.quoteCount}`);
  assert(st.bestQuote !== null, "no best quote after auction close");
  const best = st.bestQuote!;

  const premium = BigInt(best.totalPremium);
  // sanity bounds around Black-76 (F=100k, K=110k, T=7/365, vol=0.6, r=0.05 -> theo ~543, bid=0.95x ~516)
  assert(
    premium >= toUnit("300") && premium <= toUnit("900"),
    `premium ${fromUnit(premium)} outside sanity bounds [300, 900] USDT`,
  );
  assert(best.trades.length === 1, `expected 1 trade leg, got ${best.trades.length}`);
  assertEq(BigInt(best.trades[0]!.subId), ctx.subId, "winning quote trade subId");
  assertEq(BigInt(best.trades[0]!.amount), AMOUNT, "winning quote trade amount (maker receives +1)");
  stage.note(
    `winning quote: maker \`${best.maker}\` premium ${fromUnit(premium)} USDT (orderHash \`${best.orderHash}\`)`,
  );
  stage.status = "passed";
  return st;
}

async function stageExecute(ctx: Ctx, st: RfqStatus): Promise<{ premium: bigint; post: Balances; fee: bigint }> {
  const stage = ctx.report.stage("execute on-chain via RfqModule (Matching.verifyAndMatch)");
  const best = st.bestQuote!;
  const premium = BigInt(best.totalPremium);

  const pre = await readBalances(ctx);
  balanceTable(stage, "before execution", pre);

  // taker signs TakerOrder{orderHash, maxFee} as an EIP-712 Action (domain Matching/1.0)
  const action = buildAction({
    subaccountId: ctx.takerSubaccount,
    module: ctx.addr("rfqModule"),
    data: encodeTakerOrder({ orderHash: best.orderHash, maxFee: 0n }),
    owner: taker.address,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 600),
  });
  const signature = await signAction({
    action,
    signer: taker,
    chainId: CHAIN_ID,
    matchingAddress: ctx.addr("matching"),
  });

  const res = await httpJson<{
    txHash: string;
    status: string;
    blockNumber: string | null;
    fill: { premium: string; totalPremium: string; makerSubaccountId: string; takerSubaccountId: string };
    error?: string;
  }>("POST", `${ENGINE_URL}/rfq/${st.rfq.id}/accept`, {
    action: {
      subaccountId: action.subaccountId.toString(),
      nonce: action.nonce.toString(),
      module: action.module,
      data: action.data,
      expiry: action.expiry.toString(),
      owner: action.owner,
      signer: action.signer,
    },
    signature,
  });
  assert(res.status === 200, `POST accept -> ${res.status}: ${JSON.stringify(res.json)}`);
  assert(res.json.status === "success", `execution status ${res.json.status}`);
  stage.tx(`verifyAndMatch executed (block ${res.json.blockNumber})`, res.json.txHash);

  // expected OI fee (charged to BOTH sides, paid to fee recipient subaccount):
  // max(|delta| * forward * 0.1, 10) per StandardManager/_payFee + SRMPortfolioViewer
  const [fwd] = (await ctx.publicClient.readContract({
    address: ctx.addr("btcForwardFeed"),
    abi: lyraForwardFeedAbi,
    functionName: "getForwardPrice",
    args: [ctx.expiry],
  })) as [bigint, bigint];
  let fee = (((AMOUNT * fwd) / ONE) * OI_FEE_RATE) / ONE;
  if (fee < MIN_OI_FEE) fee = MIN_OI_FEE;
  stage.note(`expected OI fee per side: ${fromUnit(fee)} USDT (rate 0.1 x forward ${fromUnit(fwd)}, min 10)`);

  const post = await readBalances(ctx);
  balanceTable(stage, "after execution", post);

  // option moved: taker -1, maker +1
  assertEq(post.takerOption, pre.takerOption - AMOUNT, "taker option balance -1");
  assertEq(post.makerOption, pre.makerOption + AMOUNT, "maker option balance +1");
  // collateral untouched
  assertEq(post.takerBase, AMOUNT, "taker BTCB collateral unchanged");
  // premium moved in cash, OI fee charged to both sides
  assertEq(post.takerCash, pre.takerCash + premium - fee, "taker cash = +premium - OI fee");
  assertEq(post.makerCash, pre.makerCash - premium - fee, "maker cash = -premium - OI fee");
  assertEq(
    post.feeRecipientCash,
    pre.feeRecipientCash + 2n * fee,
    "fee recipient cash = +2x OI fee",
  );

  // SRM margin checks pass (the tx succeeded; assert IM >= 0 explicitly too)
  for (const [name, sub] of [
    ["taker", ctx.takerSubaccount],
    ["maker", ctx.makerSubaccount],
  ] as const) {
    const margin = (await ctx.publicClient.readContract({
      address: ctx.addr("standardManager"),
      abi: standardManagerAbi,
      functionName: "getMargin",
      args: [sub, true],
    })) as bigint;
    assert(margin >= 0n, `${name} initial margin ${fromUnit(margin)} < 0`);
    stage.note(`SRM initial margin (${name} subaccount ${sub}): ${fromUnit(margin)} USDT (>= 0)`);
  }

  stage.status = "passed";
  return { premium, post, fee };
}

async function settleScenario(
  ctx: Ctx,
  label: string,
  settlementPrice: bigint,
  postTrade: Balances,
  expectedPayout: bigint, // cash maker receives / taker pays (0 for OTM)
): Promise<void> {
  const stage = ctx.report.stage(`settlement — ${label} (settle @ ${fromUnit(settlementPrice)})`);

  // warp past expiry
  await ctx.testClient.setNextBlockTimestamp({ timestamp: ctx.expiry + 60n });
  await ctx.testClient.mine({ blocks: 1 });
  const now = await ctx.poster.chainNow();
  assert(now >= ctx.expiry, `warp failed: chain time ${now} < expiry ${ctx.expiry}`);
  stage.note(`warped chain time to ${now} (expiry ${ctx.expiry} + 60s)`);

  // oracle-feeds settlement sequence: fresh spot -> forward settlement data (timestamp == expiry)
  const spotTx = await ctx.poster.postSpot(settlementPrice);
  stage.tx(`post spot = ${fromUnit(settlementPrice)}`, spotTx);
  const settleFeedTx = await ctx.poster.postSettlement(ctx.expiry, settlementPrice);
  stage.tx(`post forward-feed settlement data for expiry ${ctx.expiry}`, settleFeedTx);

  const fixed = await ctx.poster.readSettlementPrice(ctx.expiry);
  assert(fixed.settled, "forward feed did not register settlement data");
  assertEq(fixed.price, settlementPrice, "getSettlementPrice(expiry)");
  stage.note(`settlement price fixed on-chain: ${fromUnit(fixed.price)}`);

  // StandardManager.settleOptions (public) for both subaccounts
  for (const [name, sub] of [
    ["maker", ctx.makerSubaccount],
    ["taker", ctx.takerSubaccount],
  ] as const) {
    const tx = await writeTx(ctx, ctx.deployerWallet, deployer, {
      address: ctx.addr("standardManager"),
      abi: standardManagerAbi,
      functionName: "settleOptions",
      args: [ctx.addr("btcOptionAsset"), sub],
    });
    stage.tx(`settleOptions(btcOptionAsset, ${name} subaccount ${sub})`, tx);
  }

  const post = await readBalances(ctx);
  balanceTable(stage, `after ${label} settlement`, post);

  assertEq(post.takerOption, 0n, "taker option balance cleared to 0");
  assertEq(post.makerOption, 0n, "maker option balance cleared to 0");
  assertEq(post.takerBase, AMOUNT, "taker still holds 1 BTCB collateral");
  // cash-settled payout; tolerance covers 7 days of borrow interest on the taker's
  // negative cash balance (OI fee > premium) accrued during the warp
  assertApprox(
    post.makerCash,
    postTrade.makerCash + expectedPayout,
    SETTLE_TOL,
    `maker cash after ${label} settlement (payout ${fromUnit(expectedPayout)})`,
  );
  assertApprox(
    post.takerCash,
    postTrade.takerCash - expectedPayout,
    SETTLE_TOL,
    `taker cash after ${label} settlement (payout -${fromUnit(expectedPayout)})`,
  );
  stage.note(
    `${label}: payout ${fromUnit(expectedPayout)} USDT/option — maker ${fromUnit(post.makerCash - postTrade.makerCash)}, taker ${fromUnit(post.takerCash - postTrade.takerCash)} (interest drift within ${fromUnit(SETTLE_TOL)})`,
  );
  stage.status = "passed";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const procs = new ProcManager();
  const report = new Report();
  report.meta = {
    date: new Date().toISOString(),
    chain: `anvil (chainId ${CHAIN_ID}) on ${RPC_URL}`,
    command: "pnpm --filter @hedge/e2e e2e  (services/e2e/src/run.ts)",
    "maker EOA": "",
    "taker EOA": "",
  };
  report.meta["maker EOA"] = `${maker.address} (anvil #1)`;
  report.meta["taker EOA"] = `${taker.address} (anvil #2)`;

  let failed: Error | null = null;
  try {
    const ctx = await stageAnvilAndDeploy(procs, report);
    await stageFeeds(ctx);
    await stageFundAndSubaccounts(ctx);
    await stageServicesUp(ctx);
    const auction = await stageAuction(ctx);
    const { premium, post, fee } = await stageExecute(ctx, auction);
    report.meta["winning premium"] = `${fromUnit(premium)} USDT`;
    report.meta["OI fee per side"] = `${fromUnit(fee)} USDT`;

    // settlement scenarios don't need the services — stop them before warping
    // (the bot would otherwise see expired feeds / the engine has no open RFQs)
    await procs.stop(["maker-bot", "rfq-engine"]);

    const snapshotId = await ctx.testClient.snapshot();
    await settleScenario(ctx, "OTM", OTM_SETTLEMENT, post, 0n);
    await ctx.testClient.revert({ id: snapshotId });
    const reverted = await readBalances(ctx);
    assertEq(reverted.takerOption, post.takerOption, "snapshot revert restored taker option balance");
    await settleScenario(ctx, "ITM", ITM_SETTLEMENT, post, ITM_SETTLEMENT - STRIKE);
  } catch (err) {
    failed = err instanceof Error ? err : new Error(String(err));
    const stage = report.stages.at(-1);
    if (stage && stage.status !== "passed") stage.note(`**ERROR**: ${failed.message}`);
    console.error("\n[e2e] FAILED:", failed);
  } finally {
    await procs.killAll();
    const leftover = procs.alivePids();
    if (leftover.length > 0) console.error(`[e2e] WARNING: leftover pids: ${leftover.join(", ")}`);
    else console.log("[e2e] all spawned processes stopped");
    const overall = failed === null ? "PASSED" : "FAILED";
    writeFileSync(E2E_MD, report.render(overall) + "\n");
    console.log(`[e2e] report written to ${E2E_MD}`);
    console.log(`\n[e2e] RESULT: ${overall}`);
  }
  if (failed) {
    process.exitCode = 1;
  }
}

process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

main();
