import { describe, expect, it } from "vitest";

import { InMemoryReservationLedger } from "../src/risk/reservations.js";
import { NOW_MS, makeExposure, makeReservation } from "./fixtures.js";

describe("InMemoryReservationLedger", () => {
  it("enforces compare-and-swap, supports replacement, and releases atomically", () => {
    const ledger = new InMemoryReservationLedger();
    const original = makeReservation({
      reservationId: "rfq:1",
      rfqId: "1",
      basedOnLedgerVersion: 0,
      exposure: makeExposure({ protocolCashOutflowUsd: 10 }),
    });

    expect(ledger.snapshot(NOW_MS)).toEqual({ version: 0, reservations: [] });
    expect(
      ledger.tryApply(0, { kind: "UPSERT", reservation: original }),
    ).toBe(true);
    expect(
      ledger.tryApply(0, { kind: "RELEASE", reservationId: "rfq:1" }),
    ).toBe(false);
    expect(ledger.snapshot(NOW_MS)).toMatchObject({
      version: 1,
      reservations: [{ exposure: { protocolCashOutflowUsd: 10 } }],
    });

    const replacement = makeReservation({
      ...original,
      basedOnLedgerVersion: 1,
      exposure: makeExposure({ protocolCashOutflowUsd: 20 }),
    });
    expect(
      ledger.tryApply(1, { kind: "UPSERT", reservation: replacement }),
    ).toBe(true);
    expect(ledger.snapshot(NOW_MS)).toMatchObject({
      version: 2,
      reservations: [{ exposure: { protocolCashOutflowUsd: 20 } }],
    });

    expect(
      ledger.tryApply(2, { kind: "RELEASE", reservationId: "rfq:1" }),
    ).toBe(true);
    expect(ledger.snapshot(NOW_MS)).toEqual({ version: 3, reservations: [] });
    expect(
      ledger.tryApply(3, { kind: "RELEASE", reservationId: "rfq:1" }),
    ).toBe(false);
    expect(ledger.snapshot(NOW_MS).version).toBe(3);
  });

  it("rejects an upsert whose embedded decision version is stale", () => {
    const ledger = new InMemoryReservationLedger();
    const staleDecision = makeReservation({ basedOnLedgerVersion: 4 });

    expect(
      ledger.tryApply(0, { kind: "UPSERT", reservation: staleDecision }),
    ).toBe(false);
    expect(ledger.snapshot(NOW_MS)).toEqual({ version: 0, reservations: [] });
  });

  it("retains expired reservations until an authoritative release is applied", () => {
    const ledger = new InMemoryReservationLedger();
    const expiring = makeReservation({
      basedOnLedgerVersion: 0,
      expiresAtMs: NOW_MS + 100,
    });

    expect(
      ledger.tryApply(0, { kind: "UPSERT", reservation: expiring }),
    ).toBe(true);
    expect(ledger.snapshot(NOW_MS + 100).reservations).toHaveLength(1);
    expect(ledger.snapshot(NOW_MS + 101).reservations).toHaveLength(1);
    expect(
      ledger.tryApply(1, {
        kind: "RELEASE",
        reservationId: expiring.reservationId,
      }),
    ).toBe(true);
    expect(ledger.snapshot(NOW_MS + 101)).toEqual({
      version: 2,
      reservations: [],
    });
  });
});
