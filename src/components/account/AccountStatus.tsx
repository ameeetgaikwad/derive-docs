"use client";

import { useWalletAuth } from "@/hooks/account/useWalletAuth";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";

export function AccountStatus() {
  const { isConnected } = useAccount();
  const { isWalletAuthed, walletSubaccountId, isAuthenticating, error, authenticate } = useWalletAuth();

  if (!isConnected) return null;

  if (error) {
    return (
      <div className="flex items-center gap-2">
        <div className="max-w-xs truncate rounded-md border-2 border-destructive bg-card px-2 py-1 font-mono text-xs text-destructive">
          {error}
        </div>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={authenticate}>
          Retry
        </Button>
      </div>
    );
  }

  if (isAuthenticating) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border-2 border-border bg-card px-2 py-1 font-mono text-xs">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
        <span className="text-muted-foreground">connecting...</span>
      </div>
    );
  }

  if (isWalletAuthed && walletSubaccountId) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border-2 border-border bg-card px-2 py-1 font-mono text-xs">
        <div className="h-1.5 w-1.5 rounded-full bg-success" />
        <span className="text-muted-foreground">sub#{walletSubaccountId}</span>
      </div>
    );
  }

  // Not authed yet — show sign in button
  return (
    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={authenticate}>
      Sign in to Derive
    </Button>
  );
}
