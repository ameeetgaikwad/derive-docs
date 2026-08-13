"use client";

import { useNetworkStore, type EnabledAppChainId } from "@/stores/network";
import {
  getAddresses,
  getExpectedActionTypehash,
  getExpectedDomainSeparator,
  getExplorerUrl,
  type ChainAddresses,
} from "@/lib/protocol/deployments";
import { getAppChain, type AppChain } from "@/lib/protocol/chain";

export interface NetworkContext {
  /** Active frontend chain. Chain 56 is the isolated mainnet staging deployment. */
  chainId: EnabledAppChainId;
  isTestnet: boolean;
  chain: AppChain;
  addresses: ChainAddresses;
  explorerUrl: string;
  domainSeparator: `0x${string}`;
  actionTypehash: `0x${string}`;
  setChainId: (chainId: EnabledAppChainId) => void;
}

/**
 * Reactive access to the active protocol network. Re-renders consumers when
 * the enabled network changes. Returns the deployment addresses, explorer,
 * and viem chain for the active network.
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
    setChainId,
  };
}
