"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { getDeriveChain } from "@/lib/chain/derive";
import { Button } from "@/components/ui/button";
import type { DeriveEnv } from "@/lib/derive/constants";

export function NetworkGuard() {
  const { chain, isConnected } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected) return null;

  const env = (process.env.NEXT_PUBLIC_DERIVE_ENV ?? "mainnet") as DeriveEnv;
  const deriveChain = getDeriveChain(env);

  if (chain?.id === deriveChain.id) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-3 rounded-lg border border-warning/50 bg-card px-4 py-3 shadow-lg">
        <div className="h-2 w-2 rounded-full bg-warning animate-pulse" />
        <span className="text-sm">
          Switch to {deriveChain.name} to trade
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={isPending}
          onClick={() => switchChain({ chainId: deriveChain.id })}
        >
          {isPending ? "Switching..." : "Switch Network"}
        </Button>
      </div>
    </div>
  );
}
