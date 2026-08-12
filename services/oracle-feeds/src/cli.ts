#!/usr/bin/env node
import "dotenv/config";

import {
  fromUnit,
  getChainId,
  instrumentNameFromSubId,
  makePublicClient,
  makeWalletClient,
  toUnit,
  readMarketManifest,
  enabledMarkets,
  marketById,
  rwaExpiries,
  type MarketDefinition,
} from "@hedge/shared";
import { getDeadlineSec, getFeedSignerAccount, getPythPusherAccount } from "./env.js";
import {
  FeedPoster,
  feedAddressesFromDeployments,
  type SnapshotExpiryParams,
  type SnapshotParams,
} from "./poster.js";
import { buildDeribitSnapshot } from "./deribitSnapshot.js";
import {
  priceSourceFromEnv,
  stablePriceConfigFromEnv,
  StaticPriceSource,
  type PriceSource,
  type StablePriceConfig,
} from "./priceSource.js";
import { SettlementRunner, settlementAddressesFromDeployments } from "./settlement.js";
import {
  fetchHermesUpdates,
  pushPythUpdate,
  pushPythUpdates,
  pythAddressesFromDeployments,
  pythMarketsFromManifest,
  oracleSignerReadiness,
  selectFreshPythMarkets,
  spotFeedAbi,
  type PythAddresses,
  type PythBatchAddresses,
} from "./pyth.js";
import { ActiveExpiryIndex } from "./activeExpiryIndex.js";
import {
  buildOracleExpirySet,
  parseExpiryList,
  tradeableFridayExpiries,
} from "./expiryPolicy.js";
import { SettlementTwapTracker } from "./settlementTwap.js";
import { SerialTransactionQueue } from "./transactionQueue.js";
import { checkpointScaledMarkets } from "./multiplier.js";
import { referenceRwaVolatility } from "./realizedVol.js";

const USAGE = `oracle-feeds — signed feed poster + settlement runner (hedge)

Usage:
  oracle-feeds post   [--spot 100000] [--expiry <unix>]... [--forward <price>]
                      [--iv 0.6] [--rate 0.05] [--conf 1]
      One-shot: post spot (+ forward/rate/flat-IV SVI vol per --expiry).
      --spot falls back to the PRICE_SOURCE env config (static/chainlink).

  oracle-feeds daemon [--interval 30] [--feed-interval 120]
                      [--spot ...] [--expiry <unix>]... [--iv 0.6] [--rate 0.05]
      Keep Pyth, signed BTC market feeds, and the stable feed fresh. Pyth is
      refreshed every --interval seconds; BTC and stable feeds use independent
      intervals from FEED_INTERVAL_SEC and STABLE_FEED_INTERVAL_SEC.

  oracle-feeds pyth-push [--pyth 0x..] [--price-id 0x..] [--adapter 0x..] [--hermes <url>]
      Fetch the latest signed BTC/USD update from Pyth Hermes and submit it to the
      on-chain Pyth contract via updatePriceFeeds (paying the update fee), then read
      getSpot() back through the PythSpotFeed adapter. Defaults come from the
      deployments JSON (keys: pyth, btcPythPriceId, btcPythSpotFeed); HERMES_URL env
      overrides the Hermes endpoint. The sender (PYTH_PUSHER_*; feed signer
      fallback) only needs gas.

  oracle-feeds settle --expiry <unix> --subaccounts 4,5
                      [--price <settlement price>] [--signed] [--skip-feed]
      Fix the settlement price and call StandardManager.settleOptions for each
      subaccount, then print balances. Chain time must be >= expiry (e2e warps
      anvil first). Default path: the PERMISSIONLESS
      AnchoredSettlementFeed.fixSettlementPrice (Chainlink round data,
      Pyth-cross-checked; --price is only a sanity log). --signed forces the
      legacy signed forward-feed path (requires --price; use for deployments
      whose OptionAsset still settles against LyraForwardFeed, e.g. anvil).

  oracle-feeds status
      Read-only: sync the durable BalanceAdjusted index and print every held
      option, active live-feed expiry, expired settlement candidate, and
      finalized checkpoint. Does not require a signing key or send a tx.

Env: RPC_URL (default http://127.0.0.1:8545), CHAIN_ID (default 31337),
     FEED_SIGNER_KEY (default: anvil key #0 on 31337), FEED_DEADLINE_SEC,
     PRICE_SOURCE=static|chainlink, SPOT_PRICE, CHAINLINK_AGGREGATOR,
     STABLE_PRICE_SOURCE=static|chainlink, STABLE_PRICE,
     STABLE_CHAINLINK_AGGREGATOR, STABLE_FEED_INTERVAL_SEC,
     ORACLE_DISCOVERY_FROM_BLOCK, ORACLE_EXTRA_EXPIRIES, ORACLE_BATCH,
     AUTO_SETTLE, PYTH_PUSHER_KMS_KEY_ID or PYTH_PUSHER_PRIVATE_KEY.
`;

