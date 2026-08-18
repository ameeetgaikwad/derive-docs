import type { RiskReservation } from "./exposures.js";

export interface ReservationSnapshot {
  readonly version: number;
  readonly reservations: readonly RiskReservation[];
}

export type ReservationOperation =
  | { readonly kind: "UPSERT"; readonly reservation: RiskReservation }
  | { readonly kind: "RELEASE"; readonly reservationId: string };

/**
 * Shadow-only compare-and-swap ledger. The API deliberately mirrors the
 * transaction boundary required from a durable production implementation.
 */
export class InMemoryReservationLedger {
  private version = 0;
  private readonly reservations = new Map<string, RiskReservation>();

  snapshot(nowMs: number): ReservationSnapshot {
    if (!Number.isFinite(nowMs)) throw new RangeError("nowMs must be finite");
    return {
      version: this.version,
      // Time never releases risk by itself. `expiresAtMs` only makes an entry
      // eligible for authoritative terminal-state reconciliation.
      reservations: [...this.reservations.values()],
    };
  }

  tryApply(
    expectedVersion: number,
    operation: ReservationOperation,
  ): boolean {
    if (expectedVersion !== this.version) return false;

    if (operation.kind === "UPSERT") {
      if (operation.reservation.basedOnLedgerVersion !== expectedVersion) {
        return false;
      }
      this.reservations.set(
        operation.reservation.reservationId,
        operation.reservation,
      );
    } else {
      if (!this.reservations.has(operation.reservationId)) return false;
      this.reservations.delete(operation.reservationId);
    }
    this.version += 1;
    return true;
  }
}
