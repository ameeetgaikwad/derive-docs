import type { Address, Hex } from "viem";
import deployments56 from "../../../../../protocol/deployments/staging/56.json";
import deployments97 from "../../../../../protocol/deployments/97.json";
import { getActiveChainId, type AppChainId } from "@/stores/network";

/**
 * sats-options / Hedge BSC deployments.
 *
 * Source of truth: protocol/deployments/staging/56.json for the isolated
 * mainnet smoke deployment and protocol/deployments/97.json for testnet. Both
 * are imported so the app can switch networks at runtime; the active one is
 * chosen from the network store.
 *
 * Feed keys of note:
 *  - btcSpotFeed     — legacy LyraSpotFeed (fallback)
 *  - btcPythSpotFeed — the live Pyth-adapter spot feed the protocol uses
 *  - btcPythPriceId  — Pyth BTC/USD price id (for Hermes REST fallback)
 */

const RAW = {
  56: deployments56,
  97: deployments97,
} as const;

type RawDeployment = (typeof RAW)[keyof typeof RAW];

if (RAW[56].chainId !== 56) {
  throw new Error(`protocol/deployments/staging/56.json chainId mismatch: ${RAW[56].chainId}`);
}
if (RAW[97].chainId !== 97) {
  throw new Error(`protocol/deployments/97.json chainId mismatch: ${RAW[97].chainId}`);
}

export interface ChainAddresses {
  matching: Address;
  rfqModule: Address;
  subAccounts: Address;
  standardManager: Address;
  srmViewer: Address;
  cashAsset: Address;
  btcOptionAsset: Address;
  btcBaseAsset: Address;
  btcb: Address;
  usdt: Address;
  btcSpotFeed: Address;
  /** Live Pyth-adapter spot feed (getSpot() -> (uint spot, uint confidence), 18dp). */
  btcPythSpotFeed?: Address;
  /** Pyth BTC/USD price id, for the Hermes REST display fallback. */
  btcPythPriceId?: Hex;
  btcForwardFeed: Address;
  btcVolFeed: Address;
  btcRateFeed: Address;
  depositModule: Address;
  withdrawalModule: Address;
}

function toAddresses(d: RawDeployment): ChainAddresses {
  const rec = d as unknown as Record<string, string | undefined>;
  return {
    matching: rec.matching as Address,
    rfqModule: rec.rfqModule as Address,
    subAccounts: rec.subAccounts as Address,
    standardManager: rec.standardManager as Address,
    srmViewer: rec.srmViewer as Address,
    cashAsset: rec.cashAsset as Address,
    btcOptionAsset: rec.btcOptionAsset as Address,
    btcBaseAsset: rec.btcBaseAsset as Address,
    btcb: rec.btcb as Address,
    usdt: rec.usdt as Address,
    btcSpotFeed: rec.btcSpotFeed as Address,
    btcPythSpotFeed: rec.btcPythSpotFeed as Address | undefined,
    btcPythPriceId: rec.btcPythPriceId as Hex | undefined,
    btcForwardFeed: rec.btcForwardFeed as Address,
    btcVolFeed: rec.btcVolFeed as Address,
    btcRateFeed: rec.btcRateFeed as Address,
    depositModule: rec.depositModule as Address,
    withdrawalModule: rec.withdrawalModule as Address,
  };
}

const ADDRESSES_BY_CHAIN: Record<AppChainId, ChainAddresses> = {
  56: toAddresses(RAW[56]),
  97: toAddresses(RAW[97]),
};

const DOMAIN_SEPARATOR_BY_CHAIN: Record<AppChainId, Hex> = {
  56: RAW[56].matchingDomainSeparator as Hex,
  97: RAW[97].matchingDomainSeparator as Hex,
};

const ACTION_TYPEHASH_BY_CHAIN: Record<AppChainId, Hex> = {
  56: RAW[56].actionTypehash as Hex,
  97: RAW[97].actionTypehash as Hex,
};

/** Addresses for a specific chain. */
export function getAddresses(chainId: AppChainId): ChainAddresses {
  return ADDRESSES_BY_CHAIN[chainId];
}

/** On-chain-verified EIP-712 domain separator for a specific chain. */
export function getExpectedDomainSeparator(chainId: AppChainId): Hex {
  return DOMAIN_SEPARATOR_BY_CHAIN[chainId];
}

/** ACTION_TYPEHASH as read from the deployed Matching contract on a chain. */
export function getExpectedActionTypehash(chainId: AppChainId): Hex {
  return ACTION_TYPEHASH_BY_CHAIN[chainId];
}

const EXPLORER_URL_BY_CHAIN: Record<AppChainId, string> = {
  56: "https://bscscan.com",
  97: "https://testnet.bscscan.com",
};

export function getExplorerUrl(chainId: AppChainId): string {
  return EXPLORER_URL_BY_CHAIN[chainId];
}

export function explorerTxUrl(
  txHash: string,
  chainId: AppChainId = getActiveChainId()
): string {
  return `${getExplorerUrl(chainId)}/tx/${txHash}`;
}

/**
 * Active-chain convenience accessors. These read the network store's
 * module-level mirror, so they always reflect the current app network — but
 * they are *not* React-reactive on their own. Components/hooks that must
 * re-render on a network change should use `useNetwork()` (hooks/protocol),
 * which reads the store and returns the same address maps reactively.
 *
 * Kept for non-React callers (EIP-712 signing helpers) and as a stable default.
 */
export function activeAddresses(): ChainAddresses {
  return ADDRESSES_BY_CHAIN[getActiveChainId()];
}