interface Args {
  flags: Map<string, string[]>;
  bools: Set<string>;
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string[]>();
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`Unexpected argument: ${a}`);
    const name = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      bools.add(name);
    } else {
      const list = flags.get(name) ?? [];
      list.push(next);
      flags.set(name, list);
      i++;
    }
  }
  return { flags, bools };
}

function one(args: Args, name: string): string | undefined {
  return args.flags.get(name)?.at(-1);
}

async function buildPoster() {
  const chainId = getChainId();
  const signer = await getFeedSignerAccount(chainId);
  const publicClient = makePublicClient({ chainId });
  const walletClient = makeWalletClient(signer, { chainId });
  const transactionQueue = new SerialTransactionQueue();
  const addresses = feedAddressesFromDeployments(chainId);
  const poster = new FeedPoster(
    publicClient,
    walletClient,
    signer,
    chainId,
    addresses,
    getDeadlineSec(),
    transactionQueue,
  );
  return { chainId, signer, publicClient, walletClient, poster, transactionQueue };
}

function expiriesFromArgs(args: Args): SnapshotExpiryParams[] {
  const expiries = args.flags.get("expiry") ?? [];
  const forward = one(args, "forward");
  const iv = one(args, "iv");
  const rate = one(args, "rate");
  return expiries.map((e) => ({
    expiry: BigInt(e),
    forwardPrice: forward ? toUnit(forward) : undefined,
    iv: iv ? toUnit(iv) : undefined,
    rate: rate ? toUnit(rate) : undefined,
  }));
}

async function resolveSpot(args: Args, source: () => PriceSource): Promise<bigint> {
  const spotArg = one(args, "spot");
  const s = spotArg ? new StaticPriceSource(toUnit(spotArg)) : source();
  return s.getSpotPrice();
}

async function cmdPost(args: Args): Promise<void> {
  const { poster, publicClient, signer, chainId } = await buildPoster();
  console.log(`[oracle-feeds] chain=${chainId} signer=${signer.address}`);
  const conf = one(args, "conf") ? toUnit(one(args, "conf")!) : undefined;
  await postStableUpdate(poster, stablePriceConfigFromEnv(publicClient, chainId));

  if (one(args, "source") === "deribit") {
    const snapshot = await buildDeribitSnapshotFromArgs(args, poster);
    await poster.postSnapshot({ ...snapshot, confidence: conf });
    return;
  }

  const spot = await resolveSpot(args, () => priceSourceFromEnv(publicClient));
  await poster.postSnapshot({
    spot,
    confidence: conf,
    expiries: expiriesFromArgs(args),
  });
}

async function postStableUpdate(
  poster: Awaited<ReturnType<typeof buildPoster>>["poster"],
  config: StablePriceConfig,
): Promise<void> {
  const price = await config.priceSource.getSpotPrice();
  const tx = await poster.postStable(price);
  console.log(
    `[oracle-feeds] stable ${fromUnit(price)}  source=${config.priceSource.name}  tx=${tx}`,
  );
}

/** Fetch the Deribit surface and build a fitted-SVI snapshot for the requested expiries. */
async function buildDeribitSnapshotFromArgs(
  args: Args,
  poster: Awaited<ReturnType<typeof buildPoster>>["poster"],
  requestedExpiries?: bigint[],
  requestedNow?: bigint,
): Promise<SnapshotParams> {
  const explicit = (args.flags.get("expiry") ?? []).map((e) => BigInt(e));
  const count = positiveInteger(
    "EXPIRY_COUNT",
    one(args, "expiry-count") ?? process.env.EXPIRY_COUNT ?? "4",
  );
  const now = requestedNow ?? (await poster.chainNow());
  const expiries =
    requestedExpiries ??
    (explicit.length > 0 ? explicit : tradeableFridayExpiries(count, now));
  const rate = one(args, "rate");
  const tolerance = one(args, "expiry-tolerance");
  const { snapshot, fitted, indexPrice } = await buildDeribitSnapshot({
    expiries,
    now: Number(now),
    rate: rate ? toUnit(rate) : undefined,
    toleranceSec: tolerance ? Number(tolerance) : 0,
    allowFlatFallback:
      (process.env.DERIBIT_ALLOW_FLAT_FALLBACK ?? (getChainId() === 56 ? "false" : "true"))
        .toLowerCase() === "true",
  });
  console.log(`[oracle-feeds] deribit index=${indexPrice}`);
  for (const f of fitted) {
    console.log(`[oracle-feeds] deribit expiry=${f.expiry} ${f.used ? "SVI" : "flat"}: ${f.note}`);
  }
  return snapshot;
}

