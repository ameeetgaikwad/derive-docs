"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDerive } from "@/providers/DeriveProvider";
import { toast } from "sonner";

interface CancelOrderParams {
  orderId: string;
  instrumentName: string;
}

export function useCancelOrder() {
  const { restClient, subaccountId } = useDerive();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ orderId, instrumentName }: CancelOrderParams) => {
      if (!subaccountId) throw new Error("Not authenticated");
      return restClient.cancelOrder(orderId, subaccountId, instrumentName);
    },
    onSuccess: () => {
      toast.success("Order cancelled");
      queryClient.invalidateQueries({ queryKey: ["openOrders"] });
    },
    onError: (error) => {
      toast.error(`Cancel failed: ${error.message}`);
    },
  });
}
