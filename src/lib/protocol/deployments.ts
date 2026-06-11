import type { Address, Hex } from "viem";
import deployments97 from "../../../protocol/deployments/97.json";

/**
 * sats-options BSC testnet (chainId 97) deployment.
 * Source of truth: protocol/deployments/97.json (written by the deploy script,
 * documented in protocol/TESTNET.md).
 */
export const CHAIN_ID = 97;

if (deployments97.chainId !== CHAIN_ID) {
  throw new Error(
    `protocol/deployments/97.json chainId mismatch: ${deployments97.chainId}`
  );
}

export const ADDRESSES = {
  matching: deployments97.matching as Address,
  rfqModule: deployments97.rfqModule as Address,
  subAccounts: deployments97.subAccounts as Address,
  standardManager: deployments97.standardManager as Address,
  cashAsset: deployments97.cashAsset as Address,
  btcOptionAsset: deployments97.btcOptionAsset as Address,
  btcBaseAsset: deployments97.btcBaseAsset as Address,
  btcb: deployments97.btcb as Address,
  usdt: deployments97.usdt as Address,
  btcSpotFeed: deployments97.btcSpotFeed as Address,
  btcForwardFeed: deployments97.btcForwardFeed as Address,
  btcVolFeed: deployments97.btcVolFeed as Address,
  btcRateFeed: deployments97.btcRateFeed as Address,
  depositModule: deployments97.depositModule as Address,
  withdrawalModule: deployments97.withdrawalModule as Address,
} as const;

/** On-chain-verified EIP-712 domain separator of the Matching contract. */
export const EXPECTED_DOMAIN_SEPARATOR =
  deployments97.matchingDomainSeparator as Hex;

/** ACTION_TYPEHASH as read from the deployed Matching contract. */
export const EXPECTED_ACTION_TYPEHASH = deployments97.actionTypehash as Hex;

export const EXPLORER_URL = "https://testnet.bscscan.com";

export function explorerTxUrl(txHash: string): string {
  return `${EXPLORER_URL}/tx/${txHash}`;
}