async function cmdDaemon(args: Args): Promise<void> {
  const { poster, publicClient, walletClient, signer, chainId, transactionQueue } =
    await buildPoster();
  const intervalSec = positiveInteger(
    "INTERVAL_SEC",
    one(args, "interval") ?? process.env.INTERVAL_SEC ?? "30",
  );
  const feedIntervalSec = positiveInteger(
    "FEED_INTERVAL_SEC",
    one(args, "feed-interval") ?? process.env.FEED_INTERVAL_SEC ?? "120",
  );
  if (intervalSec >= 60) {
    throw new Error("INTERVAL_SEC must be below the Pyth adapter's 60-second staleness limit");
  }
  if (feedIntervalSec >= 180) {
    throw new Error("FEED_INTERVAL_SEC must be below the signed spot feed's 180-second heartbeat");
  }

  const useDeribit = one(args, "source") === "deribit";
  const source = useDeribit
    ? null
    : one(args, "spot")
      ? new StaticPriceSource(toUnit(one(args, "spot")!))
      : priceSourceFromEnv(publicClient);
  const stableConfig = stablePriceConfigFromEnv(publicClient, chainId);
  const expiryCount = positiveInteger(
    "EXPIRY_COUNT",
    one(args, "expiry-count") ?? process.env.EXPIRY_COUNT ?? "4",
  );
  const maxExpiries = positiveInteger("ORACLE_MAX_EXPIRIES", process.env.ORACLE_MAX_EXPIRIES ?? "32");
  const explicitExpiryParams = expiriesFromArgs(args);
  const extraExpiries = parseExpiryList(process.env.ORACLE_EXTRA_EXPIRIES, "ORACLE_EXTRA_EXPIRIES");
  for (const entry of explicitExpiryParams) extraExpiries.push(entry.expiry);
  const useBatch =
    (chainId === 56 || chainId === 97) &&
    (process.env.ORACLE_BATCH ?? "true").toLowerCase() !== "false";
  if (
    chainId === 56 &&
    !useBatch &&
    (process.env.ORACLE_ALLOW_UNBATCHED ?? "false").toLowerCase() !== "true"
  ) {
    throw new Error(
      "chain 56 requires atomic Multicall3 snapshots; set ORACLE_ALLOW_UNBATCHED=true only for a reviewed incident",
    );
  }

  const activeIndex = activeExpiryIndexFromEnv(publicClient, chainId);
  const twapTracker = new SettlementTwapTracker({
    chainId,
    ...(process.env.ORACLE_TWAP_STATE_PATH ? { statePath: process.env.ORACLE_TWAP_STATE_PATH } : {}),
  });
  const allowLateTwapBackfill =
    (process.env.ORACLE_ALLOW_LATE_TWAP_BACKFILL ?? (chainId === 56 ? "false" : "true"))
      .toLowerCase() === "true";
  await activeIndex.sync();
  const activeMarkets = enabledMarkets(readMarketManifest(chainId));
  const selectedMarketId = process.env.ORACLE_MARKET ?? "BTC";
  const selectedMarket = marketById(readMarketManifest(chainId), selectedMarketId);
  if (!selectedMarket?.enabled || !selectedMarket.contracts) {
    throw new Error(`ORACLE_MARKET ${selectedMarketId} is not enabled`);
  }
  if (selectedMarket.marketHours !== "24/7") {
    throw new Error("ORACLE_MARKET selects the crypto reference path; enabled RWA markets are posted automatically");
  }

  const rwaRuntimes = activeMarkets
    .filter((market) => market.marketHours === "24/5" && market.contracts)
    .map((market) => ({
      market,
      poster: new FeedPoster(
        publicClient,
        walletClient,
        signer,
        chainId,
        feedAddressesFromDeployments(chainId, market.id),
        getDeadlineSec(),
        transactionQueue,
      ),
      index: activeExpiryIndexFromEnv(publicClient, chainId, market.id),
      twap: new SettlementTwapTracker({ chainId, marketId: market.id }),
      volatility: configuredRwaVolatility(market),
      rate: configuredRwaRate(market),
    }));
  await Promise.all(rwaRuntimes.map((runtime) => runtime.index.sync()));

  const pythDisabled =
    args.bools.has("no-pyth") || (process.env.PYTH_PUSH ?? "").toLowerCase() === "false";
  if (chainId === 56 && pythDisabled) {
    throw new Error("Pyth updates cannot be disabled on chain 56");
  }
  let pythAddresses: PythBatchAddresses | null = null;
  const pythSourceMaxAgeSec = BigInt(positiveInteger(
    "PYTH_SOURCE_MAX_AGE_SEC",
    process.env.PYTH_SOURCE_MAX_AGE_SEC ?? "45",
  ));
  if (pythSourceMaxAgeSec >= 60n) {
    throw new Error("PYTH_SOURCE_MAX_AGE_SEC must remain below the adapter's 60-second staleness limit");
  }
  if (!pythDisabled) {
    try {
      pythAddresses = pythMarketsFromManifest(chainId);
    } catch (error) {
      if (chainId !== 31337) {
        throw new Error(`Pyth deployment configuration is required on chain ${chainId}`, {
          cause: error,
        });
      }
      pythAddresses = null; // plain anvil has no Pyth adapter
    }
  }
  const pythAccount = pythAddresses ? await getPythPusherAccount(chainId, signer) : null;
  const pythWalletClient = pythAccount ? makeWalletClient(pythAccount, { chainId }) : null;
  const pythTransactionQueue =
    pythAccount && pythAccount.address.toLowerCase() !== signer.address.toLowerCase()
      ? new SerialTransactionQueue()
      : transactionQueue;

  const autoSettle = (process.env.AUTO_SETTLE ?? "false").toLowerCase() === "true";
  const settlementIntervalSec = positiveInteger(
    "SETTLEMENT_INTERVAL_SEC",
    process.env.SETTLEMENT_INTERVAL_SEC ?? "60",
  );
  const settlementRetrySec = positiveInteger(
    "SETTLEMENT_RETRY_SEC",
    process.env.SETTLEMENT_RETRY_SEC ?? "300",
  );
  const settlementAddresses = settlementAddressesFromDeployments(chainId);
  if (autoSettle && !settlementAddresses.anchoredSettlementFeed) {
    throw new Error(
      settlementAddresses.benchmarkSettlementFeed
        ? "AUTO_SETTLE for RWA markets requires a benchmark-update provider; use the reviewed settle command"
        : "AUTO_SETTLE=true requires an anchored settlement feed; signed fallback is not automatic",
    );
  }
  const settlementRunner = autoSettle
    ? new SettlementRunner(
        publicClient,
        walletClient,
        signer,
        poster,
        settlementAddresses,
        transactionQueue,
      )
    : null;

  console.log(
    `[oracle-feeds] daemon chain=${chainId} signer=${signer.address} ` +
      `source=${useDeribit ? "deribit" : source!.name} interval=${intervalSec}s ` +
      `feedInterval=${feedIntervalSec}s pyth=${pythAddresses ? "on" : "off"} ` +
      `stable=${stableConfig.priceSource.name}/${stableConfig.intervalSec}s ` +
      `batch=${useBatch ? "on" : "off"} autoSettle=${autoSettle ? "on" : "off"}`,
  );
  const minimumSignerBalance =
    optionalBigIntEnv("ORACLE_MIN_SIGNER_BALANCE_WEI") ?? 5_000_000_000_000_000n;
  const transactionSenders = new Map<string, { address: typeof signer.address; roles: string[] }>();
  const addTransactionSender = (address: typeof signer.address, role: string) => {
    const key = address.toLowerCase();
    const existing = transactionSenders.get(key);
    if (existing) existing.roles.push(role);
    else transactionSenders.set(key, { address, roles: [role] });
  };
  addTransactionSender(signer.address, "signed feeds");
  if (pythAccount) addTransactionSender(pythAccount.address, "Pyth/multiplier updates");

  const checkTransactionSenderGas = async () => {
    for (const sender of transactionSenders.values()) {
      const readiness = await oracleSignerReadiness(
        publicClient,
        sender.address,
        minimumSignerBalance,
      );
      if (!readiness.ready) {
        throw new Error(
          `oracle transaction sender ${sender.address} (${sender.roles.join(", ")}) has ` +
            `${readiness.balance} wei; minimum configured balance is ` +
            `${readiness.minimumBalance} wei`,
        );
      }
      console.log(
        `[oracle-feeds] gas sender=${sender.address} roles=${sender.roles.join("+")} ` +
          `balance=${readiness.balance} wei`,
      );
    }
  };
  await checkTransactionSenderGas();

  const loops: Promise<never>[] = [];
  loops.push(
    runPeriodic(
      "oracle sender gas readiness",
      positiveInteger(
        "ORACLE_SIGNER_CHECK_INTERVAL_SEC",
        process.env.ORACLE_SIGNER_CHECK_INTERVAL_SEC ?? "60",
      ),
      checkTransactionSenderGas,
    ),
  );
  loops.push(
    runPeriodic("active-expiry discovery", positiveInteger(
      "ORACLE_DISCOVERY_INTERVAL_SEC",
      process.env.ORACLE_DISCOVERY_INTERVAL_SEC ?? "15",
    ), async () => {
      await activeIndex.sync();
      await Promise.all(rwaRuntimes.map((runtime) => runtime.index.sync()));
    }),
  );
  loops.push(
    runPeriodic("signed feed", feedIntervalSec, async () => {
      await activeIndex.sync();
      const policyNow = await poster.chainNow();
      const expirySet = buildOracleExpirySet({
        nowSec: policyNow,
        tradeable: tradeableFridayExpiries(expiryCount, policyNow),
        active: activeIndex.activeExpiries(policyNow),
        extra: extraExpiries,
      });
      if (expirySet.posting.length > maxExpiries) {
        throw new Error(
          `oracle needs ${expirySet.posting.length} expiries, above ORACLE_MAX_EXPIRIES=${maxExpiries}; ` +
            "raise the reviewed capacity limit rather than dropping live positions",
        );
      }
      console.log(
        `[oracle-feeds] expiries tradeable=[${expirySet.tradeable.join(",")}] ` +
          `active=[${expirySet.active.join(",")}] extra=[${expirySet.extra.join(",")}]`,
      );
      const expiredBacklog = activeIndex.expiredSeries(policyNow);
      if (!settlementRunner && expiredBacklog.length > 0) {
        console.warn(
          `[oracle-feeds] ${expiredBacklog.length} expired series await settlement; ` +
            "run the settle command or enable reviewed AUTO_SETTLE",
        );
      }

      let snapshot: SnapshotParams;
      if (useDeribit) {
        snapshot = await buildDeribitSnapshotFromArgs(args, poster, expirySet.posting, policyNow);
      } else {
        const spot = await source!.getSpotPrice();
        snapshot = {
          spot,
          expiries: expiryParamsFor(expirySet.posting, args),
        };
      }
      const observedAt = await poster.chainNow();
      snapshot = await attachSettlementAggregates(
        snapshot,
        observedAt,
        twapTracker,
        allowLateTwapBackfill,
      );
      if (useBatch) await poster.postSnapshotBatched(snapshot);
      else await poster.postSnapshot(snapshot);
    }),
  );
  if (rwaRuntimes.length > 0) {
    loops.push(
      runPeriodic("RWA signed feeds", feedIntervalSec, async () => {
        for (const runtime of rwaRuntimes) {
          try {
            await runtime.index.sync();
            const chainNow = await runtime.poster.chainNow();
            const expirySet = buildOracleExpirySet({
              nowSec: chainNow,
              tradeable: rwaExpiries(expiryCount, Number(chainNow) * 1000).map(BigInt),
              active: runtime.index.activeExpiries(chainNow),
            });
            if (expirySet.posting.length > maxExpiries) {
              throw new Error(
                `${runtime.market.id} needs ${expirySet.posting.length} expiries, ` +
                  `above ORACLE_MAX_EXPIRIES=${maxExpiries}`,
              );
            }
            const [spot] = await publicClient.readContract({
              address: runtime.market.contracts!.spotFeed,
              abi: spotFeedAbi,
              functionName: "getSpot",
            });
            let snapshot: SnapshotParams = {
              spot,
              expiries: expirySet.posting.map((expiry) => ({
                expiry,
                forwardPrice: spot,
                iv: toUnit(runtime.volatility.toString()),
                rate: toUnit(runtime.rate.toString()),
              })),
            };
            snapshot = await attachSettlementAggregates(
              snapshot,
              chainNow,
              runtime.twap,
              allowLateTwapBackfill,
            );
            if (useBatch) await runtime.poster.postSnapshotBatched(snapshot);
            else await runtime.poster.postSnapshot(snapshot);
            console.log(
              `[oracle-feeds] ${runtime.market.id} spot=${fromUnit(spot)} ` +
                `iv=${runtime.volatility} expiries=[${expirySet.posting.join(",")}]`,
            );
          } catch (error) {
            console.warn(
              `[oracle-feeds] ${runtime.market.id} signed feeds skipped: ${conciseError(error)}`,
            );
          }
        }
      }),
    );
  }
  loops.push(
    runPeriodic("stable feed", stableConfig.intervalSec, async () =>
      postStableUpdate(poster, stableConfig),
    ),
  );
  if (pythAddresses && pythWalletClient && pythAccount) {
    loops.push(
      runPeriodic("Pyth", intervalSec, async () => {
        const block = await publicClient.getBlock();
        const preview = await fetchHermesUpdates(
          pythAddresses.markets.map((market) => market.priceId),
          one(args, "hermes"),
        );
        const selection = selectFreshPythMarkets(
          pythAddresses.markets,
          preview.prices,
          block.timestamp,
          pythSourceMaxAgeSec,
        );
        if (selection.skipped.length > 0) {
          console.warn(
            `[oracle-feeds] skipping stale Pyth sources: ${selection.skipped.map((item) =>
              `${item.marketId}(${item.age === null ? item.reason : `${item.age}s`})`
            ).join(", ")}`,
          );
        }
        if (selection.fresh.length === 0) throw new Error("no fresh Pyth sources available");
        await pushPythUpdates({
          publicClient,
          walletClient: pythWalletClient,
          account: pythAccount,
          addresses: { ...pythAddresses, markets: selection.fresh },
          hermesUrl: one(args, "hermes"),
          transactionQueue: pythTransactionQueue,
        });
      }),
    );
    const scaledMarkets = enabledMarkets(readMarketManifest(chainId)).filter((market) => market.collateral.scaledUi);
    if (scaledMarkets.length > 0) {
      loops.push(
        runPeriodic("scaled UI multiplier", positiveInteger(
          "MULTIPLIER_CHECKPOINT_INTERVAL_SEC",
          process.env.MULTIPLIER_CHECKPOINT_INTERVAL_SEC ?? "60",
        ), async () => checkpointScaledMarkets({
          publicClient,
          walletClient: pythWalletClient,
          account: pythAccount,
          markets: scaledMarkets,
          transactionQueue: pythTransactionQueue,
        })),
      );
    }
  }
  if (settlementRunner) {
    const cooldown = new Map<string, number>();
    loops.push(
      runPeriodic("settlement", settlementIntervalSec, async () => {
        await activeIndex.sync();
        const chainNow = await poster.chainNow();
        for (const series of activeIndex.expiredSeries(chainNow)) {
          const key = series.expiry.toString();
          if ((cooldown.get(key) ?? 0) > Date.now()) continue;
          // The durable balance index is the settlement source of truth. OptionAsset
          // OI counts only positive balances, so it can reach zero after the long
          // settles while a short balance still remains. settleOptions is idempotent;
          // retry every indexed account until confirmed zero-balance events remove it.
          await settlementRunner.run({
            expiry: series.expiry,
            subaccounts: series.subaccounts,
          });
          cooldown.set(key, Date.now() + settlementRetrySec * 1000);
          console.log(
            `[oracle-feeds] settlement ${series.expiry} submitted; retaining index entries ` +
              "until confirmed zero-balance events are indexed",
          );
        }
      }),
    );
  }

  await Promise.all(loops);
}

