"use client";

import { useState, useEffect } from "react";
import { useAccount, useBalance, useConfig as useWagmiConfig } from "wagmi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
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
        <label className="mb-1 block font-mono text-xs text-muted-foreground">
          Source Chain
        </label>
        <div className="flex flex-wrap gap-1">
          {chains.map((chain) => (
            <button
              key={chain.id}
              onClick={() => setSelectedChain(chain.id)}
              disabled={bridge.isPending}
              className={cn(
                "rounded-md border-2 px-3 py-1 font-mono text-xs font-medium transition-colors",
                selectedChain === chain.id
                  ? "border-accent bg-accent text-white"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {chain.name}
            </button>
          ))}
        </div>
      </div>

      {/* Token selector */}
      <div>
        <label className="mb-1 block font-mono text-xs text-muted-foreground">
          Token
        </label>
        <div className="flex gap-1">
          {tokens.map((t) => (
            <button
              key={t}
              onClick={() => setSelectedToken(t)}
              disabled={bridge.isPending}
              className={cn(
                "rounded-md border-2 px-3 py-1 font-mono text-xs font-medium transition-colors",
                selectedToken === t
                  ? "border-success bg-success text-white"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Balance */}
      <div className="rounded-md border-2 border-border/30 bg-secondary p-3 font-mono text-sm">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{selectedToken} Balance</span>
          <span className="font-medium">
            {balance ? `${Number(balance.formatted).toFixed(4)} ${selectedToken}` : "\u2014"}
          </span>
        </div>
      </div>

      {/* Amount input */}
      <div>
        <label className="mb-1 block font-mono text-xs text-muted-foreground">
          Amount
        </label>
        <div className="relative">
          <Input
            type="number"
            placeholder="0.00"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={bridge.isPending}
          />
          {balance && Number(balance.formatted) > 0 && (
            <button
              onClick={handleMaxClick}
              className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-xs text-foreground underline underline-offset-2 hover:text-accent"
            >
              MAX
            </button>
          )}
        </div>
      </div>

      {/* Fee display */}
      <div className="font-mono text-xs text-muted-foreground">
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
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
          {STEP_LABELS[bridge.step]}
        </div>
      )}

      {/* Submit button */}
      <Button
        onClick={handleBridge}
        disabled={bridge.isPending || !amount || parseFloat(amount) <= 0}
        className="w-full"
      >
        {bridge.isPending
          ? STEP_LABELS[bridge.step] || "Processing..."
          : `Bridge ${selectedToken} to Derive`}
      </Button>

      {/* Error */}
      {bridge.isError && bridge.error && (
        <p className="font-mono text-xs text-destructive">{bridge.error.message}</p>
      )}

      {/* Success tx hash */}
      {bridge.bridgeTxHash && !bridge.isPending && (
        <p className="font-mono text-xs text-muted-foreground">
          Tx: {bridge.bridgeTxHash.slice(0, 10)}...{bridge.bridgeTxHash.slice(-8)}
        </p>
      )}
    </div>
  );
}

interface BridgeModalProps {
  open: boolean;
  onClose: () => void;
}

/** Standalone bridge modal with terminal-style chrome */
export function BridgeModal({ open, onClose }: BridgeModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-background/80" onClick={onClose} />

      <div className="relative w-full max-w-md overflow-hidden rounded-md border-2 border-border bg-card">
        <div className="flex items-center justify-between border-b-2 border-border bg-foreground px-3 py-1.5">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-success" />
            <span className="font-mono text-xs text-primary-foreground">
              ~/bridge/deposit
            </span>
          </div>
          <button
            onClick={onClose}
            className="font-mono text-xs text-primary-foreground hover:text-white"
          >
            [x]
          </button>
        </div>

        <div className="p-6">
          <BridgeForm />
        </div>
      </div>
    </div>
  );
}
