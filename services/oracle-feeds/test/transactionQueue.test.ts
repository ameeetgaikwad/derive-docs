import { describe, expect, it } from "vitest";

import { SerialTransactionQueue } from "../src/transactionQueue.js";

describe("serial transaction queue", () => {
  it("keeps same-account writes FIFO and never overlaps them", async () => {
    const queue = new SerialTransactionQueue();
    const order: string[] = [];
    let active = 0;
    let maximumActive = 0;

    const operation = (name: string, delay: number) =>
      queue.run(async () => {
        order.push(`${name}:start`);
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, delay));
        active -= 1;
        order.push(`${name}:end`);
      });

    await Promise.all([operation("feed", 10), operation("pyth", 1), operation("stable", 1)]);
    expect(maximumActive).toBe(1);
    expect(order).toEqual([
      "feed:start",
      "feed:end",
      "pyth:start",
      "pyth:end",
      "stable:start",
      "stable:end",
    ]);
  });

  it("releases the next write after a failed operation", async () => {
    const queue = new SerialTransactionQueue();
    const failed = queue.run(async () => {
      throw new Error("reverted");
    });
    const succeeded = queue.run(async () => "mined");
    await expect(failed).rejects.toThrow("reverted");
    await expect(succeeded).resolves.toBe("mined");
  });
});
