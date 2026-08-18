/**
 * Values in the domain kernel use explicit unit suffixes. JavaScript numbers are
 * acceptable here for modelling, but never at a live signing or venue boundary.
 */

export type OptionKind = "CALL" | "PUT";
export type RfqDirection = "TAKER_SELLS_OPTION" | "TAKER_BUYS_OPTION";
export type HedgeSide = "BUY" | "SELL";

export interface InstrumentIdentity {
  readonly instrumentId: string;
  readonly optionAssetAddress: string;
  readonly optionSubId: string;
  readonly underlying: string;
  readonly settlementCurrency: string;
  readonly kind: OptionKind;
  readonly strikeUsdPerUnderlying: number;
  readonly expiryMs: number;
  readonly contractMultiplierUnderlying: number;
  /** Set only by a trusted local registry/decoder, never copied from an RFQ server. */
  readonly identityVerified: boolean;
}

export interface RfqCandidate {
  readonly rfqId: string;
  readonly direction: RfqDirection;
  readonly quantityContracts: number;
  readonly receivedAtMs: number;
  readonly auctionEndsAtMs: number;
  readonly takerAcceptanceEndsAtMs: number;
  readonly instrument: InstrumentIdentity;
}

export interface SnapshotMeta {
  readonly snapshotId: string;
  readonly source: string;
  readonly observedAtMs: number;
  readonly receivedAtMs: number;
  readonly healthy: boolean;
  /** Normalized confidence in [0, 1], after source-specific validation. */
  readonly confidence: number;
}

export interface OptionMarketSnapshot {
  readonly meta: SnapshotMeta;
  readonly spotUsdPerUnderlying: number;
  readonly forwardUsdPerUnderlying: number;
  /** 0.60 means 60% annualized volatility. */
  readonly volatilityDecimal: number;
  readonly annualRateDecimal: number;
  /** Live total protocol/open-interest fee for this candidate RFQ. */
  readonly protocolAndOiFeesUsd: number;
}

export interface BookLevel {
  readonly priceUsdPerUnderlying: number;
  readonly quantityUnderlying: number;
}

export interface HedgeMarketSnapshot {
  readonly meta: SnapshotMeta;
  readonly venue: "HYPERLIQUID";
  readonly network: "MAINNET" | "TESTNET";
  readonly accountAddress: string;
  readonly coin: string;
  readonly oraclePriceUsdPerUnderlying: number;
  readonly markPriceUsdPerUnderlying: number;
  readonly bids: readonly BookLevel[];
  readonly asks: readonly BookLevel[];
  /** Decimal rate applied to traded notional, e.g. 0.00045. */
  readonly takerFeeRateDecimal: number;
  /** Positive means longs pay shorts. Funding credits are not used in v0 bids. */
  readonly fundingRateHourlyDecimal: number;
  /** Total account equity visible to Hyperliquid, not cross-venue option value. */
  readonly accountEquityUsd: number;
  readonly currentMarginUsedUsd: number;
}

export interface DecisionVersions {
  readonly policyVersion: string;
  readonly modelVersion: string;
}
