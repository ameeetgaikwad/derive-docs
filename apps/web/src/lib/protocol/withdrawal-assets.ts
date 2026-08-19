import type { Address } from "viem";
import type { ChainAddresses } from "./deployments";
import { getMarkets, type MarketId } from "./markets";
import type { AppChainId } from "@/stores/network";

const INTERNAL_DECIMALS = 18;
const ONE = 10n ** 18n;

export type WithdrawalAssetId = "cash" | `market:${MarketId}`;

export interface WithdrawableAssetConfig {
  /** Stable API identifier. Disabled markets remain addressable for exit-only flows. */
  assetId: WithdrawalAssetId;
  marketId: MarketId | null;
  kind: "cash" | "market-collateral";
  symbol: string;
  displayName: string;
  /** Asset contract held by SubAccounts and encoded in WithdrawalData. */
  protocolAsset: Address;
  /** ERC-20 transferred to or from the wallet. */
  tokenAddress: Address;
  /** Null only for cash, whose decimals are read from the deployed ERC-20. */
  tokenDecimals: number | null;
  scaledUi: boolean;
  /** Disabled markets stay visible so existing collateral can still exit. */
  exitOnly: boolean;
}

export interface WithdrawableAsset extends Omit<WithdrawableAssetConfig, "tokenDecimals"> {
  tokenDecimals: number;
  /** Exact signed SubAccounts balance in protocol 18-decimal units. */
  balance18: bigint;
  /** Current multiplier for scaled display assets, otherwise null. */
  multiplier: bigint | null;
  /** False only while a scaled asset's live multiplier is unavailable. */
  conversionReady: boolean;
  /** Exact wallet-facing display balance, kept at 18 decimals. */
  displayBalance18: bigint | null;
  /** Largest native-token amount representable without exceeding balance18. */
  maxNativeAmount: bigint;
}

export interface ProtocolAssetBalance {
  asset: Address;
  subId: bigint;
  balance: bigint;
}

