// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  MarketSelector,
  OrderTicket,
  TradeConfigurator,
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
  forwardPrice: 70_250,
  usedFallback: false,
};

const otherStrike: StrikeOption = {
  ...strike,
  strike: 80_000,
  strike18: 80_000n * 10n ** 18n,
  subId: 2n,
  instrumentName: "BTC-20270115-80000-C",
  otmPercent: 14.3,
  premium: 500,
  apr: 9.2,
};

const snapshot: OrderSnapshot = {
  amount: 0.5,
  strike,
  expiryLabel: "Jan 15, 2027",
  spotPrice: 70_000,
  indicativeTotalPremium: 500,
  estimatedOiFee: 35,
};

const preparedQuote = {
  rfqId: "rfq-1",
  chainId: 97 as const,
  instrumentName: strike.instrumentName,
  expiry: strike.expiry,
  strike: strike.strike,
  amount: "0.5",
  marketId: "BTC" as const,
  rawAmount: "0.5",
  tokenDecimals: 18,
  uiMultiplier: null,
  optionAsset: "0x2222222222222222222222222222222222222222" as const,
  spot: 70_000,
  indicativePremium: 1_000,
  quoteCount: 3,
  premium: 1_050,
  totalPremium: 525,
  acceptBy: Date.now() + 30_000,
};

const history = [
  { time: Date.UTC(2027, 0, 13) / 1_000, value: 67_500 },
  { time: Date.UTC(2027, 0, 14) / 1_000, value: 69_000 },
  { time: Date.UTC(2027, 0, 15) / 1_000, value: 68_000 },
];

function renderConfigurator(overrides: Partial<Parameters<typeof TradeConfigurator>[0]> = {}) {
  const props: Parameters<typeof TradeConfigurator>[0] = {
    expiries: [
      { epoch: expiryOne, label: "Jan 15, 2027" },
      { epoch: expiryTwo, label: "Jan 22, 2027" },
    ],
    activeExpiry: expiryOne,
    strikes: [strike, otherStrike],
    selectedStrike: strike.strike,
    spotPrice: 70_000,
    history,
    historyState: "ready",
    isLoading: false,
    disabled: false,
    coveredAmount: 0.5,
    onExpiryChange: vi.fn(),
    onStrikeSelect: vi.fn(),
    ...overrides,
  };
  render(<TradeConfigurator {...props} />);
  return props;
}

