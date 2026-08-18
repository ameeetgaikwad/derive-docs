"use client";

import { useId, useState } from "react";
import { formatUnits } from "viem";
import { toast } from "sonner";
import { useCoveredCallSubaccount } from "@/hooks/protocol/useCoveredCallSubaccount";
import { cn } from "@/lib/utils";

function cashLabel(balance: bigint): string {
  const amount = Number(formatUnits(balance, 18));
  return amount.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function SubaccountSelector({
  disabled = false,
  className,
}: {
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  const [isCreating, setIsCreating] = useState(false);
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

  const create = async () => {
    setIsCreating(true);
    try {
      const accountId = await createSubaccount();
      toast.success(`Subaccount #${accountId.toString()} created and selected`);
    } catch (creationError) {
      toast.error(
        creationError instanceof Error ? creationError.message : String(creationError),
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <section className={cn("border-b-[0.5px] border-zinc-200 py-4", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <label htmlFor={id} className="min-w-0 flex-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
            Trading subaccount
          </span>
          <select
            id={id}
            aria-label="Trading subaccount"
            value={subaccountId?.toString() ?? ""}
            disabled={disabled || isLoading || error !== null}
            onChange={(event) =>
              selectSubaccount(
                event.target.value === "" ? null : BigInt(event.target.value),
              )
            }
            className="mt-2 h-11 w-full rounded-[5px] border border-zinc-300 bg-white px-3 font-mono text-xs text-zinc-950 outline-none focus:border-orange-500 disabled:bg-zinc-50 disabled:text-zinc-400"
          >
            <option value="">
              {isLoading ? "Loading subaccounts..." : "Choose a subaccount"}
            </option>
            {accounts.map((account) => (
              <option key={account.accountId.toString()} value={account.accountId.toString()}>
                #{account.accountId.toString()} - {cashLabel(account.cashBalance)} USDT - {account.nonZeroBalanceCount} {account.nonZeroBalanceCount === 1 ? "balance" : "balances"}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={disabled || isCreating}
          onClick={() => void create()}
          className="min-h-11 shrink-0 rounded-[5px] border border-zinc-300 px-4 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-700 hover:border-orange-500 hover:text-orange-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isCreating
            ? "Creating..."
            : accounts.length > 0
              ? "Create another subaccount"
              : "Create subaccount"}
        </button>
      </div>

      {error ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-red-700">
          <span>{error.message}</span>
          <button
            type="button"
            aria-label="Retry subaccount discovery"
            disabled={isFetching}
            onClick={() => void refetch()}
            className="font-mono text-[10px] font-semibold uppercase underline underline-offset-2 disabled:opacity-50"
          >
            {isFetching ? "Retrying..." : "Retry"}
          </button>
        </div>
      ) : !isLoading && accounts.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-500">No subaccounts yet. Create one to start trading.</p>
      ) : source === "rpc" ? (
        <p className="mt-3 text-xs text-amber-700">
          Directory unavailable; accounts were recovered from on-chain events.
        </p>
      ) : null}
    </section>
  );
}
