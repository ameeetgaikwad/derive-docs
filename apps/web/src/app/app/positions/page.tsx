import type { Metadata } from "next";
import { PositionsWorkspace } from "@/components/platform/PositionsWorkspace";

export const metadata: Metadata = { title: "Positions" };

export default function PositionsPage() {
  return <PositionsWorkspace />;
}
