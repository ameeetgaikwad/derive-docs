import { createHash } from "node:crypto";

import { validatePolicy, type MarketMakerPolicy } from "../config.js";
import type { HedgeMarketSnapshot, HedgeSide } from "../domain/types.js";
import {
  roundPriceForIoc,
  simulateBoundedIoc,
  type BookExecution,
} from "../market/order-book.js";

export type HedgeBlockedReason =
  | "INVALID_INPUT"
  | "INVALID_POLICY"
  | "HEDGE_INSTRUMENT_MISMATCH"
  | "HEDGE_BOOK_INVALID"
  | "HEDGE_VENUE_UNHEALTHY"
  | "HEDGE_MARKET_DATA_STALE"
  | "HEDGE_MARKET_DATA_FROM_FUTURE"
  | "HEDGE_MARKET_CONFIDENCE_TOO_LOW"
  | "HEDGE_MARK_ORACLE_DIVERGENCE"
  | "HEDGE_SPREAD_TOO_WIDE"
  | "PENDING_ORDER_RECONCILIATION_REQUIRED"
  | "HEDGE_DEPTH_INSUFFICIENT"
  | "HEDGE_ORDER_BELOW_MINIMUM"
  | "HEDGE_MARGIN_INSUFFICIENT"
  | "PRICE_TICK_EXCEEDS_SLIPPAGE";

export interface HedgePlanInput {
  readonly nowMs: number;
  /** Aggregate delta from confirmed, attributable option positions only. */
  readonly confirmedOptionDeltaUnderlying: number;
  /** Hyperliquid convention: positive is long; negative is short. */
  readonly currentPerpPositionUnderlying: number;
  /** Signed quantity from submitted but not yet reconciled orders. */
  readonly pendingSignedPerpQuantityUnderlying: number;
  readonly portfolioRevision: number;
  readonly correlationId: string;
  readonly market: HedgeMarketSnapshot;
  readonly policy: MarketMakerPolicy;
}

export interface PlannedIocOrder {
  readonly sequence: number;
  readonly clientOrderId: string;
  readonly venue: "HYPERLIQUID";
  readonly network: "MAINNET" | "TESTNET";
  readonly accountAddress: string;
  readonly coin: string;
  readonly side: HedgeSide;
  readonly quantityUnderlying: number;
  readonly limitPriceUsdPerUnderlying: number;
  readonly reduceOnly: boolean;
  readonly timeInForce: "IOC";
  readonly expiresAtMs: number;
}

export type HedgePlan =
  | {
      readonly status: "NOOP";
      readonly reason: "WITHIN_DELTA_BAND" | "BELOW_ONE_LOT";
      readonly targetPerpPositionUnderlying: number;
      readonly effectivePerpPositionUnderlying: number;
      readonly residualToTargetUnderlying: number;
    }
  | {
      readonly status: "BLOCKED";
      readonly reason: HedgeBlockedReason;
      readonly detail: string;
      readonly targetPerpPositionUnderlying: number;
      readonly effectivePerpPositionUnderlying: number;
      readonly residualToTargetUnderlying: number;
    }
  | {
      readonly status: "PLAN";
      readonly targetPerpPositionUnderlying: number;
      readonly effectivePerpPositionUnderlying: number;
      readonly signedOrderQuantityUnderlying: number;
      readonly projectedPerpPositionUnderlying: number;
      readonly projectedPortfolioResidualDeltaUnderlying: number;
      readonly execution: BookExecution;
      readonly orders: readonly PlannedIocOrder[];
    };

function blocked(
  reason: HedgeBlockedReason,
  detail: string,
  target: number,
  effective: number,
): HedgePlan {
  return {
    status: "BLOCKED",
    reason,
    detail,
    targetPerpPositionUnderlying: target,
    effectivePerpPositionUnderlying: effective,
    residualToTargetUnderlying: target - effective,
  };
}

function deterministicClientOrderId(
  correlationId: string,
  portfolioRevision: number,
  sequence: number,
  market: HedgeMarketSnapshot,
): string {
  const digest = createHash("sha256")
    .update(
      `${market.network}|${market.accountAddress.toLowerCase()}|${market.coin}|${correlationId}|${portfolioRevision}|${sequence}`,
    )
    .digest("hex");
  return `0x${digest.slice(0, 32)}`;
}

function nearestLotQuantity(
  signedQuantity: number,
  lotSize: number,
): number {
  const sign = Math.sign(signedQuantity);
  const absoluteLots = Math.abs(signedQuantity) / lotSize;
  const lowerLots = Math.floor(absoluteLots + 1e-12);
  const upperLots = Math.ceil(absoluteLots - 1e-12);
  const lowerQuantity = lowerLots * lotSize;
  const upperQuantity = upperLots * lotSize;
  const lowerError = Math.abs(Math.abs(signedQuantity) - lowerQuantity);
  const upperError = Math.abs(upperQuantity - Math.abs(signedQuantity));
  const chosen = lowerError <= upperError ? lowerQuantity : upperQuantity;
  return sign * chosen;
}

