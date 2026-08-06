"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { useNetwork } from "@/hooks/protocol/useNetwork";

export function NetworkGuard() {
  const { chain, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const { chainId: activeChainId, chain: activeChain } = useNetwork();

  if (!isConnected) return null;
  if (chain?.id === activeChainId) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-lg border border-warning/50 bg-card px-4 py-3 shadow-lg">
        <div className="h-2 w-2 rounded-full bg-warning animate-pulse" />
        <span className="text-sm">Switch to {activeChain.name} to trade</span>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => switchChain({ chainId: activeChainId })}
        >
          {isPending ? "Switching..." : "Switch Network"}
        </Button>
      </div>
    </div>
  );
}
