import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { encodeErrorResult, type Address, type Hex, type PublicClient, type WalletClient } from "viem";

import { lyraSpotFeedAbi, toUnit } from "@hedge/shared";
import { FeedPoster, SETTLEMENT_TWAP_DURATION } from "../src/poster.js";

const signer = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const addresses = {
  spotFeed: "0x1111111111111111111111111111111111111111" as Address,
  forwardFeed: "0x2222222222222222222222222222222222222222" as Address,
  volFeed: "0x3333333333333333333333333333333333333333" as Address,
  rateFeed: "0x4444444444444444444444444444444444444444" as Address,
  stableFeed: "0x5555555555555555555555555555555555555555" as Address,
};
const TX_HASH = `0x${"ab".repeat(32)}` as Hex;

describe("atomic signed snapshot", () => {
  it("publishes spot plus forward/rate/vol as one Multicall3 transaction", async () => {
    const now = 1_786_000_000n;
    let submitted: Record<string, unknown> | undefined;
    const publicClient = {
      getBlock: async () => ({ timestamp: now }),
      waitForTransactionReceipt: async () => ({ status: "success", blockNumber: 1n }),
    } as unknown as PublicClient;
    const walletClient = {
      account: signer,
      chain: null,
      writeContract: async (request: Record<string, unknown>) => {
        submitted = request;
        return TX_HASH;
      },
    } as unknown as WalletClient;
    const poster = new FeedPoster(publicClient, walletClient, signer, 97, addresses);

    await expect(
      poster.postSnapshotBatched({
        spot: toUnit("65000"),
        timestamp: now,
        expiries: [{ expiry: now + 7n * 86_400n, forwardPrice: toUnit("65100") }],
      }),
    ).resolves.toBe(TX_HASH);

    expect(submitted?.address).toBe("0xcA11bde05977b3631167028862bE2a173976CA11");
    const calls = (submitted?.args as [{ target: Address }[]])[0];
    expect(calls).toHaveLength(4);
    expect(calls.map((call) => call.target)).toEqual([
      addresses.spotFeed,
      addresses.forwardFeed,
      addresses.rateFeed,
      addresses.volFeed,
    ]);
  });

  it("fails closed when a near-expiry forward has no rolling TWAP aggregates", async () => {
    const now = 1_786_000_000n;
    const publicClient = {
      getBlock: async () => ({ timestamp: now }),
    } as unknown as PublicClient;
    const walletClient = { account: signer, chain: null } as unknown as WalletClient;
    const poster = new FeedPoster(publicClient, walletClient, signer, 97, addresses);
    await expect(
      poster.postSnapshotBatched({
        spot: toUnit("65000"),
        expiries: [{ expiry: now + SETTLEMENT_TWAP_DURATION - 1n }],
      }),
    ).rejects.toThrow(/requires rolling settlement aggregates/);
  });

  it("identifies the feed error hidden by a failed Multicall3 aggregate", async () => {
    const now = 1_786_000_000n;
    const revertData = encodeErrorResult({
      abi: lyraSpotFeedAbi,
      errorName: "BLF_InvalidTimestamp",
    });
    const publicClient = {
      getBlock: async () => ({ timestamp: now }),
      simulateContract: async () => ({
        result: [
          { success: false, returnData: revertData },
          { success: true, returnData: "0x" },
          { success: true, returnData: "0x" },
          { success: true, returnData: "0x" },
        ],
      }),
    } as unknown as PublicClient;
    const walletClient = {
      account: signer,
      chain: null,
      writeContract: async () => {
        throw new Error("Multicall3: call failed");
      },
    } as unknown as WalletClient;
    const poster = new FeedPoster(publicClient, walletClient, signer, 97, addresses);

    await expect(
      poster.postSnapshotBatched({
        spot: toUnit("65000"),
        timestamp: now,
        expiries: [{ expiry: now + 7n * 86_400n, forwardPrice: toUnit("65100") }],
      }),
    ).rejects.toThrow(
      `spot target=${addresses.spotFeed}: BLF_InvalidTimestamp`,
    );
  });
});
