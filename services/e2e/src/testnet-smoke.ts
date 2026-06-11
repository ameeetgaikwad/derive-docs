#!/usr/bin/env node
/**
 * hedge LIVE smoke test on BSC TESTNET (chainId 97).
 *
 * Adapted from src/run.ts (the anvil acceptance harness), minus everything
 * anvil-only: no anvil spawn, no forge deploy (the stack is already deployed,
 * protocol/deployments/97.json), no evm_snapshot, no time warp, no settlement
 * stage (settlement runs at the real expiry).
 *
 * Stages:
 *   1. context: read deployments/97.json, verify Matching.domainSeparator
 *   2. feeds: live BTC spot + forward/rate/flat-IV vol for a ~7d 08:00 UTC
 *      expiry + USDT stable 1.0 — FEED_SIGNER_KEY signs, deployer posts
 *   3. maker-bot --setup (subaccount + 150k USDT cash); taker subaccount +
 *      1 BTCB deposit via WrappedERC20Asset
 *   4. rfq-engine (executor = deployer) + maker-bot up
 *   5. RFQ auction: taker sells 1x BTC call (strike from env), accept best
 *      quote, wait for Matching.verifyAndMatch receipt
 *   6. assertions: option -1/+1, premium & OI fees in cash, SRM IM >= 0
 *
 * Required env (see protocol/.env): RPC_URL, PRIVATE_KEY (deployer =
 * executor = feed poster), FEED_SIGNER_KEY, TESTNET_MAKER_KEY,
 * TESTNET_TAKER_KEY, SPOT_USD (live BTC spot, decimal), STRIKE_USD.
 * Optional: EXPIRY (unix override), RFQ_PORT, SPOT_SOURCE (report note).
 *
 * All transactions go through @hedge/shared makeWalletClient, which
 * forces LEGACY type + 0.2 gwei gasPrice on chain 97 (BSC testnet nodes
 * mishandle EIP-1559 fee fields).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import {
  buildAction,
  encodeOptionSubId,
  encodeSpotData,
  encodeTakerOrder,
  fromUnit,
  getDeployedAddress,
  instrumentName,
  lyraForwardFeedAbi,
  lyraSpotFeedAbi,
  lyraVolFeedAbi,
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
const TMP_DIR = join(SERVICES_DIR, "e2e", ".tmp");
const REPORT_MD = join(TMP_DIR, "testnet-smoke.md");

const CHAIN_ID = 97;
const EXPLORER = "https://testnet.bscscan.com";
const RFQ_PORT = Number(process.env.RFQ_PORT ?? 3030);
const ENGINE_URL = `http://127.0.0.1:${RFQ_PORT}`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`env ${name} is required`);
  return v;
}
function keyEnv(name: string): Hex {
  const raw = requireEnv(name);
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as Hex;
}

const RPC_URL = requireEnv("RPC_URL");
const DEPLOYER_KEY = keyEnv("PRIVATE_KEY"); // deployer = executor = feed poster
const FEED_SIGNER_KEY = keyEnv("FEED_SIGNER_KEY");
const MAKER_KEY = keyEnv("TESTNET_MAKER_KEY");
const TAKER_KEY = keyEnv("TESTNET_TAKER_KEY");

const SPOT_USD = requireEnv("SPOT_USD"); // live BTC spot, decimal string
const STRIKE_USD = requireEnv("STRIKE_USD"); // ~110% of spot, rounded
const SPOT_SOURCE = process.env.SPOT_SOURCE ?? "unspecified";

const SPOT = toUnit(SPOT_USD);
const STRIKE = toUnit(STRIKE_USD);
const IV = toUnit("0.6"); // flat 60% vol surface
const RATE = toUnit("0.05"); // 5% annualized
const AMOUNT = toUnit("1"); // 1x option / 1 BTCB collateral
const MAKER_USDT_DEPOSIT = "150000";

// OI fee per DeployAll.s.sol: viewer rate 0.1e18, SRM minOIFee 10e18.
const OI_FEE_RATE = toUnit("0.1");
const MIN_OI_FEE = toUnit("10");
const ONE = 10n ** 18n;

const deployer = privateKeyToAccount(DEPLOYER_KEY);
const feedSigner = privateKeyToAccount(FEED_SIGNER_KEY);
const maker = privateKeyToAccount(MAKER_KEY);
const taker = privateKeyToAccount(TAKER_KEY);

/** Next 08:00 UTC that is at least ~7 days away (Deribit-style expiry). */
function sevenDayExpiry(nowSec: bigint): bigint {
  const t = new Date(Number(nowSec + 7n * 86400n) * 1000);
  const at8 = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 8, 0, 0) / 1000;
  return BigInt(at8 >= Number(nowSec) + 7 * 86400 ? at8 : at8 + 86400);
}

