/**
 * Process-local sorted account mutex shared by quote reservations and funds
 * operations. Sorting makes multi-account RFQ execution deadlock-safe.
 */
export class AccountLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(accountIds: bigint[], work: () => Promise<T>): Promise<T> {
    return this.runKeys(accountIds.map((id) => `account:${id}`), work);
  }

  /**
   * Serialize a non-account resource in the same lock graph. Auction methods
   * acquire `rfq:*` before account keys, so close/expiry cannot interleave
   * with quote admission or acceptance.
   */
  runResource<T>(resourceId: string, work: () => Promise<T>): Promise<T> {
    return this.runKeys([`resource:${resourceId}`], work);
  }

  private runKeys<T>(rawKeys: string[], work: () => Promise<T>): Promise<T> {
    const keys = [...new Set(rawKeys)].sort();
    let wrapped = work;
    for (const key of [...keys].reverse()) {
      const inner = wrapped;
      wrapped = () => this.runOne(key, inner);
    }
    return wrapped();
  }

  private async runOne<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(work);
    this.tails.set(key, run);
    try {
      return await run;
    } finally {
      if (this.tails.get(key) === run) this.tails.delete(key);
    }
  }
}
