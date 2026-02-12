"use client";

import dynamic from "next/dynamic";

const PortfolioContent = dynamic(() => import("@/components/pages/PortfolioContent"), {
  ssr: false,
  loading: () => (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Portfolio</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
    </div>
  ),
});

export default function PortfolioPage() {
  return <PortfolioContent />;
}
