"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import {
  lyraForwardFeedAbi,
  multiplierRegistryAbi,
  scaledUiTokenAbi,
  subAccountsAbi,
} from "@/lib/protocol/abis";
import { useNetwork } from "./useNetwork";
import {
  decodeOptionSubId,
  instrumentNameFromSubId,
} from "@/lib/protocol/instruments";
import { unitToNumber } from "@/lib/protocol/units";
import { useCoveredCallStore, type CoveredCallTrade } from "@/stores/covered-call";
import { useCoveredCallSubaccount } from "./useCoveredCallSubaccount";
import {
  getMarket,
  getMarkets,
  rawAmount18ToUi18,
  rawPrice18ToUi18,
  type MarketId,
} from "@/lib/protocol/markets";

export type PositionStatus = "open" | "expired" | "settled";

export interface OptionPosition {
  marketId?: MarketId;
  assetName?: string;
  collateralSymbol?: string;
  subId: bigint;
  instrumentName: string;
  /** USD */
  strike: number;
  /** unix seconds */
  expiry: number;
  isCall: boolean;
  /** negative = short (sold) */
  balance: number;
  status: PositionStatus;
  /** settlement fix, USD — set once the forward feed has settlement data */
  settlementPrice: number | null;
  /** for settled calls: in or out of the money at the fix */
  settledItm: boolean | null;
  /** trade record from the RFQ flow, if this browser sold it */
  trade: CoveredCallTrade | null;
}

export interface SubaccountBalances {
  /** USDT cash (can be negative — borrowing) */
  cash: number;
  /** BTCB collateral inside the subaccount */
  btcb: number;
  /** selected market collateral in display/UI units */
  collateral: number;
  options: OptionPosition[];
}

/**
 * On-chain position state for a subaccount, straight from
 * SubAccounts.getAccountBalances: BTCB collateral, USDT cash (premium lives
 * here after a sale) and option positions (decoded from their subIds).
 * Settlement status comes from LyraForwardFeed.getSettlementPrice(expiry).
 */