describe("covered-call terms surface", () => {
  it("switches assets and exposes staged markets without inventing prices", async () => {
    const user = userEvent.setup();
    const onMarketChange = vi.fn();
    const markets = [
      { id: "BTC", displayName: "Bitcoin", kind: "crypto", enabled: true, collateral: { symbol: "BTCB", address: null, decimals: 18, scaledUi: false }, contracts: null, pythPriceId: null, marketHours: "24/7", strikeIncrement: 500, riskVolFloor: 0.4, maxSize: "5" },
      { id: "NVDA", displayName: "NVIDIA", kind: "equity", enabled: false, collateral: { symbol: "NVDAB", address: null, decimals: 18, scaledUi: true }, contracts: null, pythPriceId: null, marketHours: "24/5", strikeIncrement: 5, riskVolFloor: 0.35, maxSize: "100" },
    ] satisfies Parameters<typeof MarketSelector>[0]["markets"];

    render(
      <MarketSelector
        markets={markets}
        selectedMarketId="NVDA"
        disabled={false}
        onMarketChange={onMarketChange}
      />,
    );
    renderConfigurator({
      markets,
      selectedMarketId: "NVDA",
      marketUnavailable: true,
      unavailableReason: "NVIDIA is staged and will appear after its market infrastructure is enabled.",
      activeExpiry: null,
      strikes: [],
      selectedStrike: null,
      spotPrice: 0,
    });

    expect(screen.getByText(/staged and will appear/i)).toBeTruthy();
    await user.click(screen.getByRole("option", { name: /Bitcoin/i }));
    expect(onMarketChange).toHaveBeenCalledWith("BTC");
  });

  it("keeps expiry and strike comparison in one accessible market surface", async () => {
    const user = userEvent.setup();
    const props = renderConfigurator();

    await user.click(screen.getByRole("tab", { name: /Jan 22/i }));
    expect(props.onExpiryChange).toHaveBeenCalledWith(expiryTwo);

    await user.click(screen.getByRole("button", { name: /\$80,000/i }));
    expect(props.onStrikeSelect).toHaveBeenCalledWith(80_000);
    expect(screen.getByRole("slider", { name: /Bitcoin 30-day price history/i })).toBeTruthy();
  });

  it("reveals the nearest dated price while the chart is inspected", () => {
    renderConfigurator();
    const chart = screen.getByRole("slider", { name: /Bitcoin 30-day price history/i });
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
      left: 0,
      width: 720,
    } as DOMRect);

    fireEvent.pointerMove(chart, { clientX: 360 });
    expect(screen.getByText("Jan 14, 2027")).toBeTruthy();
    expect(screen.getByText("$69,000.00")).toBeTruthy();

    fireEvent.pointerMove(chart, { clientX: 720 });
    const latestTooltipLabel = screen.getByText("Now");
    expect(latestTooltipLabel.parentElement?.textContent).toContain("$70,000.00");
    expect(chart.getAttribute("aria-valuetext")).toBe("Now, $70,000.00");
  });

  it("supports keyboard inspection across the chart history", () => {
    renderConfigurator();
    const chart = screen.getByRole("slider", { name: /Bitcoin 30-day price history/i });

    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(chart.getAttribute("aria-valuetext")).toBe("Jan 14, 2027, $69,000.00");

    fireEvent.keyDown(chart, { key: "Home" });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(chart.getAttribute("aria-valuenow")).toBe("0");
    expect(chart.getAttribute("aria-valuetext")).toBe("Jan 13, 2027, $67,500.00");

    fireEvent.keyDown(chart, { key: "End" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(chart.getAttribute("aria-valuenow")).toBe("2");
    expect(chart.getAttribute("aria-valuetext")).toBe("Now, $70,000.00");
  });

  it("shows amount-scaled premiums and returns side by side instead of hiding contracts behind a slider", () => {
    renderConfigurator();

    expect(screen.getByText("Return")).toBeTruthy();
    expect(screen.getByText("APR")).toBeTruthy();
    expect(screen.getByText("Est. premium")).toBeTruthy();
    expect(screen.getByText("$500.00")).toBeTruthy();
    expect(screen.getByText("$250.00")).toBeTruthy();
    expect(screen.queryByText(/choose a row|suggested marks|indicative premiums/i)).toBeNull();
    expect(screen.queryByRole("slider", { name: "Sell target" })).toBeNull();
  });

  it("reprices every strike row when the covered amount changes", () => {
    renderConfigurator({ coveredAmount: 0.25 });

    expect(screen.getByText("$250.00")).toBeTruthy();
    expect(screen.getByText("$125.00")).toBeTruthy();
  });

  it("omits strikes without a meaningful modeled premium", () => {
    const zeroPremiumStrike: StrikeOption = {
      ...otherStrike,
      strike: 90_000,
      strike18: 90_000n * 10n ** 18n,
      instrumentName: "BTC-20270115-90000-C",
      premium: 0,
      apr: 0,
    };
    renderConfigurator({ strikes: [strike, zeroPremiumStrike] });

    expect(screen.getAllByText("$75,000").length).toBeGreaterThan(0);
    expect(screen.queryByText("$90,000")).toBeNull();
    expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  });

  it("does not invent a price path when BTC history is unavailable", () => {
    renderConfigurator({ history: [], historyState: "unavailable" });

    expect(screen.getByText("30-day BTC history unavailable")).toBeTruthy();
    expect(screen.getByRole("img", { name: /currently unavailable/i })).toBeTruthy();
  });
});

