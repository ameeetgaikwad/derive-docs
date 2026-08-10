// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  ContractBrowser,
  MobileOrderSheet,
  OrderTicket,
  type OrderSnapshot,
} from "./covered-call-ui";
import type { StrikeOption } from "@/hooks/protocol/useAvailableStrikes";

const expiryOne = 1_800_000_000;
const expiryTwo = expiryOne + 7 * 86_400;

const strike: StrikeOption = {
  strike: 75_000,
  strike18: 75_000n * 10n ** 18n,
  expiry: expiryOne,
  isCall: true,
  subId: 1n,
  instrumentName: "BTC-20270115-75000-C",
  otmPercent: 7.1,
  premium: 1_000,
  apr: 18.4,
  vol: 0.6,
  usedFallback: false,
};

const snapshot: OrderSnapshot = {
  amount: 0.5,
  strike,
  expiryLabel: "Jan 15, 2027",
  spotPrice: 70_000,
  indicativeTotalPremium: 500,
};

describe("covered-call contract browser", () => {
  it("switches assets and exposes staged markets without inventing prices", async () => {
    const user = userEvent.setup();
    const onMarketChange = vi.fn();
    render(
      <ContractBrowser
        title="Target Composer"
        markets={[
          { id: "BTC", displayName: "Bitcoin", kind: "crypto", enabled: true, collateral: { symbol: "BTCB", address: null, decimals: 18, scaledUi: false }, contracts: null, pythPriceId: null, marketHours: "24/7", strikeIncrement: 500, riskVolFloor: 0.4, maxSize: "5" },
          { id: "NVDA", displayName: "NVIDIA", kind: "equity", enabled: false, collateral: { symbol: "NVDAB", address: null, decimals: 18, scaledUi: true }, contracts: null, pythPriceId: null, marketHours: "24/5", strikeIncrement: 5, riskVolFloor: 0.35, maxSize: "100" },
        ]}
        selectedMarketId="NVDA"
        marketUnavailable
        expiries={[]}
        activeExpiry={null}
        strikes={[]}
        selectedStrike={null}
        spotPrice={0}
        isLoading={false}
        disabled={false}
        onExpiryChange={vi.fn()}
        onStrikeSelect={vi.fn()}
        onMarketChange={onMarketChange}
      />,
    );
    expect(screen.getByText(/staged and will appear/i)).toBeTruthy();
    await user.click(screen.getByRole("option", { name: "Bitcoin" }));
    expect(onMarketChange).toHaveBeenCalledWith("BTC");
  });

  it("selects expiries and strikes with keyboard-accessible buttons", async () => {
    const user = userEvent.setup();
    const onExpiryChange = vi.fn();
    const onStrikeSelect = vi.fn();
    render(
      <ContractBrowser
        title="Target Composer"
        expiries={[
          { epoch: expiryOne, label: "Jan 15, 2027" },
          { epoch: expiryTwo, label: "Jan 22, 2027" },
        ]}
        activeExpiry={expiryOne}
        strikes={[strike]}
        selectedStrike={null}
        spotPrice={70_000}
        isLoading={false}
        disabled={false}
        onExpiryChange={onExpiryChange}
        onStrikeSelect={onStrikeSelect}
      />,
    );

    const secondExpiry = screen.getByRole("tab", { name: /Jan 22/i });
    secondExpiry.focus();
    await user.keyboard("{Enter}");
    expect(onExpiryChange).toHaveBeenCalledWith(expiryTwo);

    const strikeButton = screen.getByRole("button", {
      name: /Select \$75,000 strike/i,
    });
    strikeButton.focus();
    await user.keyboard("{Enter}");
    expect(onStrikeSelect).toHaveBeenCalledWith(75_000, strikeButton);
  });

  it("keeps the selected strike available as a reopen target while locked", async () => {
    const user = userEvent.setup();
    const onStrikeSelect = vi.fn();
    const otherStrike: StrikeOption = {
      ...strike,
      strike: 80_000,
      strike18: 80_000n * 10n ** 18n,
      subId: 2n,
      instrumentName: "BTC-20270115-80000-C",
    };
    render(
      <ContractBrowser
        title="Target Composer"
        expiries={[{ epoch: expiryOne, label: "Jan 15, 2027" }]}
        activeExpiry={expiryOne}
        strikes={[strike, otherStrike]}
        selectedStrike={strike.strike}
        spotPrice={70_000}
        isLoading={false}
        disabled
        onExpiryChange={vi.fn()}
        onStrikeSelect={onStrikeSelect}
      />,
    );

    const selectedButton = screen.getByRole("button", {
      name: /Reopen \$75,000 strike/i,
    });
    const otherButton = screen.getByRole("button", {
      name: /Select \$80,000 strike/i,
    });
    expect((selectedButton as HTMLButtonElement).disabled).toBe(false);
    expect((otherButton as HTMLButtonElement).disabled).toBe(true);

    await user.click(selectedButton);
    expect(onStrikeSelect).toHaveBeenCalledWith(75_000, selectedButton);
  });
});

