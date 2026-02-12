"use client";

import { useMemo } from "react";
import { formatExpiryTimestamp, daysUntilExpiry, parseInstrumentName } from "@/lib/derive/utils";
import type { Position } from "@/lib/derive/types";
import { cn } from "@/lib/utils";

interface ExpiryTimelineProps {
  positions: Position[];
}

interface ExpiryBucket {
  expiry: string;
  timestamp: number;
  daysUntil: number;
  count: number;
}

export function ExpiryTimeline({ positions }: ExpiryTimelineProps) {
  const buckets = useMemo(() => {
    const map = new Map<string, ExpiryBucket>();

    for (const pos of positions) {
      const parsed = parseInstrumentName(pos.instrument_name);
      if (!("expiry" in parsed) || !parsed.expiry) continue;

      const key = parsed.expiry;
      if (map.has(key)) {
        map.get(key)!.count++;
      } else {
        // Parse the expiry string to timestamp
        const year = key.slice(0, 4);
        const month = key.slice(4, 6);
        const day = key.slice(6, 8);
        const ts = new Date(`${year}-${month}-${day}T08:00:00Z`).getTime() / 1000;
        map.set(key, {
          expiry: key,
          timestamp: ts,
          daysUntil: daysUntilExpiry(ts),
          count: 1,
        });
      }
    }

    return Array.from(map.values()).sort((a, b) => a.timestamp - b.timestamp);
  }, [positions]);

  if (buckets.length === 0) {
    return (
      <div className="py-4 text-center text-sm text-muted-foreground">
        No upcoming expiries
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold text-muted-foreground">
        Upcoming Expiries
      </h4>
      <div className="flex items-end gap-2">
        {buckets.map((bucket) => {
          const isUrgent = bucket.daysUntil <= 1;
          const isSoon = bucket.daysUntil <= 3;
          return (
            <div key={bucket.expiry} className="flex flex-col items-center gap-1">
              <span className="text-xs font-mono text-muted-foreground">
                {bucket.count}
              </span>
              <div
                className={cn(
                  "w-10 rounded-t",
                  isUrgent
                    ? "bg-destructive"
                    : isSoon
                    ? "bg-warning"
                    : "bg-primary"
                )}
                style={{ height: `${Math.max(20, bucket.count * 20)}px` }}
              />
              <span className="text-[10px] text-muted-foreground">
                {formatExpiryTimestamp(bucket.timestamp)}
              </span>
              <span
                className={cn(
                  "text-[10px] font-medium",
                  isUrgent
                    ? "text-destructive"
                    : isSoon
                    ? "text-warning"
                    : "text-muted-foreground"
                )}
              >
                {bucket.daysUntil}d
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
