import type { Address, PublicClient, WalletClient } from "viem";
import type { LocalAccount } from "viem";
import {
  fromUnit,
  getDeployedAddress,
  instrumentNameFromSubId,
  requireDeployments,
  standardManagerAbi,
  subAccountsAbi,
} from "@hedge/shared";
import { anchoredFeedFromDeployments, ensureAnchoredSettlementPrice } from "./anchored.js";
import type { FeedPoster } from "./poster.js";
import {
  immediateTransactionQueue,
  type TransactionQueue,
} from "./transactionQueue.js";

export interface SettlementAddresses {
  standardManager: Address;
  optionAsset: Address;
  subAccounts: Address;
  cashAsset: Address;
  baseAsset: Address;
  /** AnchoredSettlementFeed (btcSettlementFeed) — absent on signed-feed-only deployments */
  anchoredSettlementFeed?: Address;
}

export function settlementAddressesFromDeployments(chainId: number): SettlementAddresses {
  const d = requireDeployments(chainId);
  return {
    standardManager: getDeployedAddress(d, "standardManager"),
    optionAsset: getDeployedAddress(d, "btcOptionAsset"),
    subAccounts: getDeployedAddress(d, "subAccounts"),
    cashAsset: getDeployedAddress(d, "cashAsset"),
    baseAsset: getDeployedAddress(d, "btcBaseAsset"),
    anchoredSettlementFeed: anchoredFeedFromDeployments(d),
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
 * Settlement runner. Two ways to fix the settlement price:
 *
 * ANCHORED (default whenever the deployment has an AnchoredSettlementFeed):
 *   1. (at/after expiry) call the PERMISSIONLESS
 *      AnchoredSettlementFeed.fixSettlementPrice(expiry) — the price comes from Chainlink
 *      round history (cross-checked against Pyth near expiry), NOT from our signed feeds,
 *   2. StandardManager.settleOptions per account, 3. read back balances.
 *
 * SIGNED (explicit `signed: true` fallback; sequence verified against the vendored
 * integration test v2-core/test/integration-tests/standard-manager/settle-option.sol):
 *   1. (at/after expiry) post fresh spot,
 *   2. post forward-feed settlement data (timestamp == expiry, TWAP aggregates),
 *   3. StandardManager.settleOptions(optionAsset, subaccount) per account
 *      (public function, callable by anyone),
 *   4. read back balances.
 *   Only used when the OptionAsset still settles against the LyraForwardFeed
 *   (e.g. plain-anvil deployments without Chainlink/Pyth).
 */
export class SettlementRunner {
  constructor(
    private readonly publicClient: PublicClient,
    private readonly walletClient: WalletClient,
    private readonly account: LocalAccount,
    private readonly poster: FeedPoster,
    private readonly addresses: SettlementAddresses,
    private readonly transactionQueue: TransactionQueue = immediateTransactionQueue,
  ) {}

  async run(params: {
    expiry: bigint;
    /** 18dp settlement price — REQUIRED for the signed path, optional sanity log otherwise */
    price?: bigint;
    subaccounts: bigint[];
    /** force the legacy signed-feed path (LyraForwardFeed TWAP aggregates) */
    signed?: boolean;
    /** signed path only: skip posting feed data (already fixed on-chain) */
    skipFeed?: boolean;
  }): Promise<SettlementReport> {
    const { expiry, subaccounts } = params;

    const now = await this.poster.chainNow();
    if (now < expiry) {
      throw new Error(`Cannot settle: chain time ${now} < expiry ${expiry}`);
    }

    const anchored = this.addresses.anchoredSettlementFeed;
    let fixed: { settled: boolean; price: bigint };

    if (!params.signed && anchored) {
      const result = await ensureAnchoredSettlementPrice({
        publicClient: this.publicClient,
        walletClient: this.walletClient,
        account: this.account,
        feed: anchored,
        expiry,
        transactionQueue: this.transactionQueue,
      });
      log(
        result.txHash
          ? `anchored settlement price fixed at ${fromUnit(result.price)}  tx=${result.txHash}`
          : `anchored settlement price already fixed at ${fromUnit(result.price)}`,
      );
      if (params.price !== undefined && params.price !== result.price) {
        log(
          `note: --price ${fromUnit(params.price)} differs from the oracle anchor ` +
            `${fromUnit(result.price)} — the anchor is authoritative`,
        );
      }
      fixed = { settled: true, price: result.price };
    } else {
      if (!params.signed && !anchored) {
        log("no anchored settlement feed in deployments — falling back to the signed path");
      }
      const price = params.price;
      if (price === undefined) {
        throw new Error("signed settlement path requires an explicit price");
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

      fixed = await this.poster.readSettlementPrice(expiry);
      if (!fixed.settled) {
        throw new Error(`Forward feed did not register settlement data for expiry ${expiry}`);
      }
    }

    log(`getSettlementPrice(${expiry}) = ${fromUnit(fixed.price)} (settled)`);

    for (const acc of subaccounts) {
      const hash = await this.transactionQueue.run(async () => {
        const transactionHash = await this.walletClient.writeContract({
          address: this.addresses.standardManager,
          abi: standardManagerAbi,
          functionName: "settleOptions",
          args: [this.addresses.optionAsset, acc],
          account: this.account,
          chain: this.walletClient.chain ?? null,
        });
        const receipt = await this.publicClient.waitForTransactionReceipt({ hash: transactionHash });
        if (receipt.status !== "success") {
          throw new Error(`settleOptions(${acc}) reverted (tx ${transactionHash})`);
        }
        return transactionHash;
      });
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
