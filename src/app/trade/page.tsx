"use client";

import dynamic from "next/dynamic";

const TradeContent = dynamic(() => import("@/components/pages/TradeContent"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_320px]">
        <div className="h-96 animate-pulse rounded-[10px] border-[0.5px] border-border bg-card" />
        <div className="h-48 animate-pulse rounded-[10px] border-[0.5px] border-border bg-card" />
      </div>
    </div>
  ),
});

export default function TradePage() {
  return <TradeContent />;
}
