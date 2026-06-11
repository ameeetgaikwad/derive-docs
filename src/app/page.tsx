"use client";

import { CoveredCallFlow } from "@/components/earn/CoveredCallFlow";
import { CoveredCallPositions } from "@/components/earn/CoveredCallPositions";

export default function Home() {
  return (
    <>
      <CoveredCallFlow />
      <CoveredCallPositions />
    </>
  );
}
