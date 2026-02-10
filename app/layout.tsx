import type { Metadata } from "next";
import "./globals.css";
import WalletProvider from "./components/WalletProvider";

export const metadata: Metadata = {
  title: "Axiom",
  description: "Onchain derivatives trading terminal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
