"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect } from "react";
import AssetsList from "./components/AssetsList";
import EarnDetail from "./components/EarnDetail";
import Positions from "./components/Positions";
import DeriveSessionProvider from "./components/DeriveSessionProvider";

type StrategyType = "covered_call" | "cash_secured_put";

export default function Home() {
  const [view, setView] = useState<"assets" | "earn" | "portfolio">("assets");
  const [selectedAsset, setSelectedAsset] = useState("ETH");
  const [selectedType, setSelectedType] = useState<StrategyType>("covered_call");

  const handleEarn = (asset: string, type: StrategyType) => {
    setSelectedAsset(asset);
    setSelectedType(type);
    setView("earn");
  };

  const handleBack = () => {
    setView("assets");
  };

  return (
    <DeriveSessionProvider>
      <div className="grid-bg min-h-screen">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[#d4cfc6] px-8 py-4">
          <div className="flex items-center gap-8">
            <h1 className="font-mono text-2xl font-bold tracking-tight text-[#1a1a1a]">
              axiom
            </h1>
            <nav className="flex items-center gap-6">
              <button
                onClick={() => setView("assets")}
                className={`font-mono text-sm transition-colors ${
                  view !== "portfolio"
                    ? "border-b border-[#1a1a1a] text-[#1a1a1a]"
                    : "text-[#6b6560] hover:text-[#1a1a1a]"
                }`}
              >
                Earn
              </button>
              <button
                onClick={() => setView("portfolio")}
                className={`font-mono text-sm transition-colors ${
                  view === "portfolio"
                    ? "border-b border-[#1a1a1a] text-[#1a1a1a]"
                    : "text-[#6b6560] hover:text-[#1a1a1a]"
                }`}
              >
                Portfolio
              </button>
            </nav>
          </div>
          <ConnectButton.Custom>
            {({
              account,
              chain,
              openAccountModal,
              openChainModal,
              openConnectModal,
              mounted,
            }) => {
              const connected = mounted && account && chain;
              const wrongChain = connected && chain?.unsupported;

              return (
                <div className="flex items-center gap-3">
                  {connected ? (
                    wrongChain ? (
                      <WrongChainButton openChainModal={openChainModal} />
                    ) : (
                      <button
                        onClick={openAccountModal}
                        className="connect-btn"
                      >
                        {account.displayName}
                      </button>
                    )
                  ) : (
                    <button
                      onClick={openConnectModal}
                      className="connect-btn"
                    >
                      Connect
                    </button>
                  )}
                </div>
              );
            }}
          </ConnectButton.Custom>
        </header>

        {/* Main Content */}
        <div className="mx-auto max-w-[1600px] px-6 py-6">
          {view === "assets" ? (
            <AssetsList onEarn={handleEarn} />
          ) : view === "earn" ? (
            <div className="mx-auto max-w-[800px]">
              <EarnDetail
                asset={selectedAsset}
                strategyType={selectedType}
                onBack={handleBack}
                onChangeAsset={setSelectedAsset}
                onChangeType={setSelectedType}
              />
            </div>
          ) : (
            <Positions />
          )}
        </div>
      </div>
    </DeriveSessionProvider>
  );
}

function WrongChainButton({
  openChainModal,
}: {
  openChainModal: () => void;
}) {
  useEffect(() => {
    openChainModal();
  }, [openChainModal]);

  return (
    <button
      onClick={openChainModal}
      className="connect-btn"
      style={{
        borderColor: "#ef4444",
        color: "#ef4444",
      }}
    >
      Wrong Network
    </button>
  );
}
