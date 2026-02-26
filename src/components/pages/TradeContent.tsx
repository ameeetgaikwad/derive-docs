"use client";

import { CoveredCallFlow } from "@/components/earn/CoveredCallFlow";
import { CoveredCallPositions } from "@/components/earn/CoveredCallPositions";

export default function TradeContent() {
  return (
    <>
      <CoveredCallFlow />
      <CoveredCallPositions />
    </>
  );
}
