import { describe, expect, it } from "vitest";

import {
  evaluateQuote,
  type QuoteDecision,
  type QuoteDecisionInput,
} from "../src/decision/quote-engine.js";
import type { DeclineReasonCode } from "../src/decision/reason-codes.js";
import {
  DAY_MS,
  NOW_MS,
  makeExposure,
  makeHedgeMarket,
  makeHedgeOperations,
  makeOptionMarket,
  makePolicy,
  makePortfolio,
  makeQuoteInput,
  makeReservation,
  makeRfq,
} from "./fixtures.js";

function requireQuote(decision: QuoteDecision) {
  expect(decision.kind).toBe("QUOTE");
  if (decision.kind !== "QUOTE") {
    throw new Error(`expected quote, got ${decision.primaryReason}`);
  }
  return decision;
}

function requireDecline(
  decision: QuoteDecision,
  reason: DeclineReasonCode,
) {
  expect(decision.kind).toBe("DECLINE");
  if (decision.kind !== "DECLINE") {
    throw new Error(`expected ${reason}, got a quote`);
  }
  expect(decision.primaryReason).toBe(reason);
  expect(decision.reasons).toContain(reason);
  return decision;
}

describe("evaluateQuote", () => {
  it("quotes a healthy covered-call RFQ and records reproducible diagnostics", () => {
    const input = makeQuoteInput();
    const decision = requireQuote(evaluateQuote(input));

    expect(decision.rfqId).toBe(input.rfq.rfqId);
    expect(decision.greeks.makerOptionQuantityUnderlying).toBeCloseTo(0.1, 12);
    expect(decision.greeks.hedgeDeltaUnderlying).toBeGreaterThan(0);
    expect(decision.initialHedgePreview.side).toBe("SELL");
    expect(decision.initialHedgePreview.executable).toBe(true);
    expect(decision.diagnostics).toMatchObject({
      evaluatedAtMs: NOW_MS,
      policyVersion: input.policy.policyVersion,
      modelVersion: input.policy.modelVersion,
      reservationLedgerVersion: 7,
      optionSnapshotId: "option-snapshot-1",
      hedgeSnapshotId: "hedge-snapshot-1",
    });
    expect(decision.diagnostics.gates.every((gate) => gate.passed)).toBe(true);
  });

  it("makes every cost, bid ceiling, shade, and premium tick invariant explicit", () => {
    const input = makeQuoteInput();
    const decision = requireQuote(evaluateQuote(input));
    const { economics } = decision;
    const summedCosts = Object.values(economics.costs).reduce(
      (sum, cost) => sum + cost,
      0,
    );

    expect(Object.values(economics.costs).every((cost) => cost >= 0)).toBe(true);
    expect(economics.totalDeductionsUsd).toBeCloseTo(summedCosts, 10);
    expect(economics.reservationBidCeilingUsd).toBeCloseTo(
      economics.conservativeFairValueUsd - economics.totalDeductionsUsd,
      10,
    );
    expect(economics.quotedTotalPremiumUsd).toBeLessThanOrEqual(
      economics.reservationBidCeilingUsd,
    );
    expect(economics.quotedTotalPremiumUsd).toBeCloseTo(
      economics.quotedUnitPremiumUsdPerUnderlying *
        decision.greeks.makerOptionQuantityUnderlying,
      10,
    );
    const premiumTicks =
      economics.quotedUnitPremiumUsdPerUnderlying /
      input.policy.quote.premiumTickUsdPerUnderlying;
    expect(Math.abs(premiumTicks - Math.round(premiumTicks))).toBeLessThan(
      1e-8,
    );
    expect(economics.costs.requiredProfitUsd).toBeGreaterThanOrEqual(
      input.policy.costs.minimumRequiredProfitUsd,
    );
    expect(economics.expectedModelEdgeUsd).toBeGreaterThan(0);
  });

  it("reserves the full candidate Greeks, cash, hedge notional, and stressed margin", () => {
    const input = makeQuoteInput();
    const decision = requireQuote(evaluateQuote(input));
    const { exposure } = decision.reservation;

    expect(decision.reservation).toMatchObject({
      reservationId: `rfq:${input.rfq.rfqId}`,
      rfqId: input.rfq.rfqId,
      basedOnLedgerVersion: input.reservationLedgerVersion,
      expiresAtMs:
        input.rfq.takerAcceptanceEndsAtMs +
        input.policy.timing.reservationFinalityBufferMs,
    });
    expect(Math.abs(exposure.netOptionDeltaUnderlying)).toBeGreaterThanOrEqual(
      Math.abs(decision.greeks.hedgeDeltaUnderlying),
    );
    expect(exposure.grossGammaUsdForOnePercentSquared).toBeGreaterThanOrEqual(
      Math.abs(decision.greeks.gammaUsdForOnePercentSquared),
    );
    expect(exposure.grossVegaUsdPerVolPoint).toBeGreaterThanOrEqual(
      Math.abs(decision.greeks.vegaUsdPerVolPoint),
    );
    expect(exposure.grossOptionNotionalUsd).toBeCloseTo(10_020, 10);
    expect(exposure.protocolCashOutflowUsd).toBeCloseTo(
      decision.economics.quotedTotalPremiumUsd +
        decision.economics.costs.protocolAndOiFeesUsd,
      10,
    );
    expect(exposure.hedgeNotionalUsd).toBeGreaterThanOrEqual(
      Math.abs(decision.greeks.hedgeDeltaUnderlying) * 100_000,
    );
    expect(exposure.hedgeInitialMarginUsd).toBeCloseTo(
      exposure.hedgeNotionalUsd *
        (input.policy.hedge.initialMarginFraction +
          input.policy.hedge.collateralStressMoveFraction),
      8,
    );
  });

  const keyDeclines: ReadonlyArray<{
    readonly label: string;
    readonly reason: DeclineReasonCode;
    readonly input: () => QuoteDecisionInput;
  }> = [
    {
      label: "an unreconciled hedge backlog",
      reason: "HEDGE_BACKLOG_PRESENT",
      input: () =>
        makeQuoteInput({
          hedgeOperations: makeHedgeOperations({ pendingOrderCount: 1 }),
        }),
    },
    {
      label: "excess residual portfolio delta",
      reason: "RESIDUAL_DELTA_LIMIT",
      input: () =>
        makeQuoteInput({
          hedgeOperations: makeHedgeOperations({
            residualPortfolioDeltaUnderlying: 0.02,
          }),
        }),
    },
    {
      label: "an unverified instrument",
      reason: "UNVERIFIED_INSTRUMENT",
      input: () =>
        makeQuoteInput({
          rfq: makeRfq({ instrument: { identityVerified: false } }),
        }),
    },
    {
      label: "the unsupported taker-buy direction",
      reason: "UNSUPPORTED_DIRECTION",
      input: () =>
        makeQuoteInput({
          rfq: makeRfq({ direction: "TAKER_BUYS_OPTION" }),
        }),
    },
    {
      label: "an expired option",
      reason: "OPTION_EXPIRED",
      input: () =>
        makeQuoteInput({
          rfq: makeRfq({ instrument: { expiryMs: NOW_MS - DAY_MS } }),
        }),
    },
    {
      label: "stale option data",
      reason: "OPTION_MARKET_DATA_STALE",
      input: () =>
        makeQuoteInput({
          optionMarket: makeOptionMarket({
            meta: {
              observedAtMs: NOW_MS - 3_000,
              receivedAtMs: NOW_MS - 3_000,
            },
          }),
        }),
    },
    {
      label: "low-confidence option data",
      reason: "MARKET_CONFIDENCE_TOO_LOW",
      input: () =>
        makeQuoteInput({
          optionMarket: makeOptionMarket({ meta: { confidence: 0.5 } }),
        }),
    },
    {
      label: "stale hedge data",
      reason: "HEDGE_MARKET_DATA_STALE",
      input: () =>
        makeQuoteInput({
          hedgeMarket: makeHedgeMarket({
            meta: {
              observedAtMs: NOW_MS - 2_000,
              receivedAtMs: NOW_MS - 2_000,
            },
          }),
        }),
    },
    {
      label: "insufficient bounded hedge depth",
      reason: "HEDGE_DEPTH_INSUFFICIENT",
      input: () =>
        makeQuoteInput({
          hedgeMarket: makeHedgeMarket({
            bids: [
              {
                priceUsdPerUnderlying: 99_990,
                quantityUnderlying: 0.001,
              },
            ],
          }),
        }),
    },
    {
      label: "a missing two-sided hedge book",
      reason: "HEDGE_BOOK_INVALID",
      input: () =>
        makeQuoteInput({
          hedgeMarket: makeHedgeMarket({ bids: [], asks: [] }),
        }),
    },
    {
      label: "insufficient independent hedge collateral",
      reason: "HEDGE_MARGIN_INSUFFICIENT",
      input: () =>
        makeQuoteInput({
          hedgeMarket: makeHedgeMarket({
            accountEquityUsd: 100,
            currentMarginUsedUsd: 0,
          }),
        }),
    },
    {
      label: "costs above conservative fair value",
      reason: "NON_POSITIVE_RESERVATION_BID",
      input: () =>
        makeQuoteInput({
          optionMarket: makeOptionMarket({ protocolAndOiFeesUsd: 1_000_000 }),
        }),
    },
    {
      label: "a bid below the local executable minimum",
      reason: "BID_BELOW_MINIMUM",
      input: () =>
        makeQuoteInput({
          policy: makePolicy({ quote: { minimumTotalPremiumUsd: 1_000_000 } }),
        }),
    },
  ];

  it.each(keyDeclines)("declines $label", ({ reason, input }) => {
    const decision = requireDecline(evaluateQuote(input()), reason);
    expect(decision.diagnostics.gates.some((gate) => !gate.passed)).toBe(true);
  });

  it("applies risk limits to the candidate plus every other live reservation", () => {
    const other = makeReservation({
      exposure: makeExposure({ netOptionDeltaUnderlying: 0.04 }),
    });
    const input = makeQuoteInput({
      portfolio: makePortfolio({ reservations: [other] }),
      policy: makePolicy({
        risk: { maxAbsNetOptionDeltaUnderlying: 0.08 },
      }),
    });

    const decision = evaluateQuote(input);
    expect(decision.kind).toBe("DECLINE");
    if (decision.kind === "DECLINE") {
      expect(decision.reasons).toContain("DELTA_LIMIT");
    }
  });

  it("counts all other reservations against the concurrent live-quote limit", () => {
    const input = makeQuoteInput({
      portfolio: makePortfolio({ reservations: [makeReservation()] }),
      policy: makePolicy({ risk: { maxLiveReservations: 1 } }),
    });

    const decision = evaluateQuote(input);
    expect(decision.kind).toBe("DECLINE");
    if (decision.kind === "DECLINE") {
      expect(decision.reasons).toContain("LIVE_QUOTE_LIMIT");
    }
  });

  it("replaces the same RFQ reservation instead of double-counting it", () => {
    const replacement = makeReservation({
      reservationId: "rfq:rfq-1",
      rfqId: "rfq-1",
      exposure: makeExposure({
        netOptionDeltaUnderlying: 100,
        grossGammaUsdForOnePercentSquared: 1_000_000,
        grossVegaUsdPerVolPoint: 1_000_000,
        grossOptionNotionalUsd: 100_000_000,
        protocolCashOutflowUsd: 100_000_000,
        hedgeNotionalUsd: 100_000_000,
        hedgeInitialMarginUsd: 100_000_000,
      }),
    });
    const input = makeQuoteInput({
      portfolio: makePortfolio({ reservations: [replacement] }),
      policy: makePolicy({ risk: { maxLiveReservations: 1 } }),
    });

    requireQuote(evaluateQuote(input));
  });

  it("fails closed when the hedge coin is not the option underlying", () => {
    const decision = evaluateQuote(
      makeQuoteInput({ hedgeMarket: makeHedgeMarket({ coin: "ETH" }) }),
    );

    requireDecline(decision, "HEDGE_INSTRUMENT_MISMATCH");
  });

  it("fails closed on non-finite confirmed portfolio exposure", () => {
    const decision = evaluateQuote(
      makeQuoteInput({
        portfolio: makePortfolio({
          confirmed: [
            {
              expiryBucket: "2026-02-14",
              exposure: makeExposure({
                netOptionDeltaUnderlying: Number.NaN,
              }),
            },
          ],
        }),
      }),
    );

    expect(decision.kind).toBe("DECLINE");
  });

  it("handles an allowed near-zero-delta option without throwing", () => {
    const input = makeQuoteInput({
      rfq: makeRfq({
        instrument: {
          expiryMs: NOW_MS + DAY_MS,
          strikeUsdPerUnderlying: 100_200 * 1.5,
        },
      }),
      optionMarket: makeOptionMarket({
        volatilityDecimal: 0.05,
        protocolAndOiFeesUsd: 0,
      }),
    });

    expect(() => evaluateQuote(input)).not.toThrow();
    const decision = evaluateQuote(input);
    expect(decision.kind).toBe("DECLINE");
    if (decision.kind === "DECLINE") {
      expect(decision.reasons).toContain("NON_POSITIVE_RESERVATION_BID");
    }
  });

  it("quotes without book consumption when hedge delta is inside the no-trade band", () => {
    const decision = requireQuote(
      evaluateQuote(
        makeQuoteInput({
          policy: makePolicy({ hedge: { noTradeBandUnderlying: 0.1 } }),
        }),
      ),
    );

    expect(decision.greeks.hedgeDeltaUnderlying).toBeLessThan(0.1);
    expect(decision.initialHedgePreview).toMatchObject({
      requestedQuantityUnderlying: 0,
      filledQuantityUnderlying: 0,
      unfilledQuantityUnderlying: 0,
      executable: true,
      vwapUsdPerUnderlying: null,
      worstPriceUsdPerUnderlying: null,
      tradedNotionalUsd: 0,
    });
    // A no-trade preview still reserves the candidate's potential future hedge
    // capacity so concurrent quotes cannot consume it twice.
    expect(decision.reservation.exposure.hedgeNotionalUsd).toBeGreaterThanOrEqual(
      Math.abs(decision.greeks.hedgeDeltaUnderlying) * 100_000,
    );
    expect(decision.reservation.exposure.hedgeInitialMarginUsd).toBeGreaterThan(
      0,
    );
  });
});
