"use client";

import dynamic from "next/dynamic";

const StrategiesContent = dynamic(() => import("@/components/pages/StrategiesContent"), {
  ssr: false,
  loading: () => (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Strategies</h1>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
    </div>
  ),
});

export default function StrategiesPage() {
  return <StrategiesContent />;
}
