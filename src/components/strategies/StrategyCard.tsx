"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useStrategyPreview } from "@/hooks/strategies/useStrategyPreview";
import { useExecuteStrategy } from "@/hooks/strategies/useExecuteStrategy";
import { useDerive } from "@/providers/DeriveProvider";
import { StrategyPreviewPanel } from "./StrategyPreviewPanel";
import type { StrategyDefinition } from "@/lib/strategies/types";
import { cn } from "@/lib/utils";

interface StrategyCardProps {
  strategy: StrategyDefinition;
}

const RISK_COLORS = {
  low: "border-success/50 bg-success/5 text-success",
  medium: "border-warning/50 bg-warning/5 text-warning",
  high: "border-destructive/50 bg-destructive/5 text-destructive",
};

export function StrategyCard({ strategy }: StrategyCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [amount, setAmount] = useState("1");
  const { preview, isLoading } = useStrategyPreview(strategy);
  const { execute, isPending } = useExecuteStrategy();
  const { isAuthenticated } = useDerive();

  const handleExecute = () => {
    if (!preview) return;
    execute(preview, amount);
  };

  return (
    <Card terminalPath={`~/strategies/${strategy.id}`} className="overflow-hidden">
      {/* Header */}
      <button
        className="w-full text-left transition-colors hover:bg-secondary/30"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-mono text-lg font-semibold">{strategy.name}</h3>
            <p className="mt-1 font-mono text-sm text-muted-foreground">
              {strategy.shortDescription}
            </p>
          </div>
          <span
            className={cn(
              "rounded-md border px-2.5 py-0.5 font-mono text-xs font-medium",
              RISK_COLORS[strategy.riskLevel]
            )}
          >
            {strategy.riskLevel}
          </span>
        </div>

        <p className="mt-3 font-mono text-xs text-muted-foreground">
          {strategy.description}
        </p>

        <div className="mt-3 flex items-center gap-4 font-mono text-xs text-muted-foreground">
          <span>
            Max Loss: <span className="text-destructive">{strategy.maxLoss}</span>
          </span>
          <span>
            Max Gain: <span className="text-success">{strategy.maxGain}</span>
          </span>
        </div>
      </button>

      {/* Expanded preview + execution */}
      {expanded && (
        <div className="border-t-2 border-border space-y-4 p-6 pt-4">
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-4 w-32 animate-pulse rounded bg-secondary" />
              <div className="h-24 animate-pulse rounded bg-secondary" />
              <div className="h-4 w-48 animate-pulse rounded bg-secondary" />
            </div>
          ) : preview ? (
            <>
              <StrategyPreviewPanel preview={preview} />

              <div>
                <label className="mb-1 block font-mono text-xs text-muted-foreground">
                  Amount (contracts)
                </label>
                <Input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </div>

              <Button
                className="w-full"
                variant={strategy.direction === "buy" ? "success" : "destructive"}
                disabled={!isAuthenticated || isPending || parseFloat(amount) <= 0}
                onClick={handleExecute}
              >
                {!isAuthenticated
                  ? "Connect Wallet"
                  : isPending
                  ? "Submitting..."
                  : `${strategy.direction === "buy" ? "Buy" : "Sell"} — ${strategy.name}`}
              </Button>
            </>
          ) : (
            <p className="font-mono text-sm text-muted-foreground">
              No suitable instrument found for this strategy right now.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