// ---------------------------------------------------------------------------
// Chain helpers (mirrors run.ts)
// ---------------------------------------------------------------------------

interface Ctx {
  procs: ProcManager;
  report: Report;
  publicClient: PublicClient;
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

function txLink(hash: string): string {
  return `[\`${hash}\`](${EXPLORER}/tx/${hash})`;
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

async function stageContext(procs: ProcManager, report: Report): Promise<Ctx> {
  const stage = report.stage("testnet context: deployments/97.json + domain separator");

  const d = readDeployments(CHAIN_ID);
  if (!d) throw new Error("protocol/deployments/97.json missing");
  const addr = (key: string) => getDeployedAddress(d, key);
  assert(
    deployer.address.toLowerCase() === String(d.deployer).toLowerCase(),
    `PRIVATE_KEY address ${deployer.address} != deployments deployer ${d.deployer}`,
  );
  assert(
    feedSigner.address.toLowerCase() === String(d.feedSigner).toLowerCase(),
    `FEED_SIGNER_KEY address ${feedSigner.address} != deployments feedSigner ${d.feedSigner}`,
  );

  const publicClient = makePublicClient({ chainId: CHAIN_ID, rpcUrl: RPC_URL });
  const chainId = await publicClient.getChainId();
  assert(chainId === CHAIN_ID, `RPC chainId ${chainId} != ${CHAIN_ID}`);

  const onchainDomain = (await publicClient.readContract({
    address: addr("matching"),
    abi: matchingAbi,
    functionName: "domainSeparator",
  })) as Hex;
  assert(
    onchainDomain.toLowerCase() === String(d.matchingDomainSeparator).toLowerCase(),
    `Matching.domainSeparator on-chain ${onchainDomain} != deployments ${d.matchingDomainSeparator}`,
  );
  stage.note(`chainId 97 (BSC testnet), RPC OK; Matching domain separator verified (\`${onchainDomain}\`)`);

  const isExecutor = (await publicClient.readContract({
    address: addr("matching"),
    abi: matchingAbi,
    functionName: "tradeExecutors",
    args: [deployer.address],
  })) as boolean;
  assert(isExecutor, `deployer ${deployer.address} is not a registered trade executor`);
  stage.note(`deployer \`${deployer.address}\` is the registered trade executor`);

  const block = await publicClient.getBlock();
  const expiry = process.env.EXPIRY ? BigInt(process.env.EXPIRY) : sevenDayExpiry(block.timestamp);
  const subId = encodeOptionSubId({ expiry, strike: STRIKE, isCall: true });
  const name = instrumentName({ currency: "BTC", expiry, strike: STRIKE, isCall: true });
  stage.note(
    `option: ${name} — strike ${STRIKE_USD} (~110% of spot ${SPOT_USD}, source: ${SPOT_SOURCE}), ` +
      `expiry ${expiry} (${new Date(Number(expiry) * 1000).toISOString()}), subId ${subId}`,
  );

  const deployerWallet = makeWalletClient(deployer, { chainId: CHAIN_ID, rpcUrl: RPC_URL });
  const takerWallet = makeWalletClient(taker, { chainId: CHAIN_ID, rpcUrl: RPC_URL });

  process.env.SATS_DEPLOYMENTS_DIR = DEPLOYMENTS_DIR;
  process.env.CHAIN_ID = String(CHAIN_ID);
  // FeedPoster: feed signer signs the FeedData payloads, the deployer wallet
  // (funded) submits the acceptData transactions.
  const poster = new FeedPoster(
    publicClient,
    deployerWallet,
    feedSigner,
    CHAIN_ID,
    feedAddressesFromDeployments(CHAIN_ID),
  );

  const ctx: Ctx = {
    procs,
    report,
    publicClient,
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
    signers: [feedSigner],
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
  const stage = ctx.report.stage("feeds: LIVE spot / forward / rate / vol (+ USDT stable)");
  stage.note(`BTC spot source: ${SPOT_SOURCE} -> ${SPOT_USD} USD`);

  const spotTx = await ctx.poster.postSpot(SPOT);
  stage.tx(`BTC spot = ${fromUnit(SPOT)}`, txLink(spotTx));
  const fwdTx = await ctx.poster.postForward(ctx.expiry, SPOT);
  stage.tx(`BTC forward(${ctx.expiry}) = ${fromUnit(SPOT)}`, txLink(fwdTx));
  const rateTx = await ctx.poster.postRate(ctx.expiry, RATE);
  stage.tx(`BTC rate(${ctx.expiry}) = ${fromUnit(RATE)}`, txLink(rateTx));
  const volTx = await ctx.poster.postFlatVol(ctx.expiry, IV, SPOT);
  stage.tx(`BTC vol surface flat IV = ${fromUnit(IV)} (SVI)`, txLink(volTx));
  const stableTx = await postStableFeed(ctx);
  stage.tx("USDT stable feed = 1.0", txLink(stableTx));

  // read-back verification
  const spot = await ctx.poster.readSpot();
  assertEq(spot, SPOT, "spot feed read-back");
  const fwd = await ctx.poster.readForward(ctx.expiry);
  assertEq(fwd, SPOT, "forward feed read-back");
  const [vol] = (await ctx.publicClient.readContract({
    address: ctx.addr("btcVolFeed"),
    abi: lyraVolFeedAbi,
    functionName: "getVol",
    args: [STRIKE, ctx.expiry],
  })) as [bigint, bigint];
  const volDrift = vol > IV ? vol - IV : IV - vol;
  assert(volDrift <= toUnit("0.01"), `getVol(${STRIKE_USD}) = ${fromUnit(vol)}, expected ~0.6`);
  const [stable] = (await ctx.publicClient.readContract({
    address: ctx.addr("stableFeed"),
    abi: lyraSpotFeedAbi,
    functionName: "getSpot",
  })) as [bigint, bigint];
  assertEq(stable, toUnit("1"), "stable feed read-back");
  stage.note(
    `read-back OK: getSpot=${fromUnit(spot)}, getForwardPrice=${fromUnit(fwd)}, ` +
      `getVol(strike)=${fromUnit(vol)}, stable getSpot=${fromUnit(stable)}`,
  );
  stage.status = "passed";
}

/** Try to reuse a subaccount recorded by a previous (partial) run — live
 *  testnet state cannot be reset, so the stage must be idempotent. */
function readStateFile(path: string): { owner?: string; subaccountId?: string } | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as { owner?: string; subaccountId?: string };
  } catch {
    return null;
  }
}

async function stageSubaccounts(ctx: Ctx): Promise<void> {
  const stage = ctx.report.stage("maker --setup (150k USDT cash) + taker subaccount (1 BTCB)");
  const btcb = ctx.addr("btcb");
  mkdirSync(TMP_DIR, { recursive: true });

  // maker: the maker-bot's own --setup path (createSubAccount + USDT cash
  // deposit). Reused from the state file if a previous run already set it up.
  const stateFile = join(TMP_DIR, `maker-state.${CHAIN_ID}.json`);
  const prior = readStateFile(stateFile);
  let makerReady = false;
  if (prior?.subaccountId && prior.owner?.toLowerCase() === maker.address.toLowerCase()) {
    const sub = BigInt(prior.subaccountId);
    const cash = await getBalance(ctx, sub, ctx.addr("cashAsset"), 0n);
    if (cash >= toUnit(MAKER_USDT_DEPOSIT)) {
      ctx.makerSubaccount = sub;
      makerReady = true;
      stage.note(
        `maker subaccount ${sub} reused from ${stateFile} (cash ${fromUnit(cash)} USDT already deposited)`,
      );
    }
  }
  if (!makerReady) {
    await ctx.procs.run(
      "maker-setup",
      "node",
      [join(SERVICES_DIR, "maker-bot", "dist", "index.js"), "--setup"],
      {
        env: {
          PRIVATE_KEY: MAKER_KEY,
          RPC_URL,
          CHAIN_ID: String(CHAIN_ID),
          SATS_DEPLOYMENTS_DIR: DEPLOYMENTS_DIR,
          DEPOSIT_USDT: MAKER_USDT_DEPOSIT,
          MAKER_STATE_FILE: stateFile,
        },
        timeoutMs: 240_000,
      },
    );
    const state = JSON.parse(readFileSync(stateFile, "utf8")) as { subaccountId: string };
    ctx.makerSubaccount = BigInt(state.subaccountId);
    stage.note(
      `maker-bot --setup: subaccount ${ctx.makerSubaccount} created under Matching, ${MAKER_USDT_DEPOSIT} USDT cash deposited (maker EOA \`${maker.address}\`)`,
    );
  }
  const makerCash = await getBalance(ctx, ctx.makerSubaccount, ctx.addr("cashAsset"), 0n);
  assertEq(makerCash, toUnit(MAKER_USDT_DEPOSIT), "maker cash after setup");

  // taker: Matching.createSubAccount(SRM) + 1 BTCB into WrappedERC20Asset.
  // Also idempotent via a state file (mirrors the maker path).
  const matching = ctx.addr("matching");
  const takerStateFile = join(TMP_DIR, `taker-state.${CHAIN_ID}.json`);
  const takerPrior = readStateFile(takerStateFile);
  if (takerPrior?.subaccountId && takerPrior.owner?.toLowerCase() === taker.address.toLowerCase()) {
    ctx.takerSubaccount = BigInt(takerPrior.subaccountId);
    stage.note(`taker subaccount ${ctx.takerSubaccount} reused from ${takerStateFile}`);
  } else {
    const { result: takerSub, request } = await ctx.publicClient.simulateContract({
      address: matching,
      abi: matchingAbi,
      functionName: "createSubAccount",
      args: [ctx.addr("standardManager")],
      account: taker,
      chain: ctx.takerWallet.chain ?? undefined,
    });
    const createTx = await ctx.takerWallet.writeContract(request);
    const createReceipt = await ctx.publicClient.waitForTransactionReceipt({ hash: createTx });
    assert(createReceipt.status === "success", `createSubAccount reverted (tx ${createTx})`);
    ctx.takerSubaccount = takerSub as bigint;
    writeFileSync(
      takerStateFile,
      JSON.stringify(
        { chainId: CHAIN_ID, owner: taker.address, subaccountId: ctx.takerSubaccount.toString() },
        null,
        2,
      ),
    );
    stage.tx(`taker Matching.createSubAccount(SRM) -> subaccount ${ctx.takerSubaccount}`, txLink(createTx));
  }

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

  const takerBasePre = await getBalance(ctx, ctx.takerSubaccount, ctx.addr("btcBaseAsset"), 0n);
  if (takerBasePre < AMOUNT) {
    const approveTx = await writeTx(ctx, ctx.takerWallet, taker, {
      address: btcb,
      abi: mockErc20Abi,
      functionName: "approve",
      args: [ctx.addr("btcBaseAsset"), AMOUNT],
    });
    stage.tx("taker BTCB.approve(WrappedERC20Asset)", txLink(approveTx));
    const depositTx = await writeTx(ctx, ctx.takerWallet, taker, {
      address: ctx.addr("btcBaseAsset"),
      abi: wrappedErc20AssetAbi,
      functionName: "deposit",
      args: [ctx.takerSubaccount, AMOUNT],
    });
    stage.tx("taker WrappedERC20Asset.deposit(1 BTCB) — covered-call collateral", txLink(depositTx));
  } else {
    stage.note("taker BTCB collateral already deposited (previous run)");
  }

  const takerBase = await getBalance(ctx, ctx.takerSubaccount, ctx.addr("btcBaseAsset"), 0n);
  assertEq(takerBase, AMOUNT, "taker BTCB subaccount balance");
  balanceTable(stage, "after setup", await readBalances(ctx));
  stage.status = "passed";
}

async function stageServicesUp(ctx: Ctx): Promise<void> {
  const stage = ctx.report.stage("rfq-engine + maker-bot up (against testnet)");

  ctx.procs.spawnProc("rfq-engine", "node", [join(SERVICES_DIR, "rfq-engine", "dist", "index.js")], {
    env: {
      RPC_URL,
      CHAIN_ID: String(CHAIN_ID),
      RFQ_PORT: String(RFQ_PORT),
      AUCTION_WINDOW_MS: "8000", // testnet latency headroom
      SATS_DEPLOYMENTS_DIR: DEPLOYMENTS_DIR,
      EXECUTOR_PRIVATE_KEY: DEPLOYER_KEY, // registered trade executor
    },
  });
  await waitFor(
    "rfq-engine /health",
    async () => {
      const { status } = await httpJson<{ ok: boolean }>("GET", `${ENGINE_URL}/health`);
      return status === 200;
    },
    { timeoutMs: 60_000 },
  );
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
  await sleep(2500); // WS auth handshake
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
  const stage = ctx.report.stage(`RFQ auction: taker sells 1x BTC-${STRIKE_USD}-C (~7d)`);

  // spot heartbeat is 3 minutes — repost a fresh snapshot right before trading
  const spotTx = await ctx.poster.postSpot(SPOT);
  stage.tx("re-post BTC spot (3-minute heartbeat)", txLink(spotTx));

  const { status, json } = await httpJson<{ rfq: RfqStatus["rfq"] & { auctionEndsAt: number } }>(
    "POST",
    `${ENGINE_URL}/rfq`,
    {
      subaccountId: ctx.takerSubaccount.toString(),
      instrument: { asset: "BTC", expiry: Number(ctx.expiry), strike: STRIKE_USD, isCall: true },
      amount: "1",
      direction: "sell",
    },
  );
  assert(status === 201, `POST /rfq -> ${status}: ${JSON.stringify(json)}`);
  const rfq = json.rfq;
  stage.note(`RFQ \`${rfq.id}\` opened: ${rfq.instrument.name}, auction window 8s`);
  assertEq(BigInt(rfq.instrument.subId), ctx.subId, "engine OptionEncoding subId vs local encoding");

  await sleep(Math.max(0, rfq.auctionEndsAt - Date.now()) + 1500);

  const res = await httpJson<RfqStatus>("GET", `${ENGINE_URL}/rfq/${rfq.id}`);
  assert(res.status === 200, `GET /rfq/${rfq.id} -> ${res.status}`);
  const st = res.json;
  assert(st.rfq.status === "closed", `auction status: expected closed, got ${st.rfq.status} (${st.error ?? ""})`);
  assert(st.quoteCount >= 1, `expected >= 1 quote, got ${st.quoteCount}`);
  assert(st.bestQuote !== null, "no best quote after auction close");
  const best = st.bestQuote!;

  const premium = BigInt(best.totalPremium);
  // sanity bounds around Black-76: ~0.55% of forward for K=1.1F, T=7/365,
  // vol=0.6, r=0.05; bid = 0.95x theo. Allow [0.2%, 1.2%] of spot for the
  // strike rounding.
  const lo = (SPOT * 2n) / 1000n;
  const hi = (SPOT * 12n) / 1000n;
  assert(
    premium >= lo && premium <= hi,
    `premium ${fromUnit(premium)} outside sanity bounds [${fromUnit(lo)}, ${fromUnit(hi)}] USDT`,
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

async function stageExecute(ctx: Ctx, st: RfqStatus): Promise<{ premium: bigint; fee: bigint; txHash: string }> {
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
  stage.tx(`verifyAndMatch executed (block ${res.json.blockNumber})`, txLink(res.json.txHash));

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
  assertEq(post.feeRecipientCash, pre.feeRecipientCash + 2n * fee, "fee recipient cash = +2x OI fee");

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
  return { premium, fee, txHash: res.json.txHash };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const procs = new ProcManager();
  const report = new Report();
  report.meta = {
    date: new Date().toISOString(),
    chain: `BSC testnet (chainId ${CHAIN_ID})`,
    command: "tsx src/testnet-smoke.ts  (services/e2e)",
    "BTC spot": `${SPOT_USD} USD (${SPOT_SOURCE})`,
    "maker EOA": maker.address,
    "taker EOA": taker.address,
  };

  let failed: Error | null = null;
  try {
    const ctx = await stageContext(procs, report);
    await stageFeeds(ctx);
    await stageSubaccounts(ctx);
    await stageServicesUp(ctx);
    const auction = await stageAuction(ctx);
    const { premium, fee, txHash } = await stageExecute(ctx, auction);
    report.meta["winning premium"] = `${fromUnit(premium)} USDT`;
    report.meta["OI fee per side"] = `${fromUnit(fee)} USDT`;
    report.meta["trade tx"] = `${EXPLORER}/tx/${txHash}`;
    report.meta["maker subaccount"] = ctx.makerSubaccount.toString();
    report.meta["taker subaccount"] = ctx.takerSubaccount.toString();
    report.meta["expiry"] = `${ctx.expiry} (${new Date(Number(ctx.expiry) * 1000).toISOString()}) — settlement to be run at expiry`;
  } catch (err) {
    failed = err instanceof Error ? err : new Error(String(err));
    const stage = report.stages.at(-1);
    if (stage && stage.status !== "passed") stage.note(`**ERROR**: ${failed.message}`);
    console.error("\n[testnet-smoke] FAILED:", failed);
  } finally {
    await procs.killAll();
    const leftover = procs.alivePids();
    if (leftover.length > 0) console.error(`[testnet-smoke] WARNING: leftover pids: ${leftover.join(", ")}`);
    else console.log("[testnet-smoke] all spawned processes stopped");
    const overall = failed === null ? "PASSED" : "FAILED";
    mkdirSync(TMP_DIR, { recursive: true });
    writeFileSync(REPORT_MD, report.render(overall) + "\n");
    console.log(`[testnet-smoke] report written to ${REPORT_MD}`);
    console.log(`\n[testnet-smoke] RESULT: ${overall}`);
  }
  if (failed) process.exitCode = 1;
}

process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

main();
