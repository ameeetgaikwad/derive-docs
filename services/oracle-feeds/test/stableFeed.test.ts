import type { PublicClient, WalletClient } from "viem";
import { decodeAbiParameters, recoverAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { hashFeedData, toUnit } from "@hedge/shared";
import { FeedPoster, type FeedAddresses } from "../src/poster.js";
import { stablePriceConfigFromEnv } from "../src/priceSource.js";

const CHAIN_ID = 97;
const NOW = 1_786_018_000n;
const TX_HASH = `0x${"ab".repeat(32)}` as const;
const signer = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);

const addresses: FeedAddresses = {
  spotFeed: "0x1111111111111111111111111111111111111111",
  forwardFeed: "0x2222222222222222222222222222222222222222",
  volFeed: "0x3333333333333333333333333333333333333333",
  rateFeed: "0x4444444444444444444444444444444444444444",
  stableFeed: "0x5555555555555555555555555555555555555555",
};

describe("stable price configuration", () => {
  const client = {} as PublicClient;

  it("loads an explicit static testnet price and interval", async () => {
    const config = stablePriceConfigFromEnv(client, CHAIN_ID, {
      STABLE_PRICE_SOURCE: "static",
      STABLE_PRICE: "1",
      STABLE_FEED_INTERVAL_SEC: "300",
    });

    expect(config.intervalSec).toBe(300);
    expect(config.priceSource.name).toBe("static");
    await expect(config.priceSource.getSpotPrice()).resolves.toBe(toUnit("1"));
  });

  it("provides safe static defaults only on local anvil", async () => {
    const config = stablePriceConfigFromEnv(client, 31337, {});
    expect(config.intervalSec).toBe(300);
    await expect(config.priceSource.getSpotPrice()).resolves.toBe(toUnit("1"));
  });

  it("requires explicit configuration on testnet and rejects static mainnet pricing", () => {
    expect(() => stablePriceConfigFromEnv(client, CHAIN_ID, {})).toThrow(
      /STABLE_PRICE_SOURCE is required/,
    );
    expect(() =>
      stablePriceConfigFromEnv(client, 56, {
        STABLE_PRICE_SOURCE: "static",
        STABLE_PRICE: "1",
      }),
    ).toThrow(/forbidden on BSC mainnet/);
  });

  it("rejects intervals that can cross the deployed stable-feed heartbeat", () => {
    expect(() =>
      stablePriceConfigFromEnv(client, CHAIN_ID, {
        STABLE_PRICE_SOURCE: "static",
        STABLE_PRICE: "1",
        STABLE_FEED_INTERVAL_SEC: "3600",
      }),
    ).toThrow(/must be below the 3600s stable-feed heartbeat/);
  });
});

describe("stable feed posting", () => {
  it("signs for and writes to stableFeed rather than btcSpotFeed", async () => {
    const writeContract = vi.fn().mockResolvedValue(TX_HASH);
    const publicClient = {
      getBlock: vi.fn().mockResolvedValue({ timestamp: NOW }),
      waitForTransactionReceipt: vi.fn().mockResolvedValue({ status: "success" }),
    } as unknown as PublicClient;
    const walletClient = {
      account: signer,
      writeContract,
    } as unknown as WalletClient;
    const poster = new FeedPoster(
      publicClient,
      walletClient,
      signer,
      CHAIN_ID,
      addresses,
      3600n,
    );

    await expect(poster.postStable(toUnit("1"))).resolves.toBe(TX_HASH);

    expect(writeContract).toHaveBeenCalledOnce();
    const request = writeContract.mock.calls[0]![0];
    expect(request.address).toBe(addresses.stableFeed);
    expect(request.functionName).toBe("acceptData");

    const [feedData] = decodeAbiParameters(
      [
        {
          type: "tuple",
          components: [
            { name: "data", type: "bytes" },
            { name: "deadline", type: "uint256" },
            { name: "timestamp", type: "uint64" },
            { name: "signers", type: "address[]" },
            { name: "signatures", type: "bytes[]" },
          ],
        },
      ],
      request.args[0],
    );
    const [price, confidence] = decodeAbiParameters(
      [{ type: "uint96" }, { type: "uint64" }],
      feedData.data,
    );
    expect(price).toBe(toUnit("1"));
    expect(confidence).toBe(toUnit("1"));
    expect(feedData.timestamp).toBe(NOW);
    expect(feedData.deadline).toBe(NOW + 3600n);

    const digest = hashFeedData(
      "spot",
      {
        data: feedData.data,
        deadline: feedData.deadline,
        timestamp: feedData.timestamp,
      },
      CHAIN_ID,
      addresses.stableFeed,
    );
    await expect(
      recoverAddress({ hash: digest, signature: feedData.signatures[0]! }),
    ).resolves.toBe(signer.address);
  });
});
