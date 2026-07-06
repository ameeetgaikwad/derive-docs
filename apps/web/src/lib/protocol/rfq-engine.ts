/**
 * REST client for the sats-options rfq-engine
 * (services/rfq-engine — wire types mirrored from its src/types.ts).
 *
 * Flow: POST /rfq opens a short auction, GET /rfq/:id polls live state
 * (best quote is computed live while the window is open), and after the
 * window closes the taker signs a TakerOrder Action and POSTs it to
 * /rfq/:id/accept; the engine submits Matching.verifyAndMatch on-chain.
 */

import type { Hex } from "viem";
import type { SerializedAction } from "./actions";
import { getActiveChainId, type AppChainId } from "@/stores/network";

const trimSlash = (u: string) => u.replace(/\/+$/, "");

/**
 * rfq-engine base URL per network. Configure with
 * NEXT_PUBLIC_RFQ_ENGINE_URL_56 (mainnet) and NEXT_PUBLIC_RFQ_ENGINE_URL_97
 * (testnet). A legacy NEXT_PUBLIC_RFQ_ENGINE_URL is honoured as a fallback for
 * both. Defaults to localhost:3030 for local dev.
 */
export function rfqEngineUrl(chainId: AppChainId = getActiveChainId()): string {
  const perChain =
    chainId === 56
      ? process.env.NEXT_PUBLIC_RFQ_ENGINE_URL_56
      : process.env.NEXT_PUBLIC_RFQ_ENGINE_URL_97;
  const url =
    perChain ?? process.env.NEXT_PUBLIC_RFQ_ENGINE_URL ?? "http://localhost:3030";
  return trimSlash(url);
}

export type RfqStatus =
  | "open"
  | "closed"
  | "expired"
  | "executing"
  | "executed"
  | "failed";

export interface PublicRfq {
  id: string;
  takerSubaccountId: string;
  direction: "sell";
  instrument: {
    name: string;
    currency: string;
    optionAsset: string;
    expiry: string;
    /** 18dp string */
    strike: string;
    isCall: boolean;
    subId: string;
  };
  /** 18dp string */
  amount: string;
  createdAt: number;
  auctionEndsAt: number;
  status: RfqStatus;
}

export interface SerializedTrade {
  asset: string;
  subId: string;
  price: string;
  amount: string;
}

export interface PublicBestQuote {
  quoteId: string;
  maker: string;
  makerSubaccountId: string;
  /** 18dp per-unit premium */
  premium: string;
  /** 18dp total cash to taker */
  totalPremium: string;
  /** sign this in the TakerOrder to accept */
  orderHash: Hex;
  trades: SerializedTrade[];
  /** maker action expiry (unix seconds) — accept before this */
  actionExpiry: string;
}

export interface RfqStatusResponse {
  rfq: PublicRfq;
  quoteCount: number;
  bestQuote: PublicBestQuote | null;
  execution: {
    txHash: Hex;
    status: "success" | "reverted";
    blockNumber: string | null;
  } | null;
  error: string | null;
}

export interface AcceptRfqResponse {
  txHash: Hex;
  status: "success" | "reverted";
  blockNumber: string | null;
  fill: {
    rfqId: string;
    quoteId: string;
    instrument: string;
    maker: string;
    makerSubaccountId: string;
    takerSubaccountId: string;
    /** 18dp */
    amount: string;
    /** 18dp per-unit premium */
    premium: string;
    /** 18dp cash maker -> taker */
    totalPremium: string;
    makerFee: string;
    takerFee: string;
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${rfqEngineUrl()}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error(
      `RFQ engine unreachable at ${rfqEngineUrl()} — is services/rfq-engine running?`
    );
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(`RFQ engine: ${msg}`);
  }
  return body as T;
}

export async function createRfq(params: {
  subaccountId: bigint;
  /** unix seconds */
  expiry: number;
  /** human decimal strike, e.g. "69000" */
  strike: string;
  /** human decimal option amount, e.g. "0.5" */
  amount: string;
}): Promise<PublicRfq> {
  const { rfq } = await request<{ rfq: PublicRfq }>("/rfq", {
    method: "POST",
    body: JSON.stringify({
      subaccountId: params.subaccountId.toString(),
      instrument: {
        asset: "BTC",
        expiry: params.expiry,
        strike: params.strike,
        isCall: true,
      },
      amount: params.amount,
      direction: "sell",
    }),
  });
  return rfq;
}

export async function getRfq(id: string): Promise<RfqStatusResponse> {
  return request<RfqStatusResponse>(`/rfq/${id}`);
}

export async function acceptRfq(
  id: string,
  action: SerializedAction,
  signature: Hex
): Promise<AcceptRfqResponse> {
  return request<AcceptRfqResponse>(`/rfq/${id}/accept`, {
    method: "POST",
    body: JSON.stringify({ action, signature }),
  });
}

export async function rfqEngineHealthy(): Promise<boolean> {
  try {
    await request<{ ok: boolean }>("/health");
    return true;
  } catch {
    return false;
  }
}