function expiryParamsFor(expiries: readonly bigint[], args: Args): SnapshotExpiryParams[] {
  const forward = one(args, "forward");
  const iv = one(args, "iv");
  const rate = one(args, "rate");
  return expiries.map((expiry) => ({
    expiry,
    forwardPrice: forward ? toUnit(forward) : undefined,
    iv: iv ? toUnit(iv) : undefined,
    rate: rate ? toUnit(rate) : undefined,
  }));
}

async function attachSettlementAggregates(
  snapshot: SnapshotParams,
  observedAt: bigint,
  tracker: SettlementTwapTracker,
  allowLateBackfill: boolean,
): Promise<SnapshotParams> {
  const expiries: SnapshotExpiryParams[] = [];
  for (const entry of snapshot.expiries ?? []) {
    // Crossing expiry while fetching a market surface is possible. Never sign
    // an invalid post-expiry forward update; the settlement loop owns it now.
    if (observedAt >= entry.expiry) continue;
    const settlement = await tracker.observe(entry.expiry, observedAt, snapshot.spot);
    if (settlement?.lateStart) {
      if (!allowLateBackfill) {
        throw new Error(
          `settlement TWAP history is incomplete for expiry ${entry.expiry}; ` +
            "late backfill is disabled",
        );
      }
      console.warn(
        `[oracle-feeds] TWAP tracker started late for expiry ${entry.expiry}; ` +
          "backfilled the missing interval and requires operator review",
      );
    }
    expiries.push({
      ...entry,
      ...(settlement
        ? {
            settlement: {
              settlementStartAggregate: settlement.settlementStartAggregate,
              currentSpotAggregate: settlement.currentSpotAggregate,
            },
          }
        : {}),
    });
  }
  return { ...snapshot, timestamp: observedAt, expiries };
}