describe("covered-call order ticket", () => {
  it("validates balance and exposes the live-quote action", async () => {
    const user = userEvent.setup();
    const onAmountChange = vi.fn();
    const onRequestQuote = vi.fn();
    render(
      <OrderTicket
        snapshot={snapshot}
        amount="0.5"
        balance={0.25}
        isConnected
        amountLocked={false}
        setupPhase="idle"
        sellPhase="idle"
        auction={null}
        quote={null}
        error={null}
        doneInfo={null}
        onAmountChange={onAmountChange}
        onClose={vi.fn()}
        onRequestQuote={onRequestQuote}
        onAcceptQuote={vi.fn()}
        onCreateAnother={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toMatch(/no greater/i);
    expect(
      (screen.getByRole("button", { name: "Get live quote" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "MAX" }));
    expect(onAmountChange).toHaveBeenCalledWith("0.25");
  });

  it("shows a verified quote and requires an explicit acceptance action", async () => {
    const user = userEvent.setup();
    const onAcceptQuote = vi.fn();
    render(
      <OrderTicket
        snapshot={snapshot}
        amount="0.5"
        balance={1}
        isConnected
        amountLocked
        setupPhase="idle"
        sellPhase="quoted"
        auction={null}
        quote={{
          rfqId: "rfq-1",
          chainId: 97,
          instrumentName: strike.instrumentName,
          expiry: strike.expiry,
          strike: strike.strike,
          amount: "0.5",
          marketId: "BTC",
          rawAmount: "0.5",
          tokenDecimals: 18,
          uiMultiplier: null,
          optionAsset: "0x2222222222222222222222222222222222222222",
          spot: 70_000,
          indicativePremium: 1_000,
          quoteCount: 3,
          premium: 1_050,
          totalPremium: 525,
          acceptBy: Date.now() + 30_000,
        }}
        error={null}
        doneInfo={null}
        onAmountChange={vi.fn()}
        onClose={vi.fn()}
        onRequestQuote={vi.fn()}
        onAcceptQuote={onAcceptQuote}
        onCreateAnother={vi.fn()}
      />,
    );

    expect(screen.getByText("Winning executable quote")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Accept & sign" }));
    expect(onAcceptQuote).toHaveBeenCalledOnce();
  });

  it("updates the expiry explanation when the scenario moves above strike", () => {
    render(
      <OrderTicket
        snapshot={snapshot}
        amount="0.5"
        balance={1}
        isConnected
        amountLocked={false}
        setupPhase="idle"
        sellPhase="idle"
        auction={null}
        quote={null}
        error={null}
        doneInfo={null}
        onAmountChange={vi.fn()}
        onClose={vi.fn()}
        onRequestQuote={vi.fn()}
        onAcceptQuote={vi.fn()}
        onCreateAnother={vi.fn()}
      />,
    );

    fireEvent.change(
      screen.getByRole("slider", { name: "Simulated BTC price at expiry" }),
      { target: { value: "90000" } },
    );
    expect(screen.getByText(/USDT settlement offsets gains above/i)).toBeTruthy();
  });

  it("uses indicative pricing after an expired quote when the amount changes", () => {
    render(
      <OrderTicket
        snapshot={snapshot}
        amount="1"
        balance={2}
        isConnected
        amountLocked={false}
        setupPhase="idle"
        sellPhase="expired"
        auction={null}
        quote={{
          rfqId: "rfq-1",
          chainId: 97,
          instrumentName: strike.instrumentName,
          expiry: strike.expiry,
          strike: strike.strike,
          amount: "0.5",
          marketId: "BTC",
          rawAmount: "0.5",
          tokenDecimals: 18,
          uiMultiplier: null,
          optionAsset: "0x2222222222222222222222222222222222222222",
          spot: 70_000,
          indicativePremium: 1_000,
          quoteCount: 3,
          premium: 1_050,
          totalPremium: 525,
          acceptBy: Date.now() - 1_000,
        }}
        error={null}
        doneInfo={null}
        onAmountChange={vi.fn()}
        onClose={vi.fn()}
        onRequestQuote={vi.fn()}
        onAcceptQuote={vi.fn()}
        onCreateAnother={vi.fn()}
      />,
    );

    expect(screen.getByText("Quote expired")).toBeTruthy();
    expect(screen.getAllByText("Indicative premium")).toHaveLength(2);
    expect(screen.getAllByText("$1,000.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Get a new quote" })).toBeTruthy();
  });
});

describe("mobile order sheet", () => {
  it("closes on Escape and restores focus to the selected strike", async () => {
    const user = userEvent.setup();
    const returnButton = document.createElement("button");
    returnButton.textContent = "Selected strike";
    document.body.appendChild(returnButton);
    const onOpenChange = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <MobileOrderSheet
          open={open}
          preventClose={false}
          returnFocus={returnButton}
          onOpenChange={(next) => {
            onOpenChange(next);
            setOpen(next);
          }}
        >
          <button type="button">Inside ticket</button>
        </MobileOrderSheet>
      );
    }

    render(<Harness />);
    await user.keyboard("{Escape}");

    expect(onOpenChange).toHaveBeenCalledWith(false);
    await waitFor(() => expect(document.activeElement).toBe(returnButton));
    returnButton.remove();
  });
});
