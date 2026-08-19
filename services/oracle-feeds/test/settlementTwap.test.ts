import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SettlementTwapTracker } from "../src/settlementTwap.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true })));
});

describe("settlement TWAP tracker", () => {
  it("interpolates the window boundary and resumes its integral after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oracle-twap-"));
    temporaryDirectories.push(directory);
    const statePath = join(directory, "twap.json");
    const expiry = 10_000n; // window starts at 8,200

    const first = new SettlementTwapTracker({ chainId: 97, statePath });
    expect(await first.observe(expiry, 8_000n, 100n)).toBeNull();
    const crossing = await first.observe(expiry, 8_300n, 120n);
    // Linear interpolation gives 113.333... at t=8200; integer math gives
    // 113, so trapezoid(113,120)*100 = 11,650.
    expect(crossing?.currentSpotAggregate - crossing!.settlementStartAggregate).toBe(11_650n);
    expect(crossing?.lateStart).toBe(false);

    const messages: string[] = [];
    const restarted = new SettlementTwapTracker({
      chainId: 97,
      statePath,
      log: (message) => messages.push(message),
    });
    const next = await restarted.observe(expiry, 8_400n, 100n);
    expect(next?.currentSpotAggregate - next!.settlementStartAggregate).toBe(22_650n);
    expect(messages).toContain(`settlement TWAP state loaded path=${statePath} series=1`);
  });

  it("marks a first observation inside the window as a reviewed late backfill", async () => {
    const directory = await mkdtemp(join(tmpdir(), "oracle-twap-late-"));
    temporaryDirectories.push(directory);
    const tracker = new SettlementTwapTracker({ chainId: 97, statePath: join(directory, "twap.json") });
    const result = await tracker.observe(10_000n, 8_500n, 100n);
    expect(result?.lateStart).toBe(true);
    expect(result?.currentSpotAggregate - result!.settlementStartAggregate).toBe(30_000n);

    const restarted = new SettlementTwapTracker({
      chainId: 97,
      statePath: join(directory, "twap.json"),
    });
    expect((await restarted.observe(10_000n, 8_600n, 100n))?.lateStart).toBe(true);
  });
});
