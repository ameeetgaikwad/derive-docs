"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Check, ChevronDown, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { formatUnits } from "viem";
import { useCoveredCallSubaccount } from "@/hooks/protocol/useCoveredCallSubaccount";
import { cn } from "@/lib/utils";
import { useAccountStore } from "@/stores/account";
import { useFundsStore } from "@/stores/funds";

function cashLabel(balance: bigint): string {
  const amount = Number(formatUnits(balance, 18));
  return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Global account switcher for the authenticated trading shell. */
export function SubaccountMenu(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectionLocked = useAccountStore((state) => state.selectionLocked);
  const openFunds = useFundsStore((state) => state.open);
  const {
    accounts,
    subaccountId,
    isLoading,
    isFetching,
    error,
    source,
    selectSubaccount,
    createSubaccount,
    refetch,
  } = useCoveredCallSubaccount();

  useEffect(() => {
    if (!isOpen) return;

    const closeFromOutside = (event: PointerEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      setIsOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [isOpen]);

  useEffect(
    () =>
      useAccountStore.subscribe((state, previous) => {
        if (state.selectionLocked && !previous.selectionLocked) setIsOpen(false);
      }),
    [],
  );

  const closeAndFocus = (): void => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  const create = async (): Promise<void> => {
    setIsCreating(true);
    try {
      const accountId = await createSubaccount();
      toast.success(`Subaccount #${accountId.toString()} created and selected`);
      closeAndFocus();
    } catch (creationError) {
      toast.error(
        creationError instanceof Error ? creationError.message : String(creationError),
      );
    } finally {
      setIsCreating(false);
    }
  };

  const triggerLabel = isLoading
    ? "Loading trading subaccounts"
    : subaccountId === null
      ? "Choose trading subaccount"
      : `Trading subaccount #${subaccountId.toString()}`;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={triggerLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        disabled={selectionLocked}
        title={selectionLocked ? "Account switching is locked while a trade is in progress" : undefined}
        onClick={() => setIsOpen((open) => !open)}
        className={cn(
          "inline-flex min-h-11 items-center gap-1.5 border-x-[0.5px] border-zinc-200 px-2.5 font-mono text-[11px] font-medium text-zinc-700 outline-none transition-colors hover:text-orange-700 focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 sm:px-3",
          selectionLocked && "cursor-not-allowed text-zinc-400",
        )}
      >
        <span className="hidden min-[480px]:inline">Account</span>
        <span className={subaccountId === null ? "text-zinc-500" : "text-zinc-950"}>
          {isLoading ? "..." : subaccountId === null ? "Choose" : `#${subaccountId.toString()}`}
        </span>
        <ChevronDown
          className={cn("size-3.5 transition-transform", isOpen && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label="Trading subaccounts"
          className="absolute right-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2.5rem)] border border-zinc-200 bg-white shadow-[0_14px_36px_rgba(24,24,27,0.12)]"
        >
          <div className="border-b-[0.5px] border-zinc-200 px-4 py-3">
            <p className="font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-500">
              Trading account
            </p>
            <p className="mt-1 text-xs leading-5 text-zinc-600">
              This account is used across Options and Positions.
            </p>
          </div>

          <div className="max-h-72 overflow-y-auto p-2">
            {isLoading ? (
              <p className="px-2 py-4 text-xs text-zinc-500">Loading validated accounts...</p>
            ) : error ? (
              <div className="px-2 py-3">
                <p role="alert" className="text-xs leading-5 text-red-700">
                  {error.message}
                </p>
                <button
                  type="button"
                  role="menuitem"
                  disabled={isFetching}
                  onClick={() => void refetch()}
                  className="mt-2 inline-flex min-h-11 items-center gap-2 font-mono text-[10px] font-semibold uppercase text-red-700 outline-none focus-visible:ring-2 focus-visible:ring-orange-500 disabled:opacity-50"
                >
                  <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} aria-hidden="true" />
                  {isFetching ? "Retrying..." : "Retry account discovery"}
                </button>
              </div>
            ) : accounts.length === 0 ? (
              <p className="px-2 py-4 text-xs leading-5 text-zinc-500">
                No subaccounts yet. Create one to start trading.
              </p>
            ) : (
              accounts.map((account) => {
                const selected = account.accountId === subaccountId;
                const balanceCountLabel = account.nonZeroBalanceCount === 1 ? "balance" : "balances";
                return (
                  <button
                    key={account.accountId.toString()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    onClick={() => {
                      selectSubaccount(account.accountId);
                      closeAndFocus();
                    }}
                    className="flex min-h-12 w-full items-center gap-3 px-2 text-left outline-none transition-colors hover:bg-orange-50 focus-visible:bg-orange-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500"
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center">
                      {selected && <Check className="size-4 text-orange-600" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-xs font-semibold text-zinc-950">
                        #{account.accountId.toString()}
                      </span>
                      <span className="block truncate text-[11px] text-zinc-500">
                        {cashLabel(account.cashBalance)} USDT · {account.nonZeroBalanceCount} {balanceCountLabel}
                      </span>
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {source === "rpc" && !error && (
            <p className="border-t-[0.5px] border-amber-200 bg-amber-50 px-4 py-2 text-[11px] leading-5 text-amber-800">
              Directory unavailable; accounts were recovered from on-chain events.
            </p>
          )}

          {!error && (
            <div className="border-t-[0.5px] border-zinc-200 p-2">
              <button
                type="button"
                role="menuitem"
                onClick={() => { openFunds(); closeAndFocus(); }}
                className="flex min-h-11 w-full items-center gap-3 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-zinc-700 outline-none transition-colors hover:bg-orange-50 hover:text-orange-700 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500"
              >
                <ArrowDownToLine className="size-4" aria-hidden="true" />
                Manage funds
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={isCreating || selectionLocked}
                onClick={() => void create()}
                className="flex min-h-11 w-full items-center gap-3 px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.06em] text-orange-700 outline-none transition-colors hover:bg-orange-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-orange-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-4" aria-hidden="true" />
                {isCreating ? "Creating..." : "Create subaccount"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