export function usePositionMonitor(
  subaccountId: bigint | null,
  marketId: MarketId = "BTC",
  multiplier: bigint | null = null,
) {
  const { addresses, chainId } = useNetwork();
  const market = getMarket(chainId, marketId);
  const [now, setNow] = useState(0);

  useEffect(() => {
    const updateNow = () => setNow(Date.now() / 1000);
    updateNow();
    const intervalId = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  const balancesQuery = useReadContract({
    abi: subAccountsAbi,
    address: addresses.subAccounts,
    functionName: "getAccountBalances",
    args: subaccountId !== null ? [subaccountId] : undefined,
    chainId,
    query: { enabled: subaccountId !== null, refetchInterval: 15_000 },
  });

  const raw = useMemo(() => {
    const cash = { value: 0 };
    const collateral = { value: 0 };
    const options: { subId: bigint; balance: number }[] = [];
    for (const b of balancesQuery.data ?? []) {
      const asset = b.asset.toLowerCase();
      if (asset === addresses.cashAsset.toLowerCase()) {
        cash.value = unitToNumber(b.balance);
      } else if (market.contracts && asset === market.contracts.baseAsset.toLowerCase()) {
        collateral.value = unitToNumber(rawAmount18ToUi18(BigInt(b.balance), multiplier));
      } else if (market.contracts && asset === market.contracts.optionAsset.toLowerCase()) {
        if (b.balance !== 0n) options.push({ subId: b.subId, balance: unitToNumber(b.balance) });
      }
    }
    return { cash: cash.value, collateral: collateral.value, options };
  }, [balancesQuery.data, addresses.cashAsset, market.contracts, multiplier]);

  // Settlement price per distinct expiry of held options
  const expiries = useMemo(
    () =>
      Array.from(
        new Set(raw.options.map((o) => Number(decodeOptionSubId(o.subId).expiry)))
      ),
    [raw.options]
  );

  const settlementReads = useReadContracts({
    contracts: expiries.map(
      (expiry) =>
        ({
          abi: lyraForwardFeedAbi,
          address: market.contracts?.settlementFeed ?? addresses.btcForwardFeed,
          functionName: "getSettlementPrice",
          args: [BigInt(expiry)],
          chainId,
        }) as const
    ),
    query: { enabled: expiries.length > 0, refetchInterval: 60_000 },
  });
  const balances = useMemo<SubaccountBalances>(() => {
    const settlementByExpiry = new Map<number, { settled: boolean; price: number }>();
    expiries.forEach((expiry, i) => {
      const res = settlementReads.data?.[i];
      if (res?.status === "success") {
        const [settled, price] = res.result as readonly [boolean, bigint];
        settlementByExpiry.set(expiry, { settled, price: unitToNumber(price) });
      }
    });

    const options: OptionPosition[] = raw.options.map((o) => {
      const details = decodeOptionSubId(o.subId);
      const expiry = Number(details.expiry);
      const strike = unitToNumber(details.strike);
      const settlement = settlementByExpiry.get(expiry);
      const isExpired = expiry <= now;
      const isSettled = isExpired && !!settlement?.settled;
      return {
        subId: o.subId,
        instrumentName: instrumentNameFromSubId(o.subId, market.id),
        strike,
        expiry,
        isCall: details.isCall,
        balance: o.balance,
        status: isSettled ? "settled" : isExpired ? "expired" : "open",
        settlementPrice: settlement?.settled ? settlement.price : null,
        settledItm: isSettled && settlement ? settlement.price > strike : null,
        trade: null,
      };
    });

    return { cash: raw.cash, btcb: raw.collateral, collateral: raw.collateral, options };
  }, [raw, expiries, settlementReads.data, now, market.id]);

  return {
    balances,
    isLoading: balancesQuery.isLoading,
    refetch: balancesQuery.refetch,
  };
}

/**
 * Positions for the connected wallet's covered-call subaccount, enriched
 * with the locally recorded trade metadata (premium received, tx hash).
 */
export function usePositions() {
  const { address } = useAccount();
  const { chainId } = useNetwork();
  const { subaccountId, isLoading: isLoadingSubaccounts } = useCoveredCallSubaccount();
  const monitor = useAllPositionMonitor(subaccountId);
  const { tradesFor } = useCoveredCallStore();

  const trades = tradesFor(address, chainId);

  const options = useMemo(
    () =>
      monitor.balances.options.map((o) => ({
        ...o,
        trade:
          trades.findLast(
            (t) =>
              t.instrumentName === o.instrumentName &&
              subaccountId !== null &&
              t.subaccountId === subaccountId.toString()
          ) ?? null,
      })),
    [monitor.balances.options, trades, subaccountId]
  );

  return {
    subaccountId,
    cash: monitor.balances.cash,
    btcb: monitor.balances.collateralByMarket.BTC ?? 0,
    collateralByMarket: monitor.balances.collateralByMarket,
    options,
    trades,
    isLoading: isLoadingSubaccounts || monitor.isLoading,
    refetch: monitor.refetch,
  };
}

interface AllBalances {
  cash: number;
  collateralByMarket: Partial<Record<MarketId, number>>;
  options: OptionPosition[];
}

/** Reads every enabled market from one subaccount without assuming BTC addresses. */
function useAllPositionMonitor(subaccountId: bigint | null) {
  const { addresses, chainId } = useNetwork();
  const [now, setNow] = useState(0);
  useEffect(() => {
    const updateNow = () => setNow(Date.now() / 1000);
    updateNow();
    const intervalId = window.setInterval(updateNow, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);
  const markets = useMemo(
    () => getMarkets(chainId).filter((market) => market.enabled && market.contracts),
    [chainId],
  );
  const scaledMarkets = markets.filter((market) => market.collateral.scaledUi && market.collateral.address);
  const multiplierReads = useReadContracts({
    contracts: scaledMarkets.map((market) => ({
      abi: scaledUiTokenAbi,
      address: market.collateral.address!,
      functionName: "uiMultiplier",
      chainId,
    }) as const),
    query: { enabled: scaledMarkets.length > 0, refetchInterval: 30_000 },
  });
  const multipliers = useMemo(() => {
    const out = new Map<MarketId, bigint>();
    scaledMarkets.forEach((market, index) => {
      const result = multiplierReads.data?.[index];
      if (result?.status === "success") out.set(market.id, result.result as bigint);
    });
    return out;
  }, [multiplierReads.data, scaledMarkets]);

  const balancesQuery = useReadContract({
    abi: subAccountsAbi,
    address: addresses.subAccounts,
    functionName: "getAccountBalances",
    args: subaccountId !== null ? [subaccountId] : undefined,
    chainId,
    query: { enabled: subaccountId !== null, refetchInterval: 15_000 },
  });

  const raw = useMemo(() => {
    let cash = 0;
    const collateralByMarket: Partial<Record<MarketId, number>> = {};
    const options: { marketId: MarketId; subId: bigint; balance18: bigint }[] = [];
    for (const balance of balancesQuery.data ?? []) {
      const asset = balance.asset.toLowerCase();
      if (asset === addresses.cashAsset.toLowerCase()) {
        cash = unitToNumber(balance.balance);
        continue;
      }
      for (const market of markets) {
        if (!market.contracts) continue;
        const multiplier = multipliers.get(market.id) ?? null;
        if (asset === market.contracts.baseAsset.toLowerCase()) {
          collateralByMarket[market.id] = unitToNumber(rawAmount18ToUi18(balance.balance, multiplier));
        } else if (asset === market.contracts.optionAsset.toLowerCase() && balance.balance !== 0n) {
          options.push({ marketId: market.id, subId: balance.subId, balance18: balance.balance });
        }
      }
    }
    return { cash, collateralByMarket, options };
  }, [addresses.cashAsset, balancesQuery.data, markets, multipliers]);

  const settlementReads = useReadContracts({
    contracts: raw.options.map((option) => {
      const market = markets.find((candidate) => candidate.id === option.marketId)!;
      const expiry = decodeOptionSubId(option.subId).expiry;
      return {
        abi: lyraForwardFeedAbi,
        address: market.contracts!.settlementFeed,
        functionName: "getSettlementPrice",
        args: [expiry],
        chainId,
      } as const;
    }),
    query: { enabled: raw.options.length > 0, refetchInterval: 60_000 },
  });
  const expiryMultiplierContracts = raw.options.flatMap((option) => {
    const market = markets.find((candidate) => candidate.id === option.marketId)!;
    const registry = market.contracts?.multiplierRegistry;
    return registry
      ? [{
          abi: multiplierRegistryAbi,
          address: registry,
          functionName: "multiplierAt" as const,
          args: [decodeOptionSubId(option.subId).expiry] as const,
          chainId,
        }]
      : [];
  });
  const expiryMultiplierReads = useReadContracts({
    contracts: expiryMultiplierContracts,
    query: {
      enabled: expiryMultiplierContracts.length > 0,
      refetchInterval: 60_000,
    },
  });

  const balances = useMemo<AllBalances>(() => {
    let expiryMultiplierIndex = 0;
    const options = raw.options.map((option, index) => {
      const market = markets.find((candidate) => candidate.id === option.marketId)!;
      const multiplier = multipliers.get(market.id) ?? null;
      const hasExpiryMultiplier = !!market.contracts?.multiplierRegistry;
      const expiryMultiplierResult = hasExpiryMultiplier
        ? expiryMultiplierReads.data?.[expiryMultiplierIndex++]
        : undefined;
      const expiryMultiplier = expiryMultiplierResult?.status === "success"
        ? expiryMultiplierResult.result as bigint
        : null;
      const decoded = decodeOptionSubId(option.subId);
      const settlementResult = settlementReads.data?.[index];
      const [settled, rawSettlement] = settlementResult?.status === "success"
        ? settlementResult.result as readonly [boolean, bigint]
        : [false, 0n] as const;
      const historicalMultiplierReady = !hasExpiryMultiplier || expiryMultiplier !== null;
      const priceMultiplier = settled && historicalMultiplierReady
        ? expiryMultiplier
        : multiplier;
      const uiStrike = unitToNumber(rawPrice18ToUi18(decoded.strike, priceMultiplier));
      const settlementPrice = settled && historicalMultiplierReady
        ? unitToNumber(rawPrice18ToUi18(rawSettlement, priceMultiplier))
        : null;
      const expired = Number(decoded.expiry) <= now;
      return {
        marketId: market.id,
        assetName: market.displayName,
        collateralSymbol: market.collateral.symbol,
        subId: option.subId,
        instrumentName: instrumentNameFromSubId(option.subId, market.id),
        strike: uiStrike,
        expiry: Number(decoded.expiry),
        isCall: decoded.isCall,
        balance: unitToNumber(rawAmount18ToUi18(option.balance18, multiplier)),
        status: settled && expired ? "settled" as const : expired ? "expired" as const : "open" as const,
        settlementPrice,
        settledItm: settled && settlementPrice !== null ? settlementPrice > uiStrike : null,
        trade: null,
      };
    });
    return { cash: raw.cash, collateralByMarket: raw.collateralByMarket, options };
  }, [expiryMultiplierReads.data, markets, multipliers, now, raw, settlementReads.data]);

  return { balances, isLoading: balancesQuery.isLoading, refetch: balancesQuery.refetch };
}
