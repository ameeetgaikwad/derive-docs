"use client";

import { useMemo } from "react";
import { useInstruments } from "@/hooks/market/useInstruments";
import { useLiveTickers } from "@/hooks/market/useLiveTickers";
import { useSpotPrice } from "@/hooks/market/useSpotPrice";
import { useMarketsStore } from "@/stores/markets";
import {
  groupByExpiry,
  buildOptionChain,
  filterByExpiry,
  getMoneyness,
} from "@/lib/derive/instrument-utils";
import { formatExpiryTimestamp, formatUsd } from "@/lib/derive/utils";
import * as Tabs from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

interface OptionChainProps {
  onSelectInstrument: (instrumentName: string, direction: "buy" | "sell") => void;
}

export function OptionChain({ onSelectInstrument }: OptionChainProps) {
  const { data: instruments, isLoading } = useInstruments("ETH", "option");
  const { selectedExpiry, setSelectedExpiry, setSelectedInstrument } = useMarketsStore();
  const spotPrice = useSpotPrice();

  const expiryGroups = useMemo(
    () => (instruments ? groupByExpiry(instruments) : []),
    [instruments]
  );

  // Auto-select first expiry
  const activeExpiry = selectedExpiry ?? expiryGroups[0]?.expiry ?? null;

  const expiryInstruments = useMemo(
    () =>
      instruments && activeExpiry
        ? filterByExpiry(instruments, activeExpiry)
        : [],
    [instruments, activeExpiry]
  );

  // Get ticker data for the expiry's instruments (REST + WS live overlay)
  const instrumentNames = useMemo(
    () => expiryInstruments.map((i) => i.instrument_name),
    [expiryInstruments]
  );
  const { tickerMap } = useLiveTickers(instrumentNames);

  const optionChain = useMemo(
    () => buildOptionChain(expiryInstruments, tickerMap as never),
    [expiryInstruments, tickerMap]
  );

  if (isLoading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-10 animate-pulse rounded bg-secondary" />
        ))}
      </div>
    );
  }

  if (expiryGroups.length === 0) {
    return (
      <div className="py-8 text-center font-mono text-muted-foreground">
        No active ETH options found.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Expiry Tabs */}
      <Tabs.Root
        value={String(activeExpiry)}
        onValueChange={(v) => setSelectedExpiry(Number(v))}
      >
        <Tabs.List className="flex gap-1 overflow-x-auto pb-2">
          {expiryGroups.map((group) => (
            <Tabs.Trigger
              key={group.expiry}
              value={String(group.expiry)}
              className={cn(
                "shrink-0 rounded-md border-2 px-3 py-1.5 font-mono text-xs font-medium transition-colors",
                "data-[state=active]:border-border data-[state=active]:bg-foreground data-[state=active]:text-primary-foreground",
                "data-[state=inactive]:border-transparent data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-secondary"
              )}
            >
              {formatExpiryTimestamp(group.expiry)}
              <span className="ml-1 text-[10px] opacity-60">
                {group.daysUntil}d
              </span>
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </Tabs.Root>

      {/* Option Chain Table */}
      <div className="overflow-x-auto">
        <table className="w-full font-mono text-sm">
          <thead>
            <tr className="border-b-2 border-border text-xs text-muted-foreground">
              <th className="pb-2 text-right font-medium">Bid</th>
              <th className="pb-2 text-right font-medium">Ask</th>
              <th className="pb-2 text-right font-medium">Mark</th>
              <th className="pb-2 text-right font-medium">IV</th>
              <th className="pb-2 text-center font-bold text-foreground">Strike</th>
              <th className="pb-2 text-left font-medium">IV</th>
              <th className="pb-2 text-left font-medium">Mark</th>
              <th className="pb-2 text-left font-medium">Bid</th>
              <th className="pb-2 text-left font-medium">Ask</th>
            </tr>
            <tr className="text-xs text-muted-foreground">
              <th colSpan={4} className="pb-1 text-center font-medium text-success">
                CALLS
              </th>
              <th />
              <th colSpan={4} className="pb-1 text-center font-medium text-destructive">
                PUTS
              </th>
            </tr>
          </thead>
          <tbody>
            {optionChain.map((row) => {
              const moneyness = spotPrice
                ? getMoneyness(row.strike, spotPrice, "C")
                : "OTM";
              const isAtm = moneyness === "ATM";

              return (
                <tr
                  key={row.strike}
                  className={cn(
                    "border-b border-border/30 transition-colors hover:bg-secondary/50",
                    isAtm && "bg-accent/5"
                  )}
                >
                  {/* Call side */}
                  <td
                    className="cursor-pointer py-2 pr-2 text-right text-success hover:bg-success/10"
                    onClick={() =>
                      row.call &&
                      onSelectInstrument(row.call.instrument_name, "buy")
                    }
                  >
                    {row.callTicker && parseFloat(row.callTicker.best_bid_price) > 0
                      ? formatUsd(row.callTicker.best_bid_price)
                      : "-"}
                  </td>
                  <td
                    className="cursor-pointer py-2 pr-2 text-right text-destructive hover:bg-destructive/10"
                    onClick={() =>
                      row.call &&
                      onSelectInstrument(row.call.instrument_name, "sell")
                    }
                  >
                    {row.callTicker && parseFloat(row.callTicker.best_ask_price) > 0
                      ? formatUsd(row.callTicker.best_ask_price)
                      : "-"}
                  </td>
                  <td className="py-2 pr-2 text-right text-muted-foreground">
                    {row.callTicker?.mark_price && parseFloat(row.callTicker.mark_price) > 0
                      ? formatUsd(row.callTicker.mark_price)
                      : "-"}
                  </td>
                  <td className="py-2 pr-2 text-right text-muted-foreground">
                    {row.callTicker?.option_pricing?.iv
                      ? `${(parseFloat(row.callTicker.option_pricing.iv) * 100).toFixed(0)}%`
                      : "-"}
                  </td>

                  {/* Strike */}
                  <td
                    className={cn(
                      "py-2 text-center font-bold",
                      isAtm && "text-accent"
                    )}
                  >
                    {row.strike.toLocaleString()}
                  </td>

                  {/* Put side */}
                  <td className="py-2 pl-2 text-left text-muted-foreground">
                    {row.putTicker?.option_pricing?.iv
                      ? `${(parseFloat(row.putTicker.option_pricing.iv) * 100).toFixed(0)}%`
                      : "-"}
                  </td>
                  <td className="py-2 pl-2 text-left text-muted-foreground">
                    {row.putTicker?.mark_price && parseFloat(row.putTicker.mark_price) > 0
                      ? formatUsd(row.putTicker.mark_price)
                      : "-"}
                  </td>
                  <td
                    className="cursor-pointer py-2 pl-2 text-left text-success hover:bg-success/10"
                    onClick={() =>
                      row.put &&
                      onSelectInstrument(row.put.instrument_name, "buy")
                    }
                  >
                    {row.putTicker && parseFloat(row.putTicker.best_bid_price) > 0
                      ? formatUsd(row.putTicker.best_bid_price)
                      : "-"}
                  </td>
                  <td
                    className="cursor-pointer py-2 pl-2 text-left text-destructive hover:bg-destructive/10"
                    onClick={() =>
                      row.put &&
                      onSelectInstrument(row.put.instrument_name, "sell")
                    }
                  >
                    {row.putTicker && parseFloat(row.putTicker.best_ask_price) > 0
                      ? formatUsd(row.putTicker.best_ask_price)
                      : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
