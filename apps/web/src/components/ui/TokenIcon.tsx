"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Token icon URLs — uses cryptocurrency-icons (jsDelivr) for common tokens,
 * simplr-sh/coin-logos for newer wrapped tokens, with a letter fallback.
 */

const CRYPTO_ICONS_BASE = "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color";
const COIN_LOGOS_BASE = "https://cdn.jsdelivr.net/gh/simplr-sh/coin-logos/images";

const TOKEN_ICON_MAP: Record<string, string> = {
  BTC: `${CRYPTO_ICONS_BASE}/btc.svg`,
  ETH: `${CRYPTO_ICONS_BASE}/eth.svg`,
  USDC: `${CRYPTO_ICONS_BASE}/usdc.svg`,
  USDT: `${CRYPTO_ICONS_BASE}/usdt.svg`,
  WBTC: `${CRYPTO_ICONS_BASE}/wbtc.svg`,
  WETH: `${CRYPTO_ICONS_BASE}/weth.svg`,
  DAI: `${CRYPTO_ICONS_BASE}/dai.svg`,
  CBBTC: `${COIN_LOGOS_BASE}/coinbase-wrapped-btc/standard.png`,
  LBTC: `${COIN_LOGOS_BASE}/lombard-staked-btc/standard.png`,
  CBETH: `${COIN_LOGOS_BASE}/coinbase-wrapped-staked-eth/standard.png`,
  STETH: `${COIN_LOGOS_BASE}/staked-ether/standard.png`,
  RETH: `${COIN_LOGOS_BASE}/rocket-pool-eth/standard.png`,
};

/** Canonical display name for wrapped tokens */
const DISPLAY_NAMES: Record<string, string> = {
  CBBTC: "BTC",
  WBTC: "BTC",
  LBTC: "BTC",
  WETH: "ETH",
  CBETH: "ETH",
  STETH: "ETH",
  RETH: "ETH",
};

export function tokenDisplayName(asset: string): string {
  return DISPLAY_NAMES[asset] ?? asset;
}

interface TokenIconProps {
  symbol: string;
  size?: number;
  className?: string;
}

export function TokenIcon({ symbol, size = 24, className }: TokenIconProps) {
  const [failed, setFailed] = useState(false);
  const upper = symbol.toUpperCase();
  const url = TOKEN_ICON_MAP[upper];
  const displayChar = (DISPLAY_NAMES[upper] ?? upper).charAt(0);

  if (!url || failed) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-accent/10 font-bold text-accent",
          className
        )}
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        {displayChar}
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={upper}
      width={size}
      height={size}
      className={cn("rounded-full", className)}
      onError={() => setFailed(true)}
    />
  );
}
