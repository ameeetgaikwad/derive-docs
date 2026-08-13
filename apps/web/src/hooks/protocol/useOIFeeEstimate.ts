"use client";

import { useMemo } from "react";
import type { Address } from "viem";
import { useReadContracts } from "wagmi";
import {
  srmPortfolioViewerAbi,
  standardManagerFeeAbi,
} from "@/lib/protocol/abis";
import { unitToNumber, toUnit } from "@/lib/protocol/units";
import { useNetwork } from "./useNetwork";

const ONE = 10n ** 18n;

export interface OIFeeEstimateParams {
  /** BTC option amount as a decimal string/number. The sign is ignored. */
  amount: string | number;
  /** Forward price used by the selected board row, in USD. */
  forwardPrice: number;
  /** Defaults to the active network's BTC option asset. */
  optionAsset?: Address;
  enabled?: boolean;
}

export interface OIFeeEstimate {
  /** Conservative fee for one side of the trade, in protocol 18dp cash units. */
  perSideFee18: bigint | null;
  /** Display-friendly USD value of perSideFee18. */
  perSideFeeUsd: number | null;
  /** Live SRMPortfolioViewer multiplier (18dp despite the legacy BPS name). */
  rate18: bigint | null;
  /** Live StandardManager minimum fee floor (18dp cash units). */
  minFee18: bigint | null;
  isLoading: boolean;
  error: Error | null;
  /** True only when valid inputs and both live contract reads are available. */
  isAvailable: boolean;
}

/**
 * Estimate the SRM open-interest fee for one side of a selected option trade.
 * This mirrors StandardManager._chargeAllOIFee / BasePortfolioViewer:
 *
 *   fee = |amount| * forward / 1e18 * rate / 1e18
 *   fee = max(fee, minOIFee) when fee > 0
 *
 * It is intentionally conservative: the actual fee is zero when a fill
 * reduces existing open interest, which cannot be known from board inputs.
 */
export function useOIFeeEstimate({
  amount,
  forwardPrice,
  optionAsset,
  enabled = true,
}: OIFeeEstimateParams): OIFeeEstimate {
  const { addresses, chainId } = useNetwork();
  const feeAsset = optionAsset ?? addresses.btcOptionAsset;

  const inputs = useMemo(() => {
    try {
      const amount18 = toUnit(
        typeof amount === "number" ? amount.toFixed(18) : amount,
      );
      const forward18 = toUnit(forwardPrice.toFixed(18));
      const valid = amount18 !== 0n && forward18 > 0n;
      return { amount18, forward18, valid, error: null };
    } catch {
      return {
        amount18: 0n,
        forward18: 0n,
        valid: false,
        error: new Error("Invalid amount or forward price for OI fee estimate"),
      };
    }
  }, [amount, forwardPrice]);

  const shouldRead = enabled && inputs.valid;
  const reads = useReadContracts({
    contracts: [
      {
        abi: standardManagerFeeAbi,
        address: addresses.standardManager,
        chainId,
        functionName: "minOIFee",
      },
      {
        abi: srmPortfolioViewerAbi,
        address: addresses.srmViewer,
        chainId,
        functionName: "OIFeeRateBPS",
        args: [feeAsset],
      },
    ],
    query: {
      enabled: shouldRead,
      refetchInterval: 30_000,
      retry: false,
    },
  });

  const minFeeResult = reads.data?.[0];
  const rateResult = reads.data?.[1];
  const hasLiveValues =
    shouldRead &&
    minFeeResult?.status === "success" &&
    rateResult?.status === "success";
  const minFee18 = hasLiveValues ? (minFeeResult.result as bigint) : null;
  const rate18 = hasLiveValues ? (rateResult.result as bigint) : null;

  let perSideFee18: bigint | null = null;
  if (minFee18 !== null && rate18 !== null) {
    const absAmount = inputs.amount18 < 0n ? -inputs.amount18 : inputs.amount18;
    let fee = (((absAmount * inputs.forward18) / ONE) * rate18) / ONE;
    if (fee > 0n && fee < minFee18) fee = minFee18;
    perSideFee18 = fee;
  }

  const readError = reads.error instanceof Error ? reads.error : null;
  const resultError =
    !reads.isLoading && shouldRead && !hasLiveValues && !readError
      ? new Error("Live OI fee inputs are unavailable")
      : null;
  const error = inputs.error ?? readError ?? resultError;

  return {
    perSideFee18,
    perSideFeeUsd: perSideFee18 === null ? null : unitToNumber(perSideFee18),
    rate18,
    minFee18,
    isLoading: shouldRead && reads.isLoading,
    error,
    isAvailable: hasLiveValues && perSideFee18 !== null,
  };
}
