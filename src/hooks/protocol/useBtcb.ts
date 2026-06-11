"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseEther } from "viem";
import { useAccount, useConfig, useReadContract, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { toast } from "sonner";
import { mockErc20Abi } from "@/lib/protocol/abis";
import { ADDRESSES, CHAIN_ID } from "@/lib/protocol/deployments";
import { unitToNumber } from "@/lib/protocol/units";

/** Wallet BTCB (mock, 18 decimals) balance. */
export function useBtcbBalance() {
  const { address } = useAccount();

  const query = useReadContract({
    abi: mockErc20Abi,
    address: ADDRESSES.btcb,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 15_000 },
  });

  return {
    balance: query.data ?? 0n,
    balanceNumber: query.data !== undefined ? unitToNumber(query.data) : 0,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
}

/**
 * Testnet faucet: the mock BTCB has an unrestricted mint
 * (see protocol/TESTNET.md) — mint 1 BTCB to the connected wallet.
 */
export function useMintBtcb() {
  const { address } = useAccount();
  const config = useConfig();
  const { switchChainAsync } = useSwitchChain();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      if (!address) throw new Error("Wallet not connected");
      await switchChainAsync({ chainId: CHAIN_ID }).catch(() => {});
      const hash = await writeContract(config, {
        abi: mockErc20Abi,
        address: ADDRESSES.btcb,
        functionName: "mint",
        args: [address, parseEther("1")],
        chainId: CHAIN_ID,
      });
      await waitForTransactionReceipt(config, { hash, chainId: CHAIN_ID });
      return hash;
    },
    onSuccess: () => {
      toast.success("Minted 1 test BTCB");
      queryClient.invalidateQueries({ queryKey: ["readContract"] });
    },
    onError: (error) => {
      toast.error(`Mint failed: ${error.message}`);
    },
  });
}
