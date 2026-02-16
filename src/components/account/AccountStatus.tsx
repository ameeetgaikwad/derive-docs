"use client";

import { useDerive } from "@/providers/DeriveProvider";
import { Button } from "@/components/ui/button";

export function AccountStatus() {
  const { status, isReady, isAuthenticated, needsAuth, needsAccount, subaccountId, error, authenticate } = useDerive();

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

  if (needsAuth) {
    return (
      <Button variant="outline" size="sm" className="h-7 text-xs" onClick={authenticate}>
        Sign in to Derive
      </Button>
    );
  }

  if (needsAccount) {
    return (
      <div className="rounded-md border-2 border-warning bg-card px-2 py-1 font-mono text-xs text-warning">
        No Derive account
      </div>
    );
  }

  if (!isAuthenticated && status !== "disconnected") {
    return (
      <div className="flex items-center gap-1.5 rounded-md border-2 border-border bg-card px-2 py-1 font-mono text-xs">
        <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
        <span className="text-muted-foreground">{status.replace(/_/g, " ")}</span>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="flex items-center gap-1.5 rounded-md border-2 border-border bg-card px-2 py-1 font-mono text-xs">
      <div className="h-1.5 w-1.5 rounded-full bg-success" />
      <span className="text-muted-foreground">sub#{subaccountId}</span>
    </div>
  );
}
