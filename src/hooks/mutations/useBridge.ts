"use client";

import { useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { useWalletClient, useSwitchChain, useConfig as useWagmiConfig } from "wagmi";
import { parseUnits } from "viem";
import { useDerive } from "@/providers/DeriveProvider";
import { bridgeToDerive, getBridgeStatus } from "@/lib/derive/bridge";
import { getBridgeConfig } from "@/lib/derive/bridge-config";
import type { BridgeToken, SourceChainId } from "@/lib/derive/bridge-config";
import type { BridgeMessageStatus } from "@/lib/derive/bridge";
import { toast } from "sonner";

export type BridgeStep = "idle" | "switching" | "approving" | "bridging" | "confirming" | "done";

interface BridgeParams {
  sourceChainId: SourceChainId;
  token: BridgeToken;
  /** Human-readable amount, e.g. "100" */
  amount: string;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function useBridgeToDerive() {
  const { deriveWallet } = useDerive();
  const { data: walletClient } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const wagmiConfig = useWagmiConfig();
  const [step, setStep] = useState<BridgeStep>("idle");
  const [bridgeTxHash, setBridgeTxHash] = useState<string | null>(null);

  const pollStatus = useCallback(
    async (chainId: SourceChainId, txHash: string): Promise<BridgeMessageStatus> => {
      for (let i = 0; i < 60; i++) {
        await sleep(5000);
        const status = await getBridgeStatus(chainId, txHash);
        if (status === "COMPLETED") return "COMPLETED";
      }
      return "PENDING";
    },
    [],
  );

  const mutation = useMutation({
    mutationFn: async ({ sourceChainId, token, amount }: BridgeParams) => {
      if (!walletClient || !deriveWallet) {
        throw new Error("Wallet not connected or Derive wallet not resolved");
      }

      const config = getBridgeConfig(sourceChainId, token);
      if (!config) throw new Error(`Unsupported token ${token} on chain ${sourceChainId}`);

      // Switch to source chain if needed
      if (walletClient.chain?.id !== sourceChainId) {
        setStep("switching");
        await switchChainAsync({ chainId: sourceChainId });
      }

      // Approve + Bridge (approval check is inside bridgeToDerive)
      setStep("approving");
      const scaledAmount = parseUnits(amount, config.decimals);

      setStep("bridging");
      const txHash = await bridgeToDerive({
        walletClient,
        wagmiConfig,
        sourceChainId,
        token,
        amount: scaledAmount,
        scwAddress: deriveWallet,
      });

      setBridgeTxHash(txHash);

      // Poll for completion
      setStep("confirming");
      const status = await pollStatus(sourceChainId, txHash);

      if (status === "COMPLETED") {
        setStep("done");
      }

      return { txHash, status };
    },
    onSuccess: ({ status }) => {
      if (status === "COMPLETED") {
        toast.success("Bridge complete! Funds are on Derive.");
      } else {
        toast.info("Bridge submitted. Funds should arrive shortly.");
      }
      setStep("idle");
    },
    onError: (error) => {
      toast.error(`Bridge failed: ${error.message}`);
      setStep("idle");
    },
  });

  return { ...mutation, step, bridgeTxHash };
}
