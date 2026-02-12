"use client";

import { formatInstrumentName, formatUsd } from "@/lib/derive/utils";
import { PayoffDiagram } from "./PayoffDiagram";
import type { StrategyPreview } from "@/lib/strategies/types";

interface StrategyPreviewPanelProps {
  preview: StrategyPreview;
}

export function StrategyPreviewPanel({ preview }: StrategyPreviewPanelProps) {
  return (
    <div className="space-y-4">
      {/* Instrument */}
      <div className="rounded-md border-2 border-border/30 bg-secondary p-3">
        <p className="font-mono text-xs text-muted-foreground">Selected Instrument</p>
        <p className="mt-0.5 font-mono text-sm font-medium">
          {formatInstrumentName(preview.instrument.instrument_name)}
        </p>
      </div>

      {/* Payoff Diagram */}
      <PayoffDiagram
        strategyId={preview.strategy.id}
        strikePrice={preview.strikePrice}
        premium={preview.estimatedCost}
        spotPrice={preview.spotPrice}
      />

      {/* Details */}
      <div className="space-y-2 font-mono text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Spot Price</span>
          <span>{formatUsd(preview.spotPrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Strike Price</span>
          <span>{formatUsd(preview.strikePrice)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            {preview.strategy.direction === "buy" ? "Premium (Cost)" : "Premium (Income)"}
          </span>
          <span>{formatUsd(preview.estimatedCost)}</span>
        </div>
        <div className="flex justify-between border-t-2 border-border pt-2">
          <span className="text-muted-foreground">Breakeven</span>
          <span className="font-medium">
            {formatUsd(preview.breakeven)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Max Loss</span>
          <span className="text-destructive">
            {preview.maxLoss < 0 ? "Unlimited" : formatUsd(preview.maxLoss)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Max Gain</span>
          <span className="text-success">
            {preview.maxGain === null
              ? "Unlimited"
              : formatUsd(preview.maxGain)}
          </span>
        </div>
      </div>
    </div>
  );
}
