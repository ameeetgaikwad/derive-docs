// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FundsModal } from "./FundsModal";
import type { WithdrawalPreview } from "@/lib/protocol/withdrawals";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const mocks = vi.hoisted(() => ({
  accounts: [{ accountId: 7n }, { accountId: 9n }],
  globalAccountId: 7n as bigint | null,
  debt: 0n,
  preview: null as WithdrawalPreview | null,
  phase: "idle",
  isAmountReviewed: false,
  requestPreview: vi.fn(),
  resetWithdraw: vi.fn(),
}));

const scaledAsset = {
  assetId: "market:SPY" as const, marketId: "SPY" as const, kind: "market-collateral" as const,
  symbol: "SPYB", displayName: "SPY collateral", protocolAsset: "0x2222222222222222222222222222222222222222" as const,
  tokenAddress: "0x3333333333333333333333333333333333333333" as const, tokenDecimals: 18,
  scaledUi: true, exitOnly: false, balance18: 10n * 10n ** 18n, multiplier: 250_000_000_000_000_000n,
  conversionReady: true, displayBalance18: 2_500_000_000_000_000_000n, maxNativeAmount: 10n * 10n ** 18n,
};

vi.mock("wagmi", () => ({ useAccount: () => ({ address: OWNER }) }));
vi.mock("@/hooks/protocol/useNetwork", () => ({ useNetwork: () => ({ explorerUrl: "https://example.test" }) }));
vi.mock("@/hooks/protocol/useCoveredCallSubaccount", () => ({ useCoveredCallSubaccount: () => ({ accounts: mocks.accounts, subaccountId: mocks.globalAccountId, isLoading: false }) }));
vi.mock("@/hooks/protocol/useSubaccountAssets", () => ({ useSubaccountAssets: () => ({ assets: [scaledAsset], cashDebt18: mocks.debt, cashBalanceWithInterest18: -mocks.debt, hasOptionPositions: false, isLoading: false, error: null, refetch: vi.fn() }) }));
vi.mock("@/hooks/protocol/useRepayCash", () => ({
  bufferedRepayTokenUnits: (debt: bigint) => debt,
  useRepayCash: () => ({ phase: "idle", error: null, tokenDecimals: 6, walletBalance: 10_000_000n, reset: vi.fn(), repay: vi.fn() }),
}));
vi.mock("@/hooks/protocol/useWithdraw", () => ({ useWithdraw: () => ({
  phase: mocks.phase, preview: mocks.preview, preparedReview: null, withdrawal: null, error: null,
  isBusy: false, isAmountReviewed: mocks.isAmountReviewed, requestPreview: mocks.requestPreview,
  prepare: vi.fn(), signAndSubmit: vi.fn(), reconcile: vi.fn(), reset: mocks.resetWithdraw,
}) }));

function preview(): WithdrawalPreview {
  return {
    chainId: 97, matching: "0x4444444444444444444444444444444444444444", withdrawalModule: "0x5555555555555555555555555555555555555555", owner: OWNER,
    subaccountId: "7", asset: { assetId: "market:SPY", kind: "market-collateral", marketId: "SPY", symbol: "SPYB", assetAddress: scaledAsset.protocolAsset, tokenAddress: scaledAsset.tokenAddress, tokenDecimals: 18, scaledUi: true },
    internalBalance: "10000000000000000000", balanceTokenUnits: "10000000000000000000", cashWithInterest: "0", debtTokenUnits: "0",
    margin: { initial: { margin: "0", markToMarket: "0" }, maintenance: { margin: "0", markToMarket: "0" } },
    protocolMaxTokenUnits: "10000000000000000000", recommendedMaxTokenUnits: "8000000000000000000", multiplier: "250000000000000000",
    blockNumber: "123", blockHash: `0x${"1".repeat(64)}`, checkedAt: 1, expiresAt: Date.now() + 30_000, blocker: null,
  };
}

describe("FundsModal", () => {
  beforeEach(() => {
    mocks.accounts = [{ accountId: 7n }, { accountId: 9n }]; mocks.globalAccountId = 7n;
    mocks.debt = 0n; mocks.preview = null; mocks.phase = "idle"; mocks.isAmountReviewed = false;
    mocks.requestPreview.mockReset().mockImplementation(async () => { mocks.preview = preview(); mocks.phase = "review"; return mocks.preview; });
    mocks.resetWithdraw.mockReset();
  });

  it("keeps the modal-local account when the global account query refreshes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FundsModal open onOpenChange={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText("Funds account"), "9");
    mocks.accounts = [{ accountId: 7n }, { accountId: 9n }, { accountId: 11n }];
    mocks.globalAccountId = 7n;
    rerender(<FundsModal open onOpenChange={vi.fn()} />);
    expect((screen.getByLabelText("Funds account") as HTMLSelectElement).value).toBe("9");
  });

  it("selects the validated global account when async account loading completes", () => {
    mocks.accounts = [];
    const { rerender } = render(<FundsModal open onOpenChange={vi.fn()} />);
    expect((screen.getByLabelText("Funds account") as HTMLSelectElement).value).toBe("");
    mocks.accounts = [{ accountId: 7n }, { accountId: 9n }];
    rerender(<FundsModal open onOpenChange={vi.fn()} />);
    expect((screen.getByLabelText("Funds account") as HTMLSelectElement).value).toBe("7");
  });

  it("fetches Max from the server and renders scaled UI units at the snapshot block", async () => {
    const user = userEvent.setup();
    render(<FundsModal open onOpenChange={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Max" }));
    expect(mocks.requestPreview).toHaveBeenCalledWith({
      subaccountId: 7n,
      assetId: "market:SPY",
      protocolAsset: scaledAsset.protocolAsset,
      tokenAddress: scaledAsset.tokenAddress,
    });
    expect((screen.getByLabelText("Amount") as HTMLInputElement).value).toBe("2");
    expect(screen.getByText("2.5 SPYB")).toBeTruthy();
    expect(screen.getByText("Block #123")).toBeTruthy();
  });

  it("rejects zero before making a preview request and keeps repay optional", async () => {
    const user = userEvent.setup();
    mocks.debt = 5n * 10n ** 18n;
    render(<FundsModal open onOpenChange={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Withdraw" }).getAttribute("aria-selected")).toBe("true");
    await user.type(screen.getByLabelText("Amount"), "0");
    await user.click(screen.getByRole("button", { name: "Review withdrawal" }));
    expect(mocks.requestPreview).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toMatch(/greater than zero/i);
  });
});
