import type { Quote, Rfq } from "./types.js";

/**
 * Storage boundary. v1 ships the in-memory implementation; everything above
 * this interface (auction engine, server, executor) is storage-agnostic so a
 * Redis/Postgres store can be dropped in later.
 */
export interface RfqStore {
  putRfq(rfq: Rfq): Promise<void>;
  getRfq(id: string): Promise<Rfq | null>;
  listOpenRfqs(): Promise<Rfq[]>;
  putQuote(quote: Quote): Promise<void>;
  getQuote(id: string): Promise<Quote | null>;
  listQuotes(rfqId: string): Promise<Quote[]>;
}

export class InMemoryRfqStore implements RfqStore {
  private readonly rfqs = new Map<string, Rfq>();
  private readonly quotes = new Map<string, Quote>();
  private readonly quotesByRfq = new Map<string, string[]>();

  async putRfq(rfq: Rfq): Promise<void> {
    this.rfqs.set(rfq.id, rfq);
  }

  async getRfq(id: string): Promise<Rfq | null> {
    return this.rfqs.get(id) ?? null;
  }

  async listOpenRfqs(): Promise<Rfq[]> {
    return [...this.rfqs.values()].filter((r) => r.status === "open");
  }

  async putQuote(quote: Quote): Promise<void> {
    if (!this.quotes.has(quote.id)) {
      const ids = this.quotesByRfq.get(quote.rfqId) ?? [];
      ids.push(quote.id);
      this.quotesByRfq.set(quote.rfqId, ids);
    }
    this.quotes.set(quote.id, quote);
  }

  async getQuote(id: string): Promise<Quote | null> {
    return this.quotes.get(id) ?? null;
  }

  async listQuotes(rfqId: string): Promise<Quote[]> {
    const ids = this.quotesByRfq.get(rfqId) ?? [];
    return ids
      .map((id) => this.quotes.get(id))
      .filter((q): q is Quote => q !== undefined);
  }
}
