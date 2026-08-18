import { describe, expect, it, vi } from "vitest";
import { SubaccountDirectoryWorker } from "../src/subaccount-directory-worker.js";

describe("SubaccountDirectoryWorker", () => {
  it("runs serially and schedules the next sync only after the current one settles", async () => {
    const callbacks: Array<() => void> = [];
    const setTimeout = vi.fn((callback: () => void) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const clearTimeout = vi.fn();
    const syncOnce = vi.fn().mockResolvedValue(undefined);
    const worker = new SubaccountDirectoryWorker(
      { syncOnce },
      15_000,
      vi.fn(),
      { setTimeout, clearTimeout },
    );

    worker.start();
    await vi.waitFor(() => expect(syncOnce).toHaveBeenCalledTimes(1));
    expect(setTimeout).toHaveBeenCalledWith(expect.any(Function), 15_000);

    callbacks.shift()?.();
    await vi.waitFor(() => expect(syncOnce).toHaveBeenCalledTimes(2));
    expect(callbacks).toHaveLength(1);

    worker.stop();
    expect(clearTimeout).toHaveBeenCalled();
  });

  it("reports an indexing failure and keeps retrying", async () => {
    const callbacks: Array<() => void> = [];
    const onError = vi.fn();
    const failure = new Error("rpc unavailable");
    const worker = new SubaccountDirectoryWorker(
      { syncOnce: vi.fn().mockRejectedValue(failure) },
      2_500,
      onError,
      {
        setTimeout: (callback) => {
          callbacks.push(callback);
          return callbacks.length;
        },
        clearTimeout: vi.fn(),
      },
    );

    worker.start();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(failure));
    expect(callbacks).toHaveLength(1);
    worker.stop();
  });
});
