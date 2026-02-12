"use client";

import dynamic from "next/dynamic";

const TradeContent = dynamic(() => import("@/components/pages/TradeContent"), {
  ssr: false,
  loading: () => (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Trade</h1>
      <div className="h-96 animate-pulse rounded-lg border border-border bg-card" />
    </div>
  ),
});

export default function TradePage() {
  return <TradeContent />;
}
