// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CoveredCallPositions } from "./CoveredCallPositions";

const mocks = vi.hoisted(() => ({
  usePositions: vi.fn(),
  useSpotPrice: vi.fn(),
}));

vi.mock("@/hooks/protocol/usePositionMonitor", () => ({
  usePositions: mocks.usePositions,
}));

vi.mock("@/hooks/protocol/useSpotPrice", () => ({
  useSpotPrice: mocks.useSpotPrice,
}));

const futureExpiry = Math.floor(Date.now() / 1000) + 7 * 86_400;
const pastExpiry = Math.floor(Date.now() / 1000) - 86_400;

function position(
  subId: bigint,
  strike: number,
  status: "open" | "expired" | "settled",
  settledItm: boolean | null = null,
) {
  return {
    subId,
    instrumentName: `BTC-TEST-${strike}-C`,
    strike,
    expiry: status === "open" ? futureExpiry : pastExpiry,
    isCall: true,
    balance: -0.25,
    status,
    settlementPrice:
      status === "settled" ? (settledItm ? strike + 1_000 : strike - 1_000) : null,
    settledItm,
    trade: null,
  };
}

describe("covered-call position rows", () => {
  beforeEach(() => {
    mocks.useSpotPrice.mockReturnValue({ spotPrice: 70_000 });
    mocks.usePositions.mockReturnValue({
      subaccountId: 7n,
      cash: 500,
      btcb: 1,
      isLoading: false,
      options: [
        position(1n, 75_000, "open"),
        position(2n, 65_000, "open"),
        position(3n, 75_000, "expired"),
        position(4n, 65_000, "settled", true),
        position(5n, 75_000, "settled", false),
      ],
    });
  });

  it("distinguishes open, expired, and settled outcomes", () => {
    render(<CoveredCallPositions />);

    expect(mocks.useSpotPrice).toHaveBeenCalledTimes(5);
    expect(mocks.useSpotPrice.mock.calls.every(([marketId]) => marketId === "BTC")).toBe(true);
    expect(screen.getAllByText("OTM").length).toBeGreaterThan(0);
    expect(screen.getByText("ITM")).toBeTruthy();
    expect(screen.getByText("Awaiting settlement")).toBeTruthy();
    expect(screen.getByText("Settled ITM")).toBeTruthy();
    expect(screen.getByText("Settled OTM")).toBeTruthy();
  });

  it("expands a row to show collateral and cash-settlement details", async () => {
    const user = userEvent.setup();
    render(<CoveredCallPositions />);

    const rows = screen.getAllByRole("button", { name: /BTC covered call/i });
    await user.click(rows[0]);

    expect(screen.getByText("Exact expiry")).toBeTruthy();
    expect(screen.getByText("0.25 BTCB")).toBeTruthy();
    expect(screen.getByText("Cash settled at expiry")).toBeTruthy();
    expect(screen.getByText(/BTCB remains held/i)).toBeTruthy();
  });

  it("does not infer moneyness while spot is unavailable", () => {
    mocks.useSpotPrice.mockReturnValue({ spotPrice: 0 });
    render(<CoveredCallPositions />);

    expect(screen.getAllByText("Spot unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("OTM")).toBeNull();
    expect(screen.queryByText("ITM")).toBeNull();
  });
});
