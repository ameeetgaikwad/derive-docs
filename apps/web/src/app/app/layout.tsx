import type { Metadata } from "next";
import { AppClientShell } from "@/components/platform/AppClientShell";

export const metadata: Metadata = {
  title: "App",
  description: "Manage BTCB collateral, build covered calls, and monitor on-chain positions.",
};

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  return <AppClientShell>{children}</AppClientShell>;
}