function assertDecimals(decimals: number): void {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error(`Invalid token decimals: ${decimals}`);
  }
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("Division denominator must be positive");
  if (numerator === 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

/** Strict positive-decimal parser. It never accepts exponents or truncates precision. */
export function parseDecimalUnits(value: string, decimals: number): bigint {
  assertDecimals(decimals);
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    throw new Error("Enter a positive decimal amount");
  }
  const [whole = "0", fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount supports at most ${decimals} decimal places`);
  }
  const scale = 10n ** BigInt(decimals);
  const paddedFraction = fraction.padEnd(decimals, "0");
  return BigInt(whole) * scale + BigInt(paddedFraction || "0");
}

/** Native ERC-20 units to the exact 18dp debit the asset hook applies. */
export function nativeAmountToBalance18(nativeAmount: bigint, tokenDecimals: number): bigint {
  assertDecimals(tokenDecimals);
  if (nativeAmount < 0n) throw new Error("Native amount cannot be negative");
  if (tokenDecimals === INTERNAL_DECIMALS) return nativeAmount;
  if (tokenDecimals < INTERNAL_DECIMALS) {
    return nativeAmount * 10n ** BigInt(INTERNAL_DECIMALS - tokenDecimals);
  }
  return ceilDiv(nativeAmount, 10n ** BigInt(tokenDecimals - INTERNAL_DECIMALS));
}

/** Floor-safe native Max: its 18dp debit can never exceed the positive balance. */
export function maxNativeAmount(balance18: bigint, tokenDecimals: number): bigint {
  assertDecimals(tokenDecimals);
  if (balance18 <= 0n) return 0n;
  if (tokenDecimals === INTERNAL_DECIMALS) return balance18;
  if (tokenDecimals < INTERNAL_DECIMALS) {
    return balance18 / 10n ** BigInt(INTERNAL_DECIMALS - tokenDecimals);
  }
  return balance18 * 10n ** BigInt(tokenDecimals - INTERNAL_DECIMALS);
}

/** Raw protocol balance to the scaled wallet-facing display amount (18dp). */
export function withdrawableDisplayBalance18(
  balance18: bigint,
  multiplier: bigint | null,
): bigint {
  if (balance18 <= 0n) return 0n;
  if (multiplier === null) return balance18;
  if (multiplier <= 0n) throw new Error("Invalid token conversion multiplier");
  return (balance18 * multiplier) / ONE;
}

/** Display amount (18dp) to native token units, rounding up to satisfy the request. */
export function displayAmount18ToNative(
  displayAmount18: bigint,
  tokenDecimals: number,
  multiplier: bigint | null,
): bigint {
  assertDecimals(tokenDecimals);
  if (displayAmount18 < 0n) throw new Error("Display amount cannot be negative");
  if (multiplier === null) {
    if (tokenDecimals === INTERNAL_DECIMALS) return displayAmount18;
    if (tokenDecimals < INTERNAL_DECIMALS) {
      return ceilDiv(displayAmount18, 10n ** BigInt(INTERNAL_DECIMALS - tokenDecimals));
    }
    return displayAmount18 * 10n ** BigInt(tokenDecimals - INTERNAL_DECIMALS);
  }
  if (multiplier <= 0n) throw new Error("Invalid token conversion multiplier");
  const raw18 = ceilDiv(displayAmount18 * ONE, multiplier);
  if (tokenDecimals === INTERNAL_DECIMALS) return raw18;
  if (tokenDecimals < INTERNAL_DECIMALS) {
    return ceilDiv(raw18, 10n ** BigInt(INTERNAL_DECIMALS - tokenDecimals));
  }
  return raw18 * 10n ** BigInt(tokenDecimals - INTERNAL_DECIMALS);
}

export function formatDecimalUnits(value: bigint, decimals: number): string {
  assertDecimals(decimals);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const whole = absolute / scale;
  const remainder = absolute % scale;
  const fraction = remainder.toString().padStart(decimals, "0").replace(/0+$/, "");
  const formatted = fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
  return negative ? `-${formatted}` : formatted;
}

export function getWithdrawableAssetConfigs(
  chainId: AppChainId,
  addresses: ChainAddresses,
): WithdrawableAssetConfig[] {
  const cash: WithdrawableAssetConfig = {
    assetId: "cash",
    marketId: null,
    kind: "cash",
    symbol: "USDT",
    displayName: "USDT cash",
    protocolAsset: addresses.cashAsset,
    tokenAddress: addresses.usdt,
    tokenDecimals: null,
    scaledUi: false,
    exitOnly: false,
  };

  const collateral = getMarkets(chainId).flatMap<WithdrawableAssetConfig>((market) => {
    if (!market.contracts || !market.collateral.address) return [];
    return [{
      assetId: `market:${market.id}`,
      marketId: market.id,
      kind: "market-collateral",
      symbol: market.collateral.symbol,
      displayName: `${market.displayName} collateral`,
      protocolAsset: market.contracts.baseAsset,
      tokenAddress: market.collateral.address,
      tokenDecimals: market.collateral.decimals,
      scaledUi: market.collateral.scaledUi,
      exitOnly: !market.enabled,
    }];
  });

  const seen = new Set<string>();
  return [cash, ...collateral].filter((asset) => {
    const key = asset.protocolAsset.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Resolves raw SubAccounts balances without ever crossing through Number. */
export function resolveWithdrawableAssets(params: {
  configs: WithdrawableAssetConfig[];
  balances: readonly ProtocolAssetBalance[];
  cashDecimals: number;
  multipliers: ReadonlyMap<WithdrawalAssetId, bigint>;
}): WithdrawableAsset[] {
  const balanceByAsset = new Map<string, bigint>();
  for (const balance of params.balances) {
    if (balance.subId !== 0n) continue;
    const key = balance.asset.toLowerCase();
    balanceByAsset.set(key, (balanceByAsset.get(key) ?? 0n) + balance.balance);
  }

  return params.configs.map((config) => {
    const tokenDecimals = config.tokenDecimals ?? params.cashDecimals;
    const balance18 = balanceByAsset.get(config.protocolAsset.toLowerCase()) ?? 0n;
    const multiplier = config.scaledUi
      ? params.multipliers.get(config.assetId) ?? null
      : null;
    const conversionReady = !config.scaledUi || multiplier !== null;
    return {
      ...config,
      tokenDecimals,
      balance18,
      multiplier,
      conversionReady,
      displayBalance18: conversionReady
        ? withdrawableDisplayBalance18(balance18, multiplier)
        : null,
      maxNativeAmount: maxNativeAmount(balance18, tokenDecimals),
    };
  });
}

/** Replace only the cash descriptor with its interest-adjusted simulated balance. */
export function applyInterestAdjustedCashBalance(
  assets: readonly WithdrawableAsset[],
  cashBalanceWithInterest18: bigint,
): WithdrawableAsset[] {
  return assets.map((asset) => {
    if (asset.assetId !== "cash") return asset;
    return {
      ...asset,
      balance18: cashBalanceWithInterest18,
      displayBalance18: withdrawableDisplayBalance18(
        cashBalanceWithInterest18,
        asset.multiplier,
      ),
      maxNativeAmount: maxNativeAmount(
        cashBalanceWithInterest18,
        asset.tokenDecimals,
      ),
    };
  });
}
