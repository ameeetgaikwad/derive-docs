import type { QueryClient } from "@tanstack/react-query";
import type { Address } from "viem";
import { subaccountScopeKey } from "@/stores/account";
import type { AppChainId } from "@/stores/network";

/** Refreshes exact balances, subaccount summaries, and wallet contract reads after funds move. */
export async function refreshFundsQueries(
  queryClient: QueryClient,
  params: { owner: Address; chainId: AppChainId; matching: Address },
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: ["subaccounts", subaccountScopeKey(params.owner, params.chainId, params.matching)],
    }),
    queryClient.invalidateQueries({ queryKey: ["readContract"] }),
    queryClient.invalidateQueries({ queryKey: ["readContracts"] }),
    queryClient.invalidateQueries({ queryKey: ["cashBalanceWithInterest"] }),
  ]);
}
