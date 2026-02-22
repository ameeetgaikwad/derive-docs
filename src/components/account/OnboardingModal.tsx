"use client";

import { useState } from "react";
import { useDerive } from "@/providers/DeriveProvider";
import * as Dialog from "@radix-ui/react-dialog";
import { Button } from "@/components/ui/button";
import { BridgeModal } from "./BridgeModal";

const statusMessages: Record<string, string> = {
  checking_account: "Checking your Derive account...",
  creating_account: "Creating your Derive account...",
  generating_session_key: "Generating session key...",
  sponsoring_setup: "Please sign to set up your account (gas-free)...",
  registering_session_key: "Registering session key...",
};

export function OnboardingModal() {
  const { status, error, isOnboarding, needsAccount, authenticate } = useDerive();
  const [isCreating, setIsCreating] = useState(false);
  const [showBridge, setShowBridge] = useState(false);

  const isOpen = isOnboarding || status === "error" || needsAccount;

  const handleCreateAccount = async () => {
    setIsCreating(true);
    try {
      // authenticate() handles everything via paymaster:
      // create account → register session key → approvals → create subaccount
      await authenticate();
    } catch {
      // Error handled by store
    } finally {
      setIsCreating(false);
    }
  };

  const titleText = needsAccount
    ? "~/derive/setup"
    : status === "error"
    ? "~/derive/error"
    : "~/derive/connect";

  return (
    <Dialog.Root open={isOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-foreground/20" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-md border-2 border-border bg-card shadow-xl">
          {/* Terminal header bar */}
          <div className="flex items-center gap-2 border-b-2 border-border bg-foreground px-3 py-1.5">
            <div className="h-2.5 w-2.5 rounded-full bg-success" />
            <span className="font-mono text-xs text-primary-foreground">{titleText}</span>
          </div>

          <div className="p-6">
            {needsAccount ? (
              <>
                <Dialog.Title className="font-mono text-base font-semibold">
                  Set Up Derive Account
                </Dialog.Title>
                <Dialog.Description className="mt-2 font-mono text-sm text-muted-foreground">
                  No subaccount found for your wallet. Create one to start trading,
                  or deposit USDC first if you haven&apos;t already.
                </Dialog.Description>

                <div className="mt-4 space-y-2 rounded-md border-2 border-border/30 bg-secondary p-3 font-mono text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">What happens (gas-free):</p>
                  <ol className="list-inside list-decimal space-y-1">
                    <li>Your wallet is registered with Derive</li>
                    <li>A subaccount is created</li>
                    <li>A session key is registered for seamless trading</li>
                    <li>Token approvals are set up</li>
                  </ol>
                  <p className="mt-1">You&apos;ll sign once — no ETH needed.</p>
                </div>

                <div className="mt-6 space-y-3">
                  <Button
                    className="w-full"
                    onClick={handleCreateAccount}
                    disabled={isCreating}
                  >
                    {isCreating ? "Setting up..." : "Create Account & Sign In"}
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={authenticate}
                  >
                    I already have a subaccount — Retry
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setShowBridge(true)}
                  >
                    Bridge funds to Derive
                  </Button>
                </div>
                <BridgeModal open={showBridge} onClose={() => setShowBridge(false)} />

                {error && (
                  <p className="mt-3 font-mono text-xs text-destructive">
                    {error}
                  </p>
                )}
              </>
            ) : status === "error" ? (
              <>
                <Dialog.Title className="font-mono text-base font-semibold">
                  Error
                </Dialog.Title>
                <Dialog.Description className="mt-2 font-mono text-sm text-destructive">
                  {error}
                </Dialog.Description>
                <div className="mt-6">
                  <Button onClick={authenticate} className="w-full">
                    Try Again
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Dialog.Title className="font-mono text-base font-semibold">
                  Connecting to Derive
                </Dialog.Title>
                <Dialog.Description className="mt-2 font-mono text-sm text-muted-foreground">
                  {statusMessages[status] ?? "Setting up your session..."}
                </Dialog.Description>
                <div className="mt-6 flex items-center gap-3">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                  <p className="font-mono text-sm text-muted-foreground">
                    {status === "sponsoring_setup"
                      ? "Confirm the signature in your wallet..."
                      : status === "registering_session_key"
                      ? "Waiting for wallet confirmation..."
                      : "Please wait..."}
                  </p>
                </div>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