async function runPeriodic(
  name: string,
  intervalSec: number,
  operation: () => Promise<unknown>,
): Promise<never> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now();
    try {
      await operation();
    } catch (error) {
      console.error(`[oracle-feeds] ${name} failed: ${(error as Error).message}`);
    }
    const remainingMs = intervalSec * 1000 - (Date.now() - started);
    await new Promise((resolve) => setTimeout(resolve, Math.max(1_000, remainingMs)));
  }
}

function conciseError(error: unknown): string {
  const candidate = error && typeof error === "object"
    ? (error as { shortMessage?: unknown; message?: unknown }).shortMessage
      ?? (error as { message?: unknown }).message
    : error;
  const normalized = String(candidate ?? "unknown error").replace(/\s+/g, " ").trim();
  return normalized.length > 320 ? `${normalized.slice(0, 317)}...` : normalized;
}

function positiveInteger(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (received "${raw}")`);
  }
  return value;
}

function nonNegativeInteger(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer (received "${raw}")`);
  }
  return value;
}

function optionalBigIntEnv(name: string): bigint | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error(`${name} must be a non-negative integer`);
  return BigInt(raw);
}

function configuredRwaVolatility(market: MarketDefinition): number {
  const override = process.env[`RWA_IV_${market.id}`]?.trim();
  if (override) {
    const value = Number(override);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`RWA_IV_${market.id} must be positive`);
    return Math.max(value, market.riskVolFloor);
  }
  const rawCloses = process.env[`RWA_CLOSES_${market.id}`]?.trim();
  if (!rawCloses) {
    throw new Error(
      `enabled ${market.id} requires RWA_CLOSES_${market.id} (60 closes) or a reviewed RWA_IV_${market.id} override`,
    );
  }
  const closes = rawCloses.split(",").map((value) => Number(value.trim()));
  return referenceRwaVolatility(closes, market.riskVolFloor).reference;
}

