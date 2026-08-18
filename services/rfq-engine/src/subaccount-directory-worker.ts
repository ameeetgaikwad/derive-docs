interface DirectorySyncer {
  syncOnce(): Promise<unknown>;
}

interface DirectoryWorkerTimers {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

const defaultTimers: DirectoryWorkerTimers = {
  setTimeout(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return timer;
  },
  clearTimeout(timer) {
    clearTimeout(timer as NodeJS.Timeout);
  },
};

/** Poll an indexer without overlapping RPC/DynamoDB sync passes. */
export class SubaccountDirectoryWorker {
  private stopped = true;
  private timer: unknown | null = null;

  constructor(
    private readonly syncer: DirectorySyncer,
    private readonly pollMs: number,
    private readonly onError: (error: unknown) => void,
    private readonly timers: DirectoryWorkerTimers = defaultTimers,
  ) {
    if (!Number.isSafeInteger(pollMs) || pollMs < 1_000) {
      throw new Error("subaccount directory pollMs must be an integer of at least 1000");
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.run();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private async run(): Promise<void> {
    if (this.stopped) return;
    try {
      await this.syncer.syncOnce();
    } catch (error) {
      this.onError(error);
    }
    if (this.stopped) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      void this.run();
    }, this.pollMs);
  }
}
