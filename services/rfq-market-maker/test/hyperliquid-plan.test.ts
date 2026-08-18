import { describe, expect, it } from "vitest";

import {
  planHyperliquidHedge,
  type HedgePlan,
} from "../src/hedging/hyperliquid-plan.js";
import {
  NOW_MS,
  makeHedgeInput,
  makeHedgeMarket,
  makePolicy,
} from "./fixtures.js";

function requirePlan(plan: HedgePlan) {
  expect(plan.status).toBe("PLAN");
  if (plan.status !== "PLAN") {
    throw new Error(`expected PLAN, got ${plan.status}`);
  }
  return plan;
}

function requireBlocked(plan: HedgePlan, reason: string) {
  expect(plan.status).toBe("BLOCKED");
  if (plan.status !== "BLOCKED") {
    throw new Error(`expected ${reason}, got ${plan.status}`);
  }
  expect(plan.reason).toBe(reason);
  return plan;
}

describe("planHyperliquidHedge", () => {
  it("shorts the perpetual for positive option delta", () => {
    const plan = requirePlan(planHyperliquidHedge(makeHedgeInput()));

    expect(plan.targetPerpPositionUnderlying).toBeCloseTo(-0.3, 12);
    expect(plan.signedOrderQuantityUnderlying).toBeCloseTo(-0.3, 12);
    expect(plan.projectedPerpPositionUnderlying).toBeCloseTo(-0.3, 12);
    expect(plan.projectedPortfolioResidualDeltaUnderlying).toBeCloseTo(0, 12);
    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]).toMatchObject({
      venue: "HYPERLIQUID",
      network: "TESTNET",
      accountAddress: "0x0000000000000000000000000000000000000002",
      coin: "BTC",
      side: "SELL",
      quantityUnderlying: 0.3,
      reduceOnly: false,
      timeInForce: "IOC",
      expiresAtMs: NOW_MS + 5_000,
    });
  });

  it("buys the perpetual for negative option delta", () => {
    const plan = requirePlan(
      planHyperliquidHedge(
        makeHedgeInput({ confirmedOptionDeltaUnderlying: -0.2 }),
      ),
    );

    expect(plan.targetPerpPositionUnderlying).toBeCloseTo(0.2, 12);
    expect(plan.signedOrderQuantityUnderlying).toBeCloseTo(0.2, 12);
    expect(plan.orders[0]).toMatchObject({
      side: "BUY",
      quantityUnderlying: 0.2,
      reduceOnly: false,
    });
  });

  it("does nothing inside the configured delta band", () => {
    const plan = planHyperliquidHedge(
      makeHedgeInput({ confirmedOptionDeltaUnderlying: 0.004 }),
    );

    expect(plan).toMatchObject({
      status: "NOOP",
      reason: "WITHIN_DELTA_BAND",
      targetPerpPositionUnderlying: -0.004,
      effectivePerpPositionUnderlying: 0,
      residualToTargetUnderlying: -0.004,
    });
  });

  it("does nothing when the residual rounds below one venue lot", () => {
    const plan = planHyperliquidHedge(
      makeHedgeInput({
        confirmedOptionDeltaUnderlying: 0.004,
        policy: makePolicy({
          hedge: { noTradeBandUnderlying: 0, lotSizeUnderlying: 0.01 },
        }),
      }),
    );

    expect(plan).toMatchObject({ status: "NOOP", reason: "BELOW_ONE_LOT" });
  });

  it("blocks an outside-band residual below the venue order minimum", () => {
    const plan = planHyperliquidHedge(
      makeHedgeInput({
        confirmedOptionDeltaUnderlying: 0.00005,
        policy: makePolicy({
          hedge: {
            noTradeBandUnderlying: 0,
            lotSizeUnderlying: 0.00001,
            minimumOrderNotionalUsd: 10,
          },
        }),
      }),
    );

    requireBlocked(plan, "HEDGE_ORDER_BELOW_MINIMUM");
  });

  it("blocks on every unreconciled pending order, even when its signed size reaches target", () => {
    const exactTarget = planHyperliquidHedge(
      makeHedgeInput({ pendingSignedPerpQuantityUnderlying: -0.3 }),
    );
    const partialTarget = planHyperliquidHedge(
      makeHedgeInput({ pendingSignedPerpQuantityUnderlying: -0.1 }),
    );

    requireBlocked(exactTarget, "PENDING_ORDER_RECONCILIATION_REQUIRED");
    requireBlocked(partialTarget, "PENDING_ORDER_RECONCILIATION_REQUIRED");
  });

  it("replans only the residual after a partial fill has been reconciled", () => {
    const plan = requirePlan(
      planHyperliquidHedge(
        makeHedgeInput({ currentPerpPositionUnderlying: -0.12 }),
      ),
    );

    expect(plan.effectivePerpPositionUnderlying).toBeCloseTo(-0.12, 12);
    expect(plan.signedOrderQuantityUnderlying).toBeCloseTo(-0.18, 12);
    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]).toMatchObject({
      side: "SELL",
      quantityUnderlying: 0.18,
      reduceOnly: false,
    });
  });

  it("marks an order reduce-only when moving toward zero without crossing it", () => {
    const plan = requirePlan(
      planHyperliquidHedge(
        makeHedgeInput({
          confirmedOptionDeltaUnderlying: 0.1,
          currentPerpPositionUnderlying: -0.3,
        }),
      ),
    );

    expect(plan.signedOrderQuantityUnderlying).toBeCloseTo(0.2, 12);
    expect(plan.projectedPerpPositionUnderlying).toBeCloseTo(-0.1, 12);
    expect(plan.orders).toHaveLength(1);
    expect(plan.orders[0]).toMatchObject({
      side: "BUY",
      quantityUnderlying: 0.2,
      reduceOnly: true,
    });
  });

  it("splits a cross-zero hedge into reduce-only close and non-reducing open orders", () => {
    const plan = requirePlan(
      planHyperliquidHedge(
        makeHedgeInput({
          confirmedOptionDeltaUnderlying: 0.2,
          currentPerpPositionUnderlying: 0.1,
        }),
      ),
    );

    expect(plan.signedOrderQuantityUnderlying).toBeCloseTo(-0.3, 12);
    expect(plan.projectedPerpPositionUnderlying).toBeCloseTo(-0.2, 12);
    expect(plan.orders).toHaveLength(2);
    expect(plan.orders[0]).toMatchObject({
      sequence: 0,
      side: "SELL",
      quantityUnderlying: 0.1,
      reduceOnly: true,
    });
    expect(plan.orders[1]).toMatchObject({
      sequence: 1,
      side: "SELL",
      reduceOnly: false,
    });
    expect(plan.orders[1]!.quantityUnderlying).toBeCloseTo(0.2, 12);
  });

  it("blocks when bounded L2 depth cannot fill the hedge", () => {
    const plan = planHyperliquidHedge(
      makeHedgeInput({
        market: makeHedgeMarket({
          bids: [{ priceUsdPerUnderlying: 99_990, quantityUnderlying: 0.01 }],
        }),
      }),
    );

    requireBlocked(plan, "HEDGE_DEPTH_INSUFFICIENT");
  });

  it("blocks when projected stressed margin exceeds independent collateral policy", () => {
    const plan = planHyperliquidHedge(
      makeHedgeInput({
        market: makeHedgeMarket({
          accountEquityUsd: 100,
          currentMarginUsedUsd: 0,
        }),
      }),
    );

    requireBlocked(plan, "HEDGE_MARGIN_INSUFFICIENT");
  });

  it("blocks stale market data before constructing an order", () => {
    const plan = planHyperliquidHedge(
      makeHedgeInput({
        confirmedOptionDeltaUnderlying: 0.004,
        market: makeHedgeMarket({
          meta: {
            observedAtMs: NOW_MS - 2_000,
            receivedAtMs: NOW_MS - 2_000,
          },
        }),
      }),
    );

    requireBlocked(plan, "HEDGE_MARKET_DATA_STALE");
  });

  it.each([
    ["observed", { observedAtMs: Number.NaN }],
    ["received", { receivedAtMs: Number.NaN }],
  ])("blocks a non-finite %s timestamp", (_label, meta) => {
    const plan = planHyperliquidHedge(
      makeHedgeInput({ market: makeHedgeMarket({ meta }) }),
    );

    requireBlocked(plan, "INVALID_INPUT");
  });

  it.each([
    ["coin", makeHedgeMarket({ coin: "ETH" })],
    ["network", makeHedgeMarket({ network: "MAINNET" })],
    [
      "account",
      makeHedgeMarket({
        accountAddress: "0x00000000000000000000000000000000000000ff",
      }),
    ],
  ] as const)("blocks a hedge market with mismatched %s identity", (_label, market) => {
    const plan = planHyperliquidHedge(
      makeHedgeInput({
        confirmedOptionDeltaUnderlying: 0.004,
        market,
      }),
    );

    requireBlocked(plan, "HEDGE_INSTRUMENT_MISMATCH");
  });

  it("allows a reduce-only close even when existing margin usage is above policy", () => {
    const plan = planHyperliquidHedge(
      makeHedgeInput({
        confirmedOptionDeltaUnderlying: 0,
        currentPerpPositionUnderlying: 1,
        market: makeHedgeMarket({
          accountEquityUsd: 60_000,
          currentMarginUsedUsd: 40_000,
        }),
      }),
    );

    const orderPlan = requirePlan(plan);
    expect(orderPlan.orders).toHaveLength(1);
    expect(orderPlan.orders[0]?.reduceOnly).toBe(true);
  });

  it("does not erase other venue margin when increasing hedge exposure", () => {
    const plan = planHyperliquidHedge(
      makeHedgeInput({
        confirmedOptionDeltaUnderlying: 2,
        currentPerpPositionUnderlying: -1,
        market: makeHedgeMarket({
          accountEquityUsd: 150_000,
          currentMarginUsedUsd: 30_000,
          bids: [{ priceUsdPerUnderlying: 99_990, quantityUnderlying: 3 }],
        }),
      }),
    );

    requireBlocked(plan, "HEDGE_MARGIN_INSUFFICIENT");
  });

  it("derives stable client-order IDs from correlation, revision, and sequence", () => {
    const input = makeHedgeInput({
      correlationId: "confirmed-fill-42",
      portfolioRevision: 19,
      confirmedOptionDeltaUnderlying: 0.2,
      currentPerpPositionUnderlying: 0.1,
    });
    const first = requirePlan(planHyperliquidHedge(input));
    const retry = requirePlan(planHyperliquidHedge(input));
    const nextRevision = requirePlan(
      planHyperliquidHedge({ ...input, portfolioRevision: 20 }),
    );

    expect(first.orders.map((order) => order.clientOrderId)).toEqual(
      retry.orders.map((order) => order.clientOrderId),
    );
    expect(first.orders[0]!.clientOrderId).toMatch(/^0x[0-9a-f]{32}$/);
    expect(first.orders[0]!.clientOrderId).not.toBe(
      nextRevision.orders[0]!.clientOrderId,
    );
    expect(first.orders[0]!.clientOrderId).not.toBe(
      first.orders[1]!.clientOrderId,
    );
  });
});