function configuredRwaRate(market: MarketDefinition): number {
  const raw = process.env[`RWA_RATE_${market.id}`]?.trim() ?? "0.05";
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`RWA_RATE_${market.id} must be finite`);
  return value;
}

async function cmdPythPush(args: Args): Promise<void> {
  const chainId = getChainId();
  const account = await getPythPusherAccount(chainId);
  const publicClient = makePublicClient({ chainId });
  const walletClient = makeWalletClient(account, { chainId });

  let addresses: PythAddresses;
  const pythArg = one(args, "pyth");
  const priceIdArg = one(args, "price-id");
  if (pythArg && priceIdArg) {
    addresses = {
      pyth: pythArg as PythAddresses["pyth"],
      priceId: priceIdArg as PythAddresses["priceId"],
      adapter: one(args, "adapter") as PythAddresses["adapter"],
    };
  } else {
    addresses = pythAddressesFromDeployments(chainId);
    if (pythArg) addresses.pyth = pythArg as PythAddresses["pyth"];
    if (priceIdArg) addresses.priceId = priceIdArg as PythAddresses["priceId"];
    const adapterArg = one(args, "adapter");
    if (adapterArg) addresses.adapter = adapterArg as PythAddresses["adapter"];
  }

  console.log(`[oracle-feeds] pyth-push chain=${chainId} sender=${account.address}`);
  await pushPythUpdate({
    publicClient,
    walletClient,
    account,
    addresses,
    hermesUrl: one(args, "hermes"),
  });
}

