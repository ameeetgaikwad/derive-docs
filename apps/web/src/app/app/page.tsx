import type { Metadata } from "next";
import { TradeWorkspace } from "@/components/platform/TradeWorkspace";

export const metadata: Metadata = { title: "Covered calls" };

export default function TradingPage() {
  return <TradeWorkspace />;
}
