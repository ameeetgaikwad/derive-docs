// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAccountStore } from "@/stores/account";
import { SubaccountMenu } from "./SubaccountMenu";

const mocks = vi.hoisted(() => ({
  createSubaccount: vi.fn(async () => 12n),
  refetch: vi.fn(async () => undefined),
  selectSubaccount: vi.fn(),
  useCoveredCallSubaccount: vi.fn(),
}));

vi.mock("@/hooks/protocol/useCoveredCallSubaccount", () => ({
  useCoveredCallSubaccount: mocks.useCoveredCallSubaccount,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

describe("SubaccountMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAccountStore.setState({ selectionLocked: false });
    mocks.useCoveredCallSubaccount.mockReturnValue({
      accounts: [
        { accountId: 7n, cashBalance: 5n * 10n ** 18n, nonZeroBalanceCount: 2 },
        { accountId: 9n, cashBalance: 0n, nonZeroBalanceCount: 0 },
      ],
      subaccountId: 7n,
      isLoading: false,
      isFetching: false,
      error: null,
      source: "directory",
      selectSubaccount: mocks.selectSubaccount,
      createSubaccount: mocks.createSubaccount,
      refetch: mocks.refetch,
    });
  });

  it("switches the global account from a complete balance-aware menu", async () => {
    const user = userEvent.setup();
    render(<SubaccountMenu />);

    const trigger = screen.getByRole("button", { name: /trading subaccount #7/i });
    await user.click(trigger);

    expect(screen.getByRole("menuitemradio", { name: /#7.*5 USDT.*2 balances/i })).toBeTruthy();
    const accountNine = screen.getByRole("menuitemradio", {
      name: /#9.*0 USDT.*0 balances/i,
    });
    await user.click(accountNine);

    expect(mocks.selectSubaccount).toHaveBeenCalledWith(9n);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("creates accounts and recovers discovery failures from the menu", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SubaccountMenu />);

    await user.click(screen.getByRole("button", { name: /trading subaccount #7/i }));
    await user.click(screen.getByRole("menuitem", { name: /create subaccount/i }));
    expect(mocks.createSubaccount).toHaveBeenCalledOnce();

    mocks.useCoveredCallSubaccount.mockReturnValue({
      accounts: [],
      subaccountId: null,
      isLoading: false,
      isFetching: false,
      error: new Error("directory unavailable; RPC fallback failed"),
      source: null,
      selectSubaccount: mocks.selectSubaccount,
      createSubaccount: mocks.createSubaccount,
      refetch: mocks.refetch,
    });
    rerender(<SubaccountMenu />);

    await user.click(screen.getByRole("button", { name: /choose trading subaccount/i }));
    expect(screen.getByRole("alert").textContent).toMatch(/directory unavailable/i);
    await user.click(screen.getByRole("menuitem", { name: /retry account discovery/i }));
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it("closes on Escape, restores trigger focus, and respects the trading lock", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SubaccountMenu />);
    const trigger = screen.getByRole("button", { name: /trading subaccount #7/i });

    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);

    useAccountStore.setState({ selectionLocked: true });
    rerender(<SubaccountMenu />);
    expect((trigger as HTMLButtonElement).disabled).toBe(true);
  });
});
