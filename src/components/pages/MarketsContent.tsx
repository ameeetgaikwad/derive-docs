"use client";

import { useInstruments } from "@/hooks/market/useInstruments";
import { useSpotPrice } from "@/hooks/market/useSpotPrice";
import { groupByExpiry } from "@/lib/derive/instrument-utils";
import { formatExpiryTimestamp, formatUsd } from "@/lib/derive/utils";
import { Card } from "@/components/ui/card";
import Link from "next/link";

export default function MarketsContent() {
  const { data: instruments, isLoading, error } = useInstruments("ETH", "option");
  const spotPrice = useSpotPrice();

  const expiryGroups = instruments ? groupByExpiry(instruments) : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Markets</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ETH option expiries
          </p>
        </div>
        {spotPrice && (
          <div className="text-right">
            <p className="text-sm text-muted-foreground">ETH Spot</p>
            <p className="text-xl font-bold">{formatUsd(spotPrice)}</p>
          </div>
        )}
      </div>

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="animate-pulse">
              <div className="h-4 w-24 rounded bg-muted" />
              <div className="mt-3 h-3 w-16 rounded bg-muted" />
              <div className="mt-4 flex gap-4">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-3 w-20 rounded bg-muted" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {error && (
        <Card className="border-destructive/50 text-destructive">
          Failed to load instruments: {(error as Error).message}
        </Card>
      )}

      {!isLoading && expiryGroups.length === 0 && !error && (
        <Card>
          <p className="text-muted-foreground">No active ETH options found.</p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {expiryGroups.map((group) => (
          <Link key={group.expiry} href={`/trade?expiry=${group.expiry}`}>
            <Card className="cursor-pointer transition-colors hover:border-primary/50">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">
                  {formatExpiryTimestamp(group.expiry)}
                </h3>
                <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                  {group.daysUntil}d
                </span>
              </div>
              <div className="mt-3 flex items-center gap-4 text-sm text-muted-foreground">
                <span>{group.callCount} calls</span>
                <span>{group.putCount} puts</span>
                <span>{group.instruments.length} total</span>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
