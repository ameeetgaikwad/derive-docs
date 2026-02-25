import { describe, it, expect, beforeEach } from "vitest";
import { useCoveredCallStore } from "../covered-call";
import type { CoveredCallPosition } from "@/lib/derive/types";

function makePosition(
  overrides: Partial<CoveredCallPosition> = {}
): CoveredCallPosition {
  return {
    subaccountId: 1000,
    asset: "WBTC",
    amount: "0.01",
    instrumentName: "BTC-20260328-100000-C",
    strike: 100000,
    expiry: 1743120000,
    premiumUsdc: "50.00",
    status: "active",
    ...overrides,
  };
}

beforeEach(() => {
  useCoveredCallStore.getState().reset();
});

describe("addPosition", () => {
  it("adds to empty store", () => {
    const store = useCoveredCallStore.getState();
    store.addPosition(makePosition());
    expect(useCoveredCallStore.getState().positions).toHaveLength(1);
    expect(useCoveredCallStore.getState().positions[0].subaccountId).toBe(1000);
  });

  it("appends without replacing", () => {
    const store = useCoveredCallStore.getState();
    store.addPosition(makePosition({ subaccountId: 1000 }));
    store.addPosition(makePosition({ subaccountId: 2000 }));
    expect(useCoveredCallStore.getState().positions).toHaveLength(2);
  });
});

describe("updatePosition", () => {
  it("updates matching subaccountId", () => {
    const store = useCoveredCallStore.getState();
    store.addPosition(makePosition({ subaccountId: 1000, status: "active" }));
    store.updatePosition(1000, { status: "closed" });
    expect(useCoveredCallStore.getState().positions[0].status).toBe("closed");
  });

  it("leaves non-matching positions untouched", () => {
    const store = useCoveredCallStore.getState();
    store.addPosition(makePosition({ subaccountId: 1000, status: "active" }));
    store.addPosition(makePosition({ subaccountId: 2000, status: "deposited" }));
    store.updatePosition(1000, { status: "closed" });
    expect(useCoveredCallStore.getState().positions[1].status).toBe("deposited");
  });
});

describe("removePosition", () => {
  it("removes by subaccountId", () => {
    const store = useCoveredCallStore.getState();
    store.addPosition(makePosition({ subaccountId: 1000 }));
    store.removePosition(1000);
    expect(useCoveredCallStore.getState().positions).toHaveLength(0);
  });

  it("no-op for non-existent id", () => {
    const store = useCoveredCallStore.getState();
    store.addPosition(makePosition({ subaccountId: 1000 }));
    store.removePosition(9999);
    expect(useCoveredCallStore.getState().positions).toHaveLength(1);
  });
});

describe("getPosition", () => {
  it("returns matching position", () => {
    const store = useCoveredCallStore.getState();
    store.addPosition(makePosition({ subaccountId: 1000, amount: "0.5" }));
    const pos = useCoveredCallStore.getState().getPosition(1000);
    expect(pos).toBeDefined();
    expect(pos!.amount).toBe("0.5");
  });

  it("returns undefined for missing id", () => {
    const pos = useCoveredCallStore.getState().getPosition(9999);
    expect(pos).toBeUndefined();
  });
});

describe("getActivePositions", () => {
  it("excludes closed positions", () => {
    const store = useCoveredCallStore.getState();
    store.addPosition(makePosition({ subaccountId: 1000, status: "active" }));
    store.addPosition(makePosition({ subaccountId: 2000, status: "deposited" }));
    store.addPosition(makePosition({ subaccountId: 3000, status: "closed" }));
    const active = useCoveredCallStore.getState().getActivePositions();
    expect(active).toHaveLength(2);
    expect(active.map((p) => p.subaccountId)).toEqual([1000, 2000]);
  });

  it("returns empty array when store is empty", () => {
    const active = useCoveredCallStore.getState().getActivePositions();
    expect(active).toEqual([]);
  });
});

describe("reset", () => {
  it("clears all positions", () => {
    const store = useCoveredCallStore.getState();
    store.addPosition(makePosition({ subaccountId: 1000 }));
    store.addPosition(makePosition({ subaccountId: 2000 }));
    store.addPosition(makePosition({ subaccountId: 3000 }));
    store.reset();
    expect(useCoveredCallStore.getState().positions).toHaveLength(0);
  });
});
