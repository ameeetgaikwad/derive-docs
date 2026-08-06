/** A fair in-process mutex for transactions sent by the same account. */
export interface TransactionQueue {
  run<T>(operation: () => Promise<T>): Promise<T>;
}

/**
 * Serializes submission through receipt confirmation. Independent daemon loops
 * may fetch/source/sign concurrently, but two writes from the same account can
 * never race for the same nonce.
 */
export class SerialTransactionQueue implements TransactionQueue {
  private tail: Promise<void> = Promise.resolve();

  async run<T>(operation: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

export const immediateTransactionQueue: TransactionQueue = {
  run: (operation) => operation(),
};
