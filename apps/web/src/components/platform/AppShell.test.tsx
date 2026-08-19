// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";

const mocks = vi.hoisted(() => ({
  pathname: "/app",
  selectedAccountId: 7n,
  selectSubaccount: vi.fn((accountId: bigint) => {
    mocks.selectedAccountId = accountId;
  }),
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.ComponentProps<"a">) => (
    <a href={href} {...props}>{children}</a>
  ),
}));
vi.mock("@rainbow-me/rainbowkit", () => ({
  ConnectButton: {
    Custom: ({ children }: { children: (value: unknown) => React.ReactNode }) =>
      children({
        account: { displayName: "0x111...111" },
        chain: { unsupported: false },
        mounted: true,
        openAccountModal: vi.fn(),
        openChainModal: vi.fn(),
        openConnectModal: vi.fn(),
      }),
  },
}));
vi.mock("wagmi", () => ({
  useAccount: () => ({ isConnected: true }),
  useSwitchChain: () => ({ switchChainAsync: vi.fn(async () => undefined) }),
}));
vi.mock("@/hooks/protocol/useBtcb", () => ({
  useBtcbBalance: () => ({ balanceNumber: 1.25 }),
  useMintBtcb: () => ({ isPending: false, mutate: vi.fn() }),
}));
vi.mock("@/hooks/protocol/useNetwork", () => ({
  useNetwork: () => ({
    chainId: 97,
    isTestnet: true,
    setChainId: vi.fn(),
  }),
}));
vi.mock("@/hooks/protocol/useCoveredCallSubaccount", () => ({
  useCoveredCallSubaccount: () => ({
    accounts: [
      { accountId: 7n, cashBalance: 5n * 10n ** 18n, nonZeroBalanceCount: 2 },
      { accountId: 9n, cashBalance: 0n, nonZeroBalanceCount: 0 },
    ],
    subaccountId: mocks.selectedAccountId,
    isLoading: false,
    isFetching: false,
    error: null,
    source: "directory",
    selectSubaccount: mocks.selectSubaccount,
    createSubaccount: vi.fn(async () => 12n),
    refetch: vi.fn(async () => undefined),
  }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function ActiveAccount({ view }: { view: string }): React.JSX.Element {
  return <p>{view} consumes account #{mocks.selectedAccountId.toString()}</p>;
}

describe("AppShell account context", () => {
  beforeEach(() => {
    mocks.pathname = "/app";
    mocks.selectedAccountId = 7n;
    vi.clearAllMocks();
  });

  it("keeps a navbar selection as the context consumed across app routes", async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <AppShell><ActiveAccount view="Options" /></AppShell>,
    );

    await user.click(screen.getByRole("button", { name: /trading subaccount #7/i }));
    await user.click(screen.getByRole("menuitemradio", { name: /#9.*0 USDT/i }));
    expect(mocks.selectSubaccount).toHaveBeenCalledWith(9n);

    mocks.pathname = "/app/positions";
    rerender(<AppShell><ActiveAccount view="Positions" /></AppShell>);
    expect(screen.getByRole("button", { name: /trading subaccount #9/i })).toBeTruthy();
    expect(screen.getByText("Positions consumes account #9")).toBeTruthy();
  });
});
