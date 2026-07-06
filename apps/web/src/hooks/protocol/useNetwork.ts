"use client";

import { useNetworkStore, type AppChainId } from "@/stores/network";
import {
  getAddresses,
  getExpectedActionTypehash,
  getExpectedDomainSeparator,
  getExplorerUrl,
  type ChainAddresses,
} from "@/lib/protocol/deployments";
import { getAppChain, type AppChain } from "@/lib/protocol/chain";
import { rfqEngineUrl } from "@/lib/protocol/rfq-engine";

export interface NetworkContext {
  /** Active app chainId (56 mainnet / 97 testnet). */
  chainId: AppChainId;
  isTestnet: boolean;
  chain: AppChain;
  addresses: ChainAddresses;
  explorerUrl: string;
  domainSeparator: `0x${string}`;
  actionTypehash: `0x${string}`;
  rfqEngineUrl: string;
  setChainId: (chainId: AppChainId) => void;
}

/**
 * Reactive access to the active protocol network. Re-renders consumers when
 * the user flips the network toggle. Returns the deployment addresses,
 * explorer, rfq-engine URL and viem chain for the active network.
 */
export function useNetwork(): NetworkContext {
  const chainId = useNetworkStore((s) => s.chainId);
  const setChainId = useNetworkStore((s) => s.setChainId);

  return {
    chainId,
    isTestnet: chainId === 97,
    chain: getAppChain(chainId),
    addresses: getAddresses(chainId),
    explorerUrl: getExplorerUrl(chainId),
    domainSeparator: getExpectedDomainSeparator(chainId),
    actionTypehash: getExpectedActionTypehash(chainId),
    rfqEngineUrl: rfqEngineUrl(chainId),
    setChainId,
  };
}
