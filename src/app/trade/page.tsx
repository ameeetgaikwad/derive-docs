"use client";

import dynamic from "next/dynamic";

const TradeContent = dynamic(() => import("@/components/pages/TradeContent"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen p-6" style={{ background: "#0b1018" }}>
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1fr_320px]">
        <div className="h-96 animate-pulse rounded-xl border" style={{ borderColor: "#1e293b", background: "#111827" }} />
        <div className="h-48 animate-pulse rounded-lg border" style={{ borderColor: "#1e293b", background: "#111827" }} />
      </div>
    </div>
  ),
});

export default function TradePage() {
  return <TradeContent />;
}
