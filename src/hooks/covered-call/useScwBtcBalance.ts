"use client";

import { useQuery } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { createPublicClient, erc20Abi, formatUnits, http } from "viem";
import { getConfig } from "@/lib/derive/constants";
import { getDeriveChain } from "@/lib/chain/derive";

/**
 * Read the SCW's on-chain BTC balance (WBTC + cbBTC).
 * This is the amount available to deposit into a new covered call subaccount.
 */
export function useScwBtcBalance() {
  const { deriveWallet, isAuthenticated } = useDerive();

  return useQuery({
    queryKey: ["scw-btc-balance", deriveWallet],
    queryFn: async () => {
      if (!deriveWallet) return { balance: 0, assetName: "CBBTC" as string };

      const config = getConfig();
      const deriveEnv = (process.env.NEXT_PUBLIC_DERIVE_ENV as "testnet" | "mainnet") || "mainnet";
      const chain = getDeriveChain(deriveEnv);

      const publicClient = createPublicClient({
        chain,
        transport: http(config.rpcUrl),
      });

      const btcTokens = [
        { address: config.cbbtcAddress, name: "CBBTC", decimals: 8 },
        { address: config.wbtcAddress, name: "WBTC", decimals: 8 },
      ].filter((t) => t.address !== "0x0000000000000000000000000000000000000000");

      let maxBalance = 0n;
      let maxAssetName = "CBBTC";
      let maxDecimals = 8;

      for (const token of btcTokens) {
        const bal = await publicClient.readContract({
          address: token.address as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [deriveWallet],
        });
        if (bal > maxBalance) {
          maxBalance = bal;
          maxAssetName = token.name;
          maxDecimals = token.decimals;
        }
      }

      return {
        balance: parseFloat(formatUnits(maxBalance, maxDecimals)),
        assetName: maxAssetName,
      };
    },
    enabled: isAuthenticated && !!deriveWallet,
    refetchInterval: 15_000,
  });
}