async function cmdStatus(): Promise<void> {
  const chainId = getChainId();
  const publicClient = makePublicClient({ chainId });
  const index = activeExpiryIndexFromEnv(publicClient, chainId);
  await index.sync();
  const block = await publicClient.getBlock();
  const checkpoint = index.checkpoint();
  console.log(
    `[oracle-feeds] status chain=${chainId} chainTime=${block.timestamp} ` +
      `checkpoint=${checkpoint.lastScannedBlock} fromBlock=${checkpoint.fromBlock} ` +
      `positions=${checkpoint.positionCount}`,
  );
  for (const position of index.positions()) {
    console.log(
      `[oracle-feeds] account=${position.accountId} ${instrumentNameFromSubId(position.subId)} ` +
        `subId=${position.subId} balance=${fromUnit(position.balance)}`,
    );
  }
  console.log(`[oracle-feeds] active expiries=[${index.activeExpiries(block.timestamp).join(",")}]`);
  for (const series of index.expiredSeries(block.timestamp)) {
    console.log(
      `[oracle-feeds] expired expiry=${series.expiry} subaccounts=[${series.subaccounts.join(",")}] ` +
        `subIds=[${series.subIds.join(",")}]`,
    );
  }
}

function activeExpiryIndexFromEnv(
  publicClient: ReturnType<typeof makePublicClient>,
  chainId: number,
  marketId: string = process.env.ORACLE_MARKET ?? "BTC",
): ActiveExpiryIndex {
  const discoveryFromBlock = optionalBigIntEnv("ORACLE_DISCOVERY_FROM_BLOCK");
  return new ActiveExpiryIndex({
    publicClient,
    chainId,
    marketId,
    ...(marketId === (process.env.ORACLE_MARKET ?? "BTC") && process.env.ORACLE_STATE_PATH
      ? { statePath: process.env.ORACLE_STATE_PATH }
      : {}),
    ...(discoveryFromBlock !== undefined ? { fromBlock: discoveryFromBlock } : {}),
    confirmations: BigInt(
      nonNegativeInteger(
        "ORACLE_DISCOVERY_CONFIRMATIONS",
        process.env.ORACLE_DISCOVERY_CONFIRMATIONS ?? (chainId === 31337 ? "0" : "6"),
      ),
    ),
    chunkSize: BigInt(
      positiveInteger(
        "ORACLE_DISCOVERY_BLOCK_CHUNK",
        process.env.ORACLE_DISCOVERY_BLOCK_CHUNK ?? "2000",
      ),
    ),
  });
}

