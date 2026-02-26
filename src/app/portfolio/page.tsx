"use client";

import dynamic from "next/dynamic";

const PortfolioContent = dynamic(() => import("@/components/pages/PortfolioContent"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen p-6" style={{ background: "#0b1018" }}>
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="h-6 w-24 animate-pulse rounded" style={{ background: "#1e293b" }} />
        <div className="h-24 animate-pulse rounded-xl border" style={{ borderColor: "#1e293b", background: "#111827" }} />
        <div className="h-48 animate-pulse rounded-xl border" style={{ borderColor: "#1e293b", background: "#111827" }} />
      </div>
    </div>
  ),
});

export default function PortfolioPage() {
  return <PortfolioContent />;
}