export function planHyperliquidHedge(input: HedgePlanInput): HedgePlan {
  const values = [
    input.nowMs,
    input.confirmedOptionDeltaUnderlying,
    input.currentPerpPositionUnderlying,
    input.pendingSignedPerpQuantityUnderlying,
    input.portfolioRevision,
    input.market.meta.observedAtMs,
    input.market.meta.receivedAtMs,
  ];
  const target = -input.confirmedOptionDeltaUnderlying;
  const effective =
    input.currentPerpPositionUnderlying +
    input.pendingSignedPerpQuantityUnderlying;
  const residual = target - effective;
  if (
    values.some((value) => !Number.isFinite(value)) ||
    !Number.isSafeInteger(input.portfolioRevision) ||
    input.portfolioRevision < 0 ||
    input.correlationId.trim() === ""
  ) {
    return blocked(
      "INVALID_INPUT",
      "planner inputs must be finite and correlation identity must be non-empty",
      target,
      effective,
    );
  }
  if (validatePolicy(input.policy).length > 0) {
    return blocked(
      "INVALID_POLICY",
      "effective shadow policy failed validation",
      target,
      effective,
    );
  }
  if (Math.abs(input.pendingSignedPerpQuantityUnderlying) > 1e-12) {
    return blocked(
      "PENDING_ORDER_RECONCILIATION_REQUIRED",
      "an outstanding hedge does not cover the target; reconcile it before submitting another",
      target,
      effective,
    );
  }
  if (
    input.market.venue !== "HYPERLIQUID" ||
    input.market.network !== input.policy.hedge.network ||
    input.market.coin !== input.policy.product.allowedUnderlying ||
    input.market.accountAddress.toLowerCase() !==
      input.policy.hedge.accountAddress.toLowerCase()
  ) {
    return blocked(
      "HEDGE_INSTRUMENT_MISMATCH",
      "hedge snapshot venue, network, account, and coin must match policy",
      target,
      effective,
    );
  }
  if (!input.market.meta.healthy) {
    return blocked(
      "HEDGE_VENUE_UNHEALTHY",
      "Hyperliquid market/account health is false",
      target,
      effective,
    );
  }
  if (
    input.market.meta.snapshotId.trim() === "" ||
    input.market.meta.source.trim() === ""
  ) {
    return blocked(
      "INVALID_INPUT",
      "hedge snapshot and source identifiers must be non-empty",
      target,
      effective,
    );
  }
  const observedAgeMs = input.nowMs - input.market.meta.observedAtMs;
  const receivedAgeMs = input.nowMs - input.market.meta.receivedAtMs;
  if (
    observedAgeMs < -input.policy.timing.maximumClockSkewMs ||
    receivedAgeMs < -input.policy.timing.maximumClockSkewMs ||
    input.market.meta.observedAtMs >
      input.market.meta.receivedAtMs + input.policy.timing.maximumClockSkewMs
  ) {
    return blocked(
      "HEDGE_MARKET_DATA_FROM_FUTURE",
      "hedge snapshot exceeds permitted future clock skew",
      target,
      effective,
    );
  }
  if (
    observedAgeMs > input.policy.marketData.maximumHedgeSnapshotAgeMs ||
    receivedAgeMs > input.policy.marketData.maximumHedgeSnapshotAgeMs
  ) {
    return blocked(
      "HEDGE_MARKET_DATA_STALE",
      "hedge snapshot exceeds freshness policy",
      target,
      effective,
    );
  }
  if (
    !Number.isFinite(input.market.meta.confidence) ||
    input.market.meta.confidence < input.policy.marketData.minimumConfidence ||
    input.market.meta.confidence > 1
  ) {
    return blocked(
      "HEDGE_MARKET_CONFIDENCE_TOO_LOW",
      "hedge snapshot confidence is below policy",
      target,
      effective,
    );
  }
  if (
    !Number.isFinite(input.market.oraclePriceUsdPerUnderlying) ||
    !Number.isFinite(input.market.markPriceUsdPerUnderlying) ||
    input.market.oraclePriceUsdPerUnderlying <= 0 ||
    input.market.markPriceUsdPerUnderlying <= 0
  ) {
    return blocked(
      "INVALID_INPUT",
      "hedge oracle and mark must be finite and positive",
      target,
      effective,
    );
  }
  if (
    !Number.isFinite(input.market.accountEquityUsd) ||
    !Number.isFinite(input.market.currentMarginUsedUsd) ||
    input.market.accountEquityUsd <= 0 ||
    input.market.currentMarginUsedUsd < 0 ||
    input.market.currentMarginUsedUsd > input.market.accountEquityUsd
  ) {
    return blocked(
      "INVALID_INPUT",
      "hedge account equity/margin must be finite, positive, and internally consistent",
      target,
      effective,
    );
  }
  const markOracleDeviationBps =
    (Math.abs(
      input.market.markPriceUsdPerUnderlying -
        input.market.oraclePriceUsdPerUnderlying,
    ) /
      input.market.oraclePriceUsdPerUnderlying) *
    10_000;
  if (
    markOracleDeviationBps >
    input.policy.marketData.maximumMarkOracleDeviationBps
  ) {
    return blocked(
      "HEDGE_MARK_ORACLE_DIVERGENCE",
      "Hyperliquid mark and oracle diverge beyond policy",
      target,
      effective,
    );
  }
  const validLevel = (level: {
    readonly priceUsdPerUnderlying: number;
    readonly quantityUnderlying: number;
  }): boolean =>
    Number.isFinite(level.priceUsdPerUnderlying) &&
    level.priceUsdPerUnderlying > 0 &&
    Number.isFinite(level.quantityUnderlying) &&
    level.quantityUnderlying > 0;
  const bookIsValid =
    input.market.bids.length > 0 &&
    input.market.asks.length > 0 &&
    input.market.bids.every(validLevel) &&
    input.market.asks.every(validLevel) &&
    Math.max(
      ...input.market.bids.map((level) => level.priceUsdPerUnderlying),
    ) <
      Math.min(
        ...input.market.asks.map((level) => level.priceUsdPerUnderlying),
      );
  if (!bookIsValid) {
    return blocked(
      "HEDGE_BOOK_INVALID",
      "hedge L2 must be finite, positive, two-sided, and non-crossed",
      target,
      effective,
    );
  }
  const bestBid = Math.max(
    ...input.market.bids.map((level) => level.priceUsdPerUnderlying),
  );
  const bestAsk = Math.min(
    ...input.market.asks.map((level) => level.priceUsdPerUnderlying),
  );
  const spreadBps =
    ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 10_000;
  if (spreadBps > input.policy.marketData.maximumHedgeBookSpreadBps) {
    return blocked(
      "HEDGE_SPREAD_TOO_WIDE",
      "Hyperliquid top-of-book spread exceeds execution policy",
      target,
      effective,
    );
  }

  if (Math.abs(residual) <= input.policy.hedge.noTradeBandUnderlying) {
    const currentPermittedMargin =
      input.market.accountEquityUsd *
      input.policy.hedge.maximumCollateralUsageFraction;
    if (input.market.currentMarginUsedUsd > currentPermittedMargin) {
      return blocked(
        "HEDGE_MARGIN_INSUFFICIENT",
        "account margin usage breaches policy even though delta is inside band",
        target,
        effective,
      );
    }
    return {
      status: "NOOP",
      reason: "WITHIN_DELTA_BAND",
      targetPerpPositionUnderlying: target,
      effectivePerpPositionUnderlying: effective,
      residualToTargetUnderlying: residual,
    };
  }

  const signedOrderQuantity = nearestLotQuantity(
    residual,
    input.policy.hedge.lotSizeUnderlying,
  );
  if (Math.abs(signedOrderQuantity) < input.policy.hedge.lotSizeUnderlying) {
    return {
      status: "NOOP",
      reason: "BELOW_ONE_LOT",
      targetPerpPositionUnderlying: target,
      effectivePerpPositionUnderlying: effective,
      residualToTargetUnderlying: residual,
    };
  }
  const orderNotionalUsd =
    Math.abs(signedOrderQuantity) *
    input.market.oraclePriceUsdPerUnderlying;
  if (orderNotionalUsd < input.policy.hedge.minimumOrderNotionalUsd) {
    return blocked(
      "HEDGE_ORDER_BELOW_MINIMUM",
      "residual is outside the delta band but below the venue order minimum",
      target,
      effective,
    );
  }
  const side: HedgeSide = signedOrderQuantity > 0 ? "BUY" : "SELL";
  const execution = simulateBoundedIoc(
    side,
    Math.abs(signedOrderQuantity),
    input.market.oraclePriceUsdPerUnderlying,
    input.policy.hedge.maximumAdverseSlippageBps,
    input.market.bids,
    input.market.asks,
  );
  if (!execution.executable || execution.worstPriceUsdPerUnderlying === null) {
    return blocked(
      "HEDGE_DEPTH_INSUFFICIENT",
      "directional L2 depth cannot execute the residual inside the slippage cap",
      target,
      effective,
    );
  }
  const limitPriceUsdPerUnderlying = roundPriceForIoc(
    side,
    execution.worstPriceUsdPerUnderlying,
    input.policy.hedge.priceTickUsd,
  );
  const maximumBuyPrice =
    input.market.oraclePriceUsdPerUnderlying *
    (1 + input.policy.hedge.maximumAdverseSlippageBps / 10_000);
  const minimumSellPrice =
    input.market.oraclePriceUsdPerUnderlying *
    (1 - input.policy.hedge.maximumAdverseSlippageBps / 10_000);
  if (
    (side === "BUY" && limitPriceUsdPerUnderlying > maximumBuyPrice) ||
    (side === "SELL" && limitPriceUsdPerUnderlying < minimumSellPrice)
  ) {
    return blocked(
      "PRICE_TICK_EXCEEDS_SLIPPAGE",
      "venue tick rounding would exceed the configured slippage cap",
      target,
      effective,
    );
  }

  const projectedPerpPosition = effective + signedOrderQuantity;
  const currentAbsolutePosition = Math.abs(
    input.currentPerpPositionUnderlying,
  );
  const projectedAbsolutePosition = Math.abs(projectedPerpPosition);
  const incrementalInitialMargin =
    Math.max(0, projectedAbsolutePosition - currentAbsolutePosition) *
    input.market.oraclePriceUsdPerUnderlying *
    input.policy.hedge.initialMarginFraction;
  const projectedStressBuffer =
    projectedAbsolutePosition *
    input.market.oraclePriceUsdPerUnderlying *
    input.policy.hedge.collateralStressMoveFraction;
  const projectedStressedMargin =
    input.market.currentMarginUsedUsd +
    incrementalInitialMargin +
    projectedStressBuffer;
  const permittedMargin =
    input.market.accountEquityUsd *
    input.policy.hedge.maximumCollateralUsageFraction;
  const crossesZeroForMargin =
    currentAbsolutePosition > 1e-12 &&
    projectedAbsolutePosition > 1e-12 &&
    Math.sign(input.currentPerpPositionUnderlying) !==
      Math.sign(projectedPerpPosition);
  const reducesWithoutOpening =
    !crossesZeroForMargin &&
    projectedAbsolutePosition < currentAbsolutePosition;
  if (!reducesWithoutOpening && projectedStressedMargin > permittedMargin) {
    return blocked(
      "HEDGE_MARGIN_INSUFFICIENT",
      "projected stressed Hyperliquid margin exceeds independent account policy",
      target,
      effective,
    );
  }

  const orderQuantities: Array<{
    readonly quantityUnderlying: number;
    readonly reduceOnly: boolean;
  }> = [];
  const crossesZero =
    Math.abs(input.currentPerpPositionUnderlying) > 1e-12 &&
    Math.abs(projectedPerpPosition) > 1e-12 &&
    Math.sign(input.currentPerpPositionUnderlying) !==
      Math.sign(projectedPerpPosition);
  if (crossesZero) {
    orderQuantities.push({
      quantityUnderlying: Math.abs(input.currentPerpPositionUnderlying),
      reduceOnly: true,
    });
    orderQuantities.push({
      quantityUnderlying: Math.abs(projectedPerpPosition),
      reduceOnly: false,
    });
  } else {
    const reducesExisting =
      Math.abs(input.currentPerpPositionUnderlying) > 1e-12 &&
      Math.abs(projectedPerpPosition) <
        Math.abs(input.currentPerpPositionUnderlying) &&
      (Math.abs(projectedPerpPosition) <= 1e-12 ||
        Math.sign(projectedPerpPosition) ===
          Math.sign(input.currentPerpPositionUnderlying));
    orderQuantities.push({
      quantityUnderlying: Math.abs(signedOrderQuantity),
      reduceOnly: reducesExisting,
    });
  }
  const orders = orderQuantities.map((order, sequence): PlannedIocOrder => ({
    sequence,
    clientOrderId: deterministicClientOrderId(
      input.correlationId,
      input.portfolioRevision,
      sequence,
      input.market,
    ),
    venue: input.market.venue,
    network: input.market.network,
    accountAddress: input.market.accountAddress,
    coin: input.market.coin,
    side,
    quantityUnderlying: order.quantityUnderlying,
    limitPriceUsdPerUnderlying,
    reduceOnly: order.reduceOnly,
    timeInForce: "IOC",
    expiresAtMs: input.nowMs + input.policy.hedge.orderExpiryMs,
  }));

  return {
    status: "PLAN",
    targetPerpPositionUnderlying: target,
    effectivePerpPositionUnderlying: effective,
    signedOrderQuantityUnderlying: signedOrderQuantity,
    projectedPerpPositionUnderlying: projectedPerpPosition,
    projectedPortfolioResidualDeltaUnderlying:
      input.confirmedOptionDeltaUnderlying + projectedPerpPosition,
    execution,
    orders,
  };
}
