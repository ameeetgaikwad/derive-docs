"use client";

import dynamic from "next/dynamic";

const MarketsContent = dynamic(() => import("@/components/pages/MarketsContent"), {
  ssr: false,
  loading: () => (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Markets</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
    </div>
  ),
});

export default function MarketsPage() {
  return <MarketsContent />;
}