async function cmdSettle(args: Args): Promise<void> {
  const expiry = one(args, "expiry");
  const price = one(args, "price");
  const subs = one(args, "subaccounts");
  const signed = args.bools.has("signed");
  if (!expiry || !subs) {
    throw new Error("settle requires --expiry and --subaccounts (comma-separated)");
  }
  if (signed && !price) {
    throw new Error("settle --signed requires --price (the signed path posts the price)");
  }
  const { poster, publicClient, walletClient, signer, chainId, transactionQueue } =
    await buildPoster();
  const runner = new SettlementRunner(
    publicClient,
    walletClient,
    signer,
    poster,
    settlementAddressesFromDeployments(chainId),
    transactionQueue,
  );
  await runner.run({
    expiry: BigInt(expiry),
    price: price ? toUnit(price) : undefined,
    subaccounts: subs.split(",").map((s) => BigInt(s.trim())),
    signed,
    skipFeed: args.bools.has("skip-feed"),
    benchmarkUpdateData: (args.flags.get("pyth-update") ?? []).map((value) => {
      if (!/^0x[0-9a-fA-F]+$/.test(value)) throw new Error("--pyth-update must be hex bytes");
      return value as `0x${string}`;
    }),
  });
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(USAGE);
    return;
  }
  const args = parseArgs(rest);
  switch (cmd) {
    case "post":
      return cmdPost(args);
    case "daemon":
      return cmdDaemon(args);
    case "pyth-push":
      return cmdPythPush(args);
    case "settle":
      return cmdSettle(args);
    case "status":
      return cmdStatus();
    default:
      console.log(USAGE);
      throw new Error(`Unknown command: ${cmd}`);
  }
}

main().catch((err) => {
  console.error(`[oracle-feeds] error: ${err instanceof Error ? err.message : err}`);
  process.exitCode = 1;
});