function renderTicket(overrides: Partial<Parameters<typeof OrderTicket>[0]> = {}) {
  const props: Parameters<typeof OrderTicket>[0] = {
    snapshot,
    amount: "0.5",
    balance: 1,
    maxAmount: "1",
    hasSubaccount: true,
    depositedBalance: 1,
    isConnected: true,
    setupPhase: "idle",
    sellPhase: "idle",
    auction: null,
    quote: null,
    error: null,
    doneInfo: null,
    feeReadState: "ready",
    controlsDisabled: false,
    onAmountChange: vi.fn(),
    onRequestQuote: vi.fn(),
    onAcceptQuote: vi.fn(),
    onCreateAnother: vi.fn(),
    ...overrides,
  };
  render(<OrderTicket {...props} />);
  return props;
}

describe("covered-call quote rail", () => {
  it("shows expected net cash change after the live protocol fee estimate", () => {
    renderTicket();

    expect(screen.getByText("Expected net cash change")).toBeTruthy();
    expect(screen.getByText("$465.00")).toBeTruthy();
    expect(screen.getByText("−$35.00")).toBeTruthy();
  });

  it("blocks a quote when the amount exceeds the detected balance", () => {
    renderTicket({ balance: 0.25 });
    expect(
      (screen.getByRole("button", { name: "Insufficient BTCB" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("enforces the market maximum before opening an auction", async () => {
    const user = userEvent.setup();
    const onRequestQuote = vi.fn();
    renderTicket({
      amount: "0.010000000000000001",
      balance: 0.25,
      maxAmount: "0.01",
      onRequestQuote,
    });

    expect(screen.getByRole("alert").textContent).toMatch(/maximum order size is 0\.01/i);
    const quoteButton = screen.getByRole("button", { name: "Amount exceeds maximum" });
    expect((quoteButton as HTMLButtonElement).disabled).toBe(true);
    await user.click(quoteButton);
    expect(onRequestQuote).not.toHaveBeenCalled();
  });

  it("shows a verified quote and requires explicit acceptance", async () => {
    const user = userEvent.setup();
    const onAcceptQuote = vi.fn();
    renderTicket({
      sellPhase: "quoted",
      quote: preparedQuote,
      onAcceptQuote,
    });

    expect(screen.getByText("Winning executable quote")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Accept & sign" }));
    expect(onAcceptQuote).toHaveBeenCalledOnce();
  });

  it("keeps first-trade setup behind one actionable quote button", async () => {
    const user = userEvent.setup();
    const onRequestQuote = vi.fn();
    renderTicket({ hasSubaccount: false, depositedBalance: 0, onRequestQuote });

    expect(screen.queryByText(/first-trade preparation/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Prepare & request quote" }));
    expect(onRequestQuote).toHaveBeenCalledOnce();
  });

  it("keeps settlement mechanics inside the collapsed expiry payoff", async () => {
    const user = userEvent.setup();
    renderTicket();
    const summary = screen.getByText("Payoff at expiry").closest("summary");
    const details = summary?.closest("details");
    const contractDetails = screen.getByText("Contract details").closest("details");
    expect(summary).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(contractDetails?.open).toBe(true);

    await user.click(summary!);
    expect(details?.open).toBe(true);
    fireEvent.change(
      within(details!).getByRole("slider", { name: "Simulated BTC price at expiry" }),
      { target: { value: "90000" } },
    );
    expect(within(details!).getByText("$7,500.00")).toBeTruthy();
    expect(within(details!).getByText(/USDT shortfalls borrow against BTCB · no early exit/i)).toBeTruthy();
  });

  it("returns to indicative economics after a quote expires", () => {
    renderTicket({
      amount: "1",
      balance: 2,
      depositedBalance: 2,
      sellPhase: "expired",
      quote: { ...preparedQuote, acceptBy: Date.now() - 1_000 },
    });

    expect(screen.getByText("Quote expired")).toBeTruthy();
    expect(screen.getAllByText("$1,000.00").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Request a new quote" })).toBeTruthy();
  });
});
