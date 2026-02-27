"use client";

import dynamic from "next/dynamic";

const PortfolioContent = dynamic(() => import("@/components/pages/PortfolioContent"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="h-6 w-24 animate-pulse rounded bg-card-elevated" />
        <div className="h-24 animate-pulse rounded-[10px] border-[0.5px] border-border bg-card" />
        <div className="h-48 animate-pulse rounded-[10px] border-[0.5px] border-border bg-card" />
      </div>
    </div>
  ),
});

export default function PortfolioPage() {
  return <PortfolioContent />;
}
