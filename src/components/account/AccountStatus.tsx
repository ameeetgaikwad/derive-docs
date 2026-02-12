"use client";

import { useDerive } from "@/providers/DeriveProvider";
import { Button } from "@/components/ui/button";

export function AccountStatus() {
  const { status, isReady, isAuthenticated, needsAuth, needsAccount, subaccountId, error, authenticate } = useDerive();

  if (error) {
    return (
      <div className="flex items-center gap-2">
        <div className="max-w-xs truncate rounded-md border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
          {error}
        </div>
        <Button variant="outline" size="sm" onClick={authenticate}>
          Retry
        </Button>
      </div>
    );
  }

  if (needsAuth) {
    return (
      <Button variant="outline" size="sm" onClick={authenticate}>
        Sign in to Derive
      </Button>
    );
  }

  if (needsAccount) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-1.5 text-xs text-warning">
        No Derive account found
      </div>
    );
  }

  if (!isAuthenticated && status !== "disconnected") {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs">
        <div className="h-2 w-2 animate-pulse rounded-full bg-warning" />
        <span className="text-muted-foreground">{status.replace(/_/g, " ")}</span>
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs">
      <div className="h-2 w-2 rounded-full bg-success" />
      <span className="text-muted-foreground">Sub #{subaccountId}</span>
    </div>
  );
}
