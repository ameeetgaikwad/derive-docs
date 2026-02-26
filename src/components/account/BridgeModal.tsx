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
        <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
          Source Chain
        </label>
        <div className="flex flex-wrap gap-1.5">
          {chains.map((chain) => (
            <button
              key={chain.id}
              onClick={() => setSelectedChain(chain.id)}
              disabled={bridge.isPending}
              className="rounded-lg border px-3 py-1.5 font-mono text-xs font-medium transition-colors disabled:opacity-50"
              style={{
                borderColor: selectedChain === chain.id ? "#3b82f6" : "#1e293b",
                background: selectedChain === chain.id ? "rgba(59, 130, 246, 0.1)" : "#0b1018",
                color: selectedChain === chain.id ? "#3b82f6" : "#6b7280",
              }}
            >
              {chain.name}
            </button>
          ))}
        </div>
      </div>

      {/* Token selector */}
      <div>
        <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider" style={{ color: "#6b7280" }}>
          Token
        </label>
        <div className="flex gap-1.5">
          {tokens.map((t) => (
            <button
              key={t}
              onClick={() => setSelectedToken(t)}
              disabled={bridge.isPending}
              className="rounded-lg border px-3 py-1.5 font-mono text-xs font-medium transition-colors disabled:opacity-50"
              style={{
                borderColor: selectedToken === t ? "#22c55e" : "#1e293b",
                background: selectedToken === t ? "rgba(34, 197, 94, 0.1)" : "#0b1018",
                color: selectedToken === t ? "#22c55e" : "#6b7280",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Balance */}
      <div className="rounded-lg border p-3" style={{ borderColor: "#1e293b", background: "#0b1018" }}>
        <div className="flex items-center justify-between font-mono text-xs">
          <span style={{ color: "#6b7280" }}>{selectedToken} on {chains.find(c => c.id === selectedChain)?.name}</span>
          <span style={{ color: "#e5e7eb" }}>
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
          className="w-full rounded-lg border py-3 pl-4 pr-20 font-mono text-sm outline-none transition-colors disabled:opacity-50"
          style={{ borderColor: "#1e293b", background: "#0b1018", color: "#e5e7eb" }}
        />
        <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
          {balance && Number(balance.formatted) > 0 && (
            <button onClick={handleMaxClick} className="font-mono text-[10px] font-semibold" style={{ color: "#3b82f6" }}>
              MAX
            </button>
          )}
          <span className="font-mono text-xs" style={{ color: "#6b7280" }}>{selectedToken}</span>
        </div>
      </div>

      {/* Fee display */}
      <div className="font-mono text-xs" style={{ color: "#6b7280" }}>
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
        <div className="flex items-center gap-2 font-mono text-xs" style={{ color: "#9ca3af" }}>
          <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: "#3b82f6" }} />
          {STEP_LABELS[bridge.step]}
        </div>
      )}

      {/* Submit button */}
      <button
        onClick={handleBridge}
        disabled={bridge.isPending || !amount || parseFloat(amount) <= 0}
        className="w-full rounded-lg py-3 font-mono text-sm font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-30"
        style={{ background: "#3b82f6", color: "#ffffff" }}
      >
        {bridge.isPending
          ? STEP_LABELS[bridge.step] || "Processing..."
          : `Bridge ${selectedToken} to Derive`}
      </button>

      {/* Error */}
      {bridge.isError && bridge.error && (
        <p className="font-mono text-xs" style={{ color: "#ef4444" }}>{bridge.error.message}</p>
      )}

      {/* Success tx hash */}
      {bridge.bridgeTxHash && !bridge.isPending && (
        <div className="rounded-lg border p-3" style={{ borderColor: "rgba(34, 197, 94, 0.3)", background: "rgba(34, 197, 94, 0.05)" }}>
          <div className="font-mono text-xs" style={{ color: "#22c55e" }}>
            Bridge complete!
          </div>
          <div className="mt-1 font-mono text-[10px]" style={{ color: "#6b7280" }}>
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
      <div className="absolute inset-0" style={{ background: "rgba(0, 0, 0, 0.7)" }} onClick={onClose} />

      <div className="relative w-full max-w-md overflow-hidden rounded-xl border" style={{ borderColor: "#1e293b", background: "#111827" }}>
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "#1e293b" }}>
          <span className="font-mono text-sm font-semibold" style={{ color: "#e5e7eb" }}>
            Bridge to Derive
          </span>
          <button onClick={onClose} style={{ color: "#6b7280" }}>
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
