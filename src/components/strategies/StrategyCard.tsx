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
  low: "bg-success/10 text-success",
  medium: "bg-warning/10 text-warning",
  high: "bg-destructive/10 text-destructive",
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
    <Card className="overflow-hidden">
      {/* Header */}
      <button
        className="w-full text-left p-6 transition-colors hover:bg-secondary/30"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">{strategy.name}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {strategy.shortDescription}
            </p>
          </div>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              RISK_COLORS[strategy.riskLevel]
            )}
          >
            {strategy.riskLevel}
          </span>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          {strategy.description}
        </p>

        <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
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
        <div className="border-t border-border p-6 space-y-4">
          {isLoading ? (
            <div className="space-y-2">
              <div className="h-4 w-32 animate-pulse rounded bg-muted" />
              <div className="h-24 animate-pulse rounded bg-muted" />
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            </div>
          ) : preview ? (
            <>
              <StrategyPreviewPanel preview={preview} />

              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
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
            <p className="text-sm text-muted-foreground">
              No suitable instrument found for this strategy right now.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
