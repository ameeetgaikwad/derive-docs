import type { Address, PublicClient, WalletClient } from "viem";
import type { PrivateKeyAccount } from "viem/accounts";
import {
  fromUnit,
  getDeployedAddress,
  instrumentNameFromSubId,
  requireDeployments,
  standardManagerAbi,
  subAccountsAbi,
} from "@hedge/shared";
import type { FeedPoster } from "./poster.js";

export interface SettlementAddresses {
  standardManager: Address;
  optionAsset: Address;
  subAccounts: Address;
  cashAsset: Address;
  baseAsset: Address;
}

export function settlementAddressesFromDeployments(chainId: number): SettlementAddresses {
  const d = requireDeployments(chainId);
  return {
    standardManager: getDeployedAddress(d, "standardManager"),
    optionAsset: getDeployedAddress(d, "btcOptionAsset"),
    subAccounts: getDeployedAddress(d, "subAccounts"),
    cashAsset: getDeployedAddress(d, "cashAsset"),
    baseAsset: getDeployedAddress(d, "btcBaseAsset"),
  };
}

export interface SubaccountBalance {
  asset: Address;
  subId: bigint;
  balance: bigint;
  label: string;
}

export interface SettlementReport {
  expiry: bigint;
  settlementPrice: bigint;
  balances: Record<string, SubaccountBalance[]>; // key: subaccount id
}

/**
 * Settlement runner. Sequence verified against the vendored integration test
 * v2-core/test/integration-tests/standard-manager/settle-option.sol:
 *   1. (at/after expiry) post fresh spot,
 *   2. post forward-feed settlement data (timestamp == expiry, TWAP aggregates),
 *   3. StandardManager.settleOptions(optionAsset, subaccount) per account
 *      (public function, callable by anyone),
 *   4. read back balances.
 */
export class SettlementRunner {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly walletClient: WalletClient,
    private readonly account: PrivateKeyAccount,
    private readonly poster: FeedPoster,
    private readonly addresses: SettlementAddresses,
  ) {}

  async run(params: {
    expiry: bigint;
    price: bigint; // 18dp settlement price
    subaccounts: bigint[];
    /** skip posting feed data (already fixed on-chain) */
    skipFeed?: boolean;
  }): Promise<SettlementReport> {
    const { expiry, price, subaccounts } = params;

    const now = await this.poster.chainNow();
    if (now < expiry) {
      throw new Error(`Cannot settle: chain time ${now} < expiry ${expiry}`);
    }

    if (!params.skipFeed) {
      // Fresh spot first: post-warp the cached spot is stale and several
      // manager views depend on it.
      const spotTx = await this.poster.postSpot(price);
      log(`spot=${fromUnit(price)} posted  tx=${spotTx}`);

      const already = await this.poster.readSettlementPrice(expiry);
      if (already.settled) {
        log(`settlement price already fixed at ${fromUnit(already.price)} — not reposting`);
      } else {
        const tx = await this.poster.postSettlement(expiry, price);
        log(`settlement data posted for expiry ${expiry}  tx=${tx}`);
      }
    }

    const fixed = await this.poster.readSettlementPrice(expiry);
    if (!fixed.settled) {
      throw new Error(`Forward feed did not register settlement data for expiry ${expiry}`);
    }
    log(`getSettlementPrice(${expiry}) = ${fromUnit(fixed.price)} (settled)`);

    for (const acc of subaccounts) {
      const hash = await this.walletClient.writeContract({
        address: this.addresses.standardManager,
        abi: standardManagerAbi,
        functionName: "settleOptions",
        args: [this.addresses.optionAsset, acc],
        account: this.account,
        chain: this.walletClient.chain ?? null,
      });
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error(`settleOptions(${acc}) reverted (tx ${hash})`);
      }
      log(`settled subaccount ${acc}  tx=${hash}`);
    }

    const balances: Record<string, SubaccountBalance[]> = {};
    for (const acc of subaccounts) {
      balances[acc.toString()] = await this.getBalances(acc);
    }
    this.printBalances(balances);

    return { expiry, settlementPrice: fixed.price, balances };
  }

  async getBalances(subaccount: bigint): Promise<SubaccountBalance[]> {
    const raw = await this.publicClient.readContract({
      address: this.addresses.subAccounts,
      abi: subAccountsAbi,
      functionName: "getAccountBalances",
      args: [subaccount],
    });
    return raw.map((b) => ({
      asset: b.asset,
      subId: b.subId,
      balance: b.balance,
      label: this.labelFor(b.asset, b.subId),
    }));
  }

  private labelFor(asset: Address, subId: bigint): string {
    const a = asset.toLowerCase();
    if (a === this.addresses.cashAsset.toLowerCase()) return "USDT (cash)";
    if (a === this.addresses.baseAsset.toLowerCase()) return "BTCB (base)";
    if (a === this.addresses.optionAsset.toLowerCase()) {
      try {
        return instrumentNameFromSubId(subId);
      } catch {
        return `option subId=${subId}`;
      }
    }
    return `asset ${asset} subId=${subId}`;
  }

  private printBalances(balances: Record<string, SubaccountBalance[]>): void {
    for (const [acc, list] of Object.entries(balances)) {
      log(`subaccount ${acc}:`);
      if (list.length === 0) log("  (empty)");
      for (const b of list) {
        log(`  ${b.label.padEnd(28)} ${fromUnit(b.balance)}`);
      }
    }
  }
}

function log(msg: string): void {
  console.log(`[settlement] ${msg}`);
}
