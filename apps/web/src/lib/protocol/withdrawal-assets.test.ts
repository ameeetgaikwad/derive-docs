import { describe, expect, it } from "vitest";
import { getAddresses } from "./deployments";
import {
  applyInterestAdjustedCashBalance,
  displayAmount18ToNative,
  getWithdrawableAssetConfigs,
  maxNativeAmount,
  nativeAmountToBalance18,
  parseDecimalUnits,
  resolveWithdrawableAssets,
  withdrawableDisplayBalance18,
} from "./withdrawal-assets";

describe("withdrawal asset registry", () => {
  it("includes cash plus every manifest-backed deployed collateral on each chain", () => {
    expect(getWithdrawableAssetConfigs(97, getAddresses(97)).map((asset) => asset.symbol)).toEqual([
      "USDT",
      "BTCB",
      "XAUt",
      "SPYB",
      "NVDAB",
    ]);
    expect(getWithdrawableAssetConfigs(56, getAddresses(56)).map((asset) => asset.symbol)).toEqual([
      "USDT",
      "BTCB",
      "XAUt",
      "SPYB",
      "NVDAB",
    ]);
  });

  it("maps protocol assets separately from wallet tokens", () => {
    const addresses = getAddresses(97);
    const [cash, btcb] = getWithdrawableAssetConfigs(97, addresses);
    expect(cash).toMatchObject({
      assetId: "cash",
      marketId: null,
      kind: "cash",
      protocolAsset: addresses.cashAsset,
      tokenAddress: addresses.usdt,
    });
    expect(btcb).toMatchObject({
      assetId: "market:BTC",
      marketId: "BTC",
      kind: "market-collateral",
      protocolAsset: addresses.btcBaseAsset,
      tokenAddress: addresses.btcb,
      tokenDecimals: 18,
    });
  });

  it("keeps signed balances exact and blocks scaled display until its live multiplier resolves", () => {
    const configs = getWithdrawableAssetConfigs(97, getAddresses(97));
    const cash = configs[0];
    const scaled = configs.find((asset) => asset.scaledUi)!;
    const balances = [
      { asset: cash.protocolAsset, subId: 0n, balance: -1_234_567_890_123_456_789n },
      { asset: scaled.protocolAsset, subId: 0n, balance: 8n * 10n ** 18n },
    ];
    const unresolved = resolveWithdrawableAssets({
      configs,
      balances,
      cashDecimals: 6,
      multipliers: new Map(),
    });
    expect(unresolved[0]?.balance18).toBe(-1_234_567_890_123_456_789n);
    expect(unresolved.find((asset) => asset.assetId === scaled.assetId)).toMatchObject({
      conversionReady: false,
      displayBalance18: null,
    });

    const resolved = resolveWithdrawableAssets({
      configs,
      balances,
      cashDecimals: 6,
      multipliers: new Map([[scaled.assetId, 250_000_000_000_000_000n]]),
    });
    expect(resolved.find((asset) => asset.assetId === scaled.assetId)?.displayBalance18)
      .toBe(2n * 10n ** 18n);
  });

  it("uses interest-adjusted positive cash for display and native Max", () => {
    const configs = getWithdrawableAssetConfigs(97, getAddresses(97));
    const cashConfig = configs[0];
    const raw = resolveWithdrawableAssets({
      configs,
      balances: [{
        asset: cashConfig.protocolAsset,
        subId: 0n,
        balance: 1_000_000_000_000_000_000n,
      }],
      cashDecimals: 6,
      multipliers: new Map(),
    });
    const adjusted = applyInterestAdjustedCashBalance(
      raw,
      1_125_000_000_000_000_000n,
    );
    expect(adjusted[0]).toMatchObject({
      balance18: 1_125_000_000_000_000_000n,
      displayBalance18: 1_125_000_000_000_000_000n,
      maxNativeAmount: 1_125_000n,
    });
  });

  it("keeps interest-adjusted debt signed but exposes no withdrawable cash or Max", () => {
    const raw = resolveWithdrawableAssets({
      configs: getWithdrawableAssetConfigs(97, getAddresses(97)),
      balances: [],
      cashDecimals: 6,
      multipliers: new Map(),
    });
    const adjusted = applyInterestAdjustedCashBalance(
      raw,
      -750_000_000_000_000_001n,
    );
    expect(adjusted[0]).toMatchObject({
      balance18: -750_000_000_000_000_001n,
      displayBalance18: 0n,
      maxNativeAmount: 0n,
    });
  });
});

describe("exact withdrawal amount conversion", () => {
  it("parses native decimal strings without floating point or silent truncation", () => {
    expect(parseDecimalUnits("1.25", 6)).toBe(1_250_000n);
    expect(parseDecimalUnits("0.000001", 6)).toBe(1n);
    expect(() => parseDecimalUnits("0.0000001", 6)).toThrow(/at most 6 decimal places/i);
    expect(() => parseDecimalUnits("1e3", 18)).toThrow(/positive decimal/i);
    expect(() => parseDecimalUnits("-1", 18)).toThrow(/positive decimal/i);
  });

  it("floors Max for six-decimal collateral instead of overdrawing account dust", () => {
    const balance18 = 1_250_000_000_000_000_123n;
    const maxNative = maxNativeAmount(balance18, 6);
    expect(maxNative).toBe(1_250_000n);
    expect(nativeAmountToBalance18(maxNative, 6)).toBe(1_250_000_000_000_000_000n);
    expect(nativeAmountToBalance18(maxNative + 1n, 6)).toBeGreaterThan(balance18);
  });

  it("rounds a requested scaled display amount up to the native token quantum", () => {
    const multiplier = 250_000_000_000_000_000n;
    expect(displayAmount18ToNative(2n * 10n ** 18n, 18, multiplier)).toBe(8n * 10n ** 18n);
    expect(withdrawableDisplayBalance18(8n * 10n ** 18n, multiplier)).toBe(2n * 10n ** 18n);
  });

  it("rejects an invalid live multiplier for scaled collateral", () => {
    expect(() => displayAmount18ToNative(1n, 18, 0n)).toThrow(/multiplier/i);
  });
});
