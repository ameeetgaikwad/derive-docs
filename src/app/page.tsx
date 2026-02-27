"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

const DotGrid = dynamic(() => import("@/components/ui/DotGrid"), { ssr: false });

export default function Home() {
  return (
    <div className="relative flex min-h-[calc(100vh-3rem)] flex-col items-center justify-center overflow-hidden text-center">
      {/* Dot grid background */}
      <div className="absolute inset-0 opacity-20">
        <DotGrid
          dotSize={3}
          gap={28}
          baseColor="#fb923c"
          activeColor="#fb923c"
          proximity={120}
          shockRadius={200}
          shockStrength={4}
        />
      </div>

      {/* Content */}
      <div className="relative z-10 px-6">
        <h1 className="text-5xl font-bold tracking-[-0.04em] text-foreground font-heading sm:text-6xl">
          Options trading,
          <br />
          <span className="text-accent">simplified.</span>
        </h1>
        <p className="mx-auto mt-6 max-w-md text-base leading-relaxed text-secondary-foreground">
          Trade ETH &amp; BTC options with strategies that make sense. Powered by Derive.
        </p>
        <div className="mt-10 flex items-center justify-center gap-4">
          <Link
            href="/trade"
            className="inline-flex h-11 items-center justify-center rounded-md bg-accent px-8 text-sm font-semibold text-black transition-all hover:brightness-110"
          >
            Start Trading
          </Link>
          <Link
            href="/portfolio"
            className="inline-flex h-11 items-center justify-center rounded-md border-[0.5px] border-border px-8 text-sm font-medium text-secondary-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            Portfolio
          </Link>
        </div>
      </div>
    </div>
  );
}
