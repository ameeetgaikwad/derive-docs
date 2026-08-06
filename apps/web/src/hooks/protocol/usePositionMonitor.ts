"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract, useReadContracts } from "wagmi";
import { lyraForwardFeedAbi, subAccountsAbi } from "@/lib/protocol/abis";
import { useNetwork } from "./useNetwork";
import {
  decodeOptionSubId,
  instrumentNameFromSubId,
} from "@/lib/protocol/instruments";
import { unitToNumber } from "@/lib/protocol/units";
import { useCoveredCallStore, type CoveredCallTrade } from "@/stores/covered-call";
import { useCoveredCallSubaccount } from "./useCoveredCallSubaccount";

export type PositionStatus = "open" | "expired" | "settled";

export interface OptionPosition {
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
  options: OptionPosition[];
}

/**
 * On-chain position state for a subaccount, straight from
 * SubAccounts.getAccountBalances: BTCB collateral, USDT cash (premium lives
 * here after a sale) and option positions (decoded from their subIds).
 * Settlement status comes from LyraForwardFeed.getSettlementPrice(expiry).
 */
export function usePositionMonitor(subaccountId: bigint | null) {
  const { addresses, chainId } = useNetwork();
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
    const btcb = { value: 0 };
    const options: { subId: bigint; balance: number }[] = [];
    for (const b of balancesQuery.data ?? []) {
      const asset = b.asset.toLowerCase();
      if (asset === addresses.cashAsset.toLowerCase()) {
        cash.value = unitToNumber(b.balance);
      } else if (asset === addresses.btcBaseAsset.toLowerCase()) {
        btcb.value = unitToNumber(b.balance);
      } else if (asset === addresses.btcOptionAsset.toLowerCase()) {
        if (b.balance !== 0n) options.push({ subId: b.subId, balance: unitToNumber(b.balance) });
      }
    }
    return { cash: cash.value, btcb: btcb.value, options };
  }, [balancesQuery.data, addresses]);

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
          address: addresses.btcForwardFeed,
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
        instrumentName: instrumentNameFromSubId(o.subId),
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

    return { cash: raw.cash, btcb: raw.btcb, options };
  }, [raw, expiries, settlementReads.data, now]);

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
  const { subaccountId } = useCoveredCallSubaccount();
  const monitor = usePositionMonitor(subaccountId);
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
    btcb: monitor.balances.btcb,
    options,
    trades,
    isLoading: monitor.isLoading,
    refetch: monitor.refetch,
  };
}
