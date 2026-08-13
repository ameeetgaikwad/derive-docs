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
 * NEXT_PUBLIC_RFQ_ENGINE_URL_56 (mainnet staging) and
 * NEXT_PUBLIC_RFQ_ENGINE_URL_97 (testnet). Chain 56 deliberately has no
 * fallback: sending a mainnet request to a testnet or local engine can strand
 * real collateral after it has been deposited.
 */
export function rfqEngineUrl(chainId: AppChainId = getActiveChainId()): string {
  if (chainId === 56) {
    const url = process.env.NEXT_PUBLIC_RFQ_ENGINE_URL_56?.trim();
    if (!url) {
      throw new Error(
        "Mainnet staging is unavailable: NEXT_PUBLIC_RFQ_ENGINE_URL_56 is not configured",
      );
    }
    return trimSlash(url);
  }

  const url =
    process.env.NEXT_PUBLIC_RFQ_ENGINE_URL_97 ??
    process.env.NEXT_PUBLIC_RFQ_ENGINE_URL ??
    "http://localhost:3030";
  return trimSlash(url);
}

export interface RfqEngineHealth {
  ok: boolean;
  service: string;
  chainId: number;
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
  /** ms epoch; populated after the auction closes with a winner */
  acceptDeadlineAt: number | null;
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
    marketId?: string;
    rawAmount?: string;
    protocolStrike?: string;
    /** 18dp per-unit premium */
    premium: string;
    /** 18dp cash maker -> taker */
    totalPremium: string;
    makerFee: string;
    takerFee: string;
  };
}

export interface PublicMarketStatus {
  id: string;
  displayName: string;
  collateralSymbol: string;
  collateralDecimals: number;
  scaledUi: boolean;
  enabled: boolean;
  status: "open" | "closed" | "disabled";
  disableReason: string | null;
  feedUpdatedAt: number | null;
  supportedExpiries: number[];
}

async function request<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error(
      `RFQ engine unreachable at ${baseUrl} — is services/rfq-engine running?`,
    );
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(`RFQ engine: ${msg}`);
  }
  return body as T;
}

export async function createRfq(
  params: {
    subaccountId: bigint;
    /** unix seconds */
    expiry: number;
    /** human decimal strike, e.g. "69000" */
    strike: string;
    /** human decimal option amount, e.g. "0.5" */
    amount: string;
    marketId?: string;
    rawAmount?: string;
    protocolStrike?: string;
  },
  chainId: AppChainId = getActiveChainId(),
): Promise<PublicRfq> {
  const { rfq } = await request<{ rfq: PublicRfq }>(
    rfqEngineUrl(chainId),
    "/rfq",
    {
      method: "POST",
      body: JSON.stringify({
        subaccountId: params.subaccountId.toString(),
        instrument: {
          asset: params.marketId ?? "BTC",
          expiry: params.expiry,
          strike: params.protocolStrike ?? params.strike,
          isCall: true,
        },
        amount: params.rawAmount ?? params.amount,
        direction: "sell",
      }),
    },
  );
  return rfq;
}

export async function getRfq(
  id: string,
  chainId: AppChainId = getActiveChainId(),
): Promise<RfqStatusResponse> {
  return request<RfqStatusResponse>(rfqEngineUrl(chainId), `/rfq/${id}`);
}

export async function getRfqMarkets(
  chainId: AppChainId = getActiveChainId(),
): Promise<PublicMarketStatus[]> {
  const response = await request<{ markets: PublicMarketStatus[] }>(rfqEngineUrl(chainId), "/markets");
  return response.markets;
}

export async function acceptRfq(
  id: string,
  action: SerializedAction,
  signature: Hex,
  chainId: AppChainId = getActiveChainId(),
): Promise<AcceptRfqResponse> {
  return request<AcceptRfqResponse>(rfqEngineUrl(chainId), `/rfq/${id}/accept`, {
    method: "POST",
    body: JSON.stringify({ action, signature }),
  });
}

export async function rfqEngineHealthy(
  chainId: AppChainId = getActiveChainId(),
): Promise<boolean> {
  try {
    await assertRfqEngineChain(chainId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Fail closed before any wallet or collateral operation if the configured RFQ
 * endpoint is not the service for the selected chain.
 */
export async function assertRfqEngineChain(
  chainId: AppChainId = getActiveChainId(),
): Promise<void> {
  const baseUrl = rfqEngineUrl(chainId);
  const health = await request<RfqEngineHealth>(baseUrl, "/health");
  if (
    health.ok !== true ||
    health.service !== "rfq-engine" ||
    health.chainId !== chainId
  ) {
    const reportedChain = Number.isInteger(health.chainId)
      ? health.chainId.toString()
      : "unknown";
    throw new Error(
      `RFQ endpoint ${baseUrl} reports chain ${reportedChain}; expected chain ${chainId}. Refusing to move collateral.`,
    );
  }
}
