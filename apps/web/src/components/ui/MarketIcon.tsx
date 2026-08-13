import Image from "next/image";
import type { MarketId } from "@/lib/protocol/markets";
import { cn } from "@/lib/utils";

const logos: Partial<Record<MarketId, string>> = {
  BTC: "/images/markets/btc.svg",
  XAU: "/images/markets/xaut.png",
  SPY: "/images/markets/spy.png",
  NVDA: "/images/markets/nvda.png",
};

export function MarketIcon({
  marketId,
  size = 20,
  className,
}: {
  marketId: MarketId;
  size?: number;
  className?: string;
}) {
  const src = logos[marketId];

  if (!src) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "inline-flex shrink-0 items-center justify-center font-mono text-[9px] font-semibold text-zinc-700",
          className,
        )}
        style={{ width: size, height: size }}
      >
        {marketId.slice(0, 2)}
      </span>
    );
  }

  return (
    <Image
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}
