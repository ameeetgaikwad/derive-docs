"use client";

import { useEffect } from "react";
import { useAccountStore } from "@/stores/account";

/** Prevent global account changes while a trading lifecycle owns its context. */
export function useSubaccountSelectionLock(isLocked: boolean): void {
  const setSelectionLocked = useAccountStore((state) => state.setSelectionLocked);

  useEffect(() => {
    setSelectionLocked(isLocked);
    return () => setSelectionLocked(false);
  }, [isLocked, setSelectionLocked]);
}
