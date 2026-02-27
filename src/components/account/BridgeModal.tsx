"use client";

import { useState, useEffect } from "react";
import { useAccount, useBalance, useConfig as useWagmiConfig } from "wagmi";
import { useBridgeToDerive, type BridgeStep } from "@/hooks/mutations/useBridge";
import { estimateBridgeFee } from "@/lib/derive/bridge";
import {
  getSupportedChains,
  getSupportedTokens,
  getBridgeConfig,
  type BridgeToken,
  type SourceChainId,
} from "@/lib/derive/bridge-config";
import { formatUnits } from "viem";
import { cn } from "@/lib/utils";

const STEP_LABELS: Record<BridgeStep, string> = {
  idle: "",
  switching: "Switching network...",
  approving: "Approving token spend...",
  bridging: "Sending bridge transaction...",
  confirming: "Waiting for bridge confirmation...",
  done: "Bridge complete!",
};

/** Bridge form content — can be embedded standalone or inside a modal */
export function BridgeForm() {
  const { address } = useAccount();
  const wagmiConfig = useWagmiConfig();
  const chains = getSupportedChains();
  const [selectedChain, setSelectedChain] = useState<SourceChainId>(42161);
  const [selectedToken, setSelectedToken] = useState<BridgeToken>("USDC");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState<bigint | null>(null);
  const [feeLoading, setFeeLoading] = useState(false);

  const bridge = useBridgeToDerive();
  const tokens = getSupportedTokens(selectedChain);
  const tokenConfig = getBridgeConfig(selectedChain, selectedToken);

  const { data: balance } = useBalance({
    address,
    token: tokenConfig?.token,
    chainId: selectedChain,
  });

  useEffect(() => {
    const available = getSupportedTokens(selectedChain);
    if (!available.includes(selectedToken)) {
      setSelectedToken(available[0]);
    }
  }, [selectedChain, selectedToken]);

  useEffect(() => {
    let cancelled = false;
    setFee(null);
    setFeeLoading(true);
    estimateBridgeFee({ wagmiConfig, sourceChainId: selectedChain, token: selectedToken })
      .then((f) => {
        if (!cancelled) setFee(f);
      })
      .catch(() => {
        if (!cancelled) setFee(null);
      })
      .finally(() => {
        if (!cancelled) setFeeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wagmiConfig, selectedChain, selectedToken]);

  const handleBridge = () => {
    const val = parseFloat(amount);
    if (!val || val <= 0) return;
    bridge.mutate({ sourceChainId: selectedChain, token: selectedToken, amount });
  };

  const handleMaxClick = () => {
    if (balance) {
      setAmount(balance.formatted);
    }
  };

  return (
    <div className="space-y-4">
      {/* Source chain selector */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Source Chain
        </label>
        <div className="flex flex-wrap gap-1.5">
          {chains.map((chain) => (
            <button
              key={chain.id}
              onClick={() => setSelectedChain(chain.id)}
              disabled={bridge.isPending}
              className={cn(
                "rounded-md border-[0.5px] px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                selectedChain === chain.id
                  ? "border-blue-500 bg-blue-500/10 text-blue-500"
                  : "border-border bg-background text-muted-foreground hover:text-secondary-foreground"
              )}
            >
              {chain.name}
            </button>
          ))}
        </div>
      </div>

      {/* Token selector */}
      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Token
        </label>
        <div className="flex gap-1.5">
          {tokens.map((t) => (
            <button
              key={t}
              onClick={() => setSelectedToken(t)}
              disabled={bridge.isPending}
              className={cn(
                "rounded-md border-[0.5px] px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50",
                selectedToken === t
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border bg-background text-muted-foreground hover:text-secondary-foreground"
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Balance */}
      <div className="rounded-[10px] border-[0.5px] border-border bg-background p-3">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{selectedToken} on {chains.find(c => c.id === selectedChain)?.name}</span>
          <span className="text-foreground">
            {balance ? `${Number(balance.formatted).toFixed(4)} ${selectedToken}` : "\u2014"}
          </span>
        </div>
      </div>

      {/* Amount input */}
      <div className="relative">
        <input
          type="number"
          placeholder="0.00"
          min="0"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={bridge.isPending}
          className="w-full rounded-[10px] border-[0.5px] border-border bg-background py-3 pl-4 pr-20 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground disabled:opacity-50 focus:border-accent"
        />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {balance && Number(balance.formatted) > 0 && (
            <button onClick={handleMaxClick} className="text-[10px] font-semibold text-blue-500">
              MAX
            </button>
          )}
          <span className="text-xs text-muted-foreground">{selectedToken}</span>
        </div>
      </div>

      {/* Fee display */}
      <div className="text-xs text-muted-foreground">
        {feeLoading ? (
          "Estimating bridge fee..."
        ) : fee !== null ? (
          <>Bridge fee: ~{Number(formatUnits(fee, 18)).toFixed(6)} ETH</>
        ) : (
          "Fee unavailable"
        )}
      </div>

      {/* Step indicator */}
      {bridge.isPending && bridge.step !== "idle" && (
        <div className="flex items-center gap-2 text-xs text-secondary-foreground">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-blue-500" />
          {STEP_LABELS[bridge.step]}
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleBridge}
        disabled={bridge.isPending || !amount || parseFloat(amount) <= 0}
        className="w-full rounded-md bg-blue-500 py-3 text-sm font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-30"
      >
        {bridge.isPending
          ? STEP_LABELS[bridge.step] || "Processing..."
          : `Bridge ${selectedToken} to Derive`}
      </button>

      {/* Error */}
      {bridge.isError && bridge.error && (
        <p className="text-xs text-destructive">{bridge.error.message}</p>
      )}

      {/* Success tx hash */}
      {bridge.bridgeTxHash && !bridge.isPending && (
        <div className="rounded-[10px] border-[0.5px] border-success/30 bg-success/5 p-3">
          <div className="text-xs text-success">
            Bridge complete!
          </div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            Tx: {bridge.bridgeTxHash.slice(0, 14)}...{bridge.bridgeTxHash.slice(-8)}
          </div>
        </div>
      )}
    </div>
  );
}

interface BridgeModalProps {
  open: boolean;
  onClose: () => void;
}

/** Standalone bridge modal with dark chrome */
export function BridgeModal({ open, onClose }: BridgeModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div className="relative w-full max-w-md overflow-hidden rounded-[10px] border-[0.5px] border-border bg-card">
        <div className="flex items-center justify-between border-b border-border bg-card-elevated px-5 py-3">
          <span className="text-sm font-bold tracking-[-0.03em] text-foreground font-heading">
            Bridge to Derive
          </span>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          <BridgeForm />
        </div>
      </div>
    </div>
  );
}
