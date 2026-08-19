import { EventEmitter } from "node:events";
import type { Address, Hex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuctionEngine } from "../src/auction.js";
import { RfqEngineServer } from "../src/server.js";
import type { WithdrawalEngine } from "../src/withdrawal.js";

const OWNER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as Address;
const BLOCK_HASH = (`0x${"11".repeat(32)}`) as Hex;
const SIGNATURE = (`0x${"22".repeat(65)}`) as Hex;
const WITHDRAWAL_ID = "11111111-1111-4111-8111-111111111111";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function fakeWithdrawals() {
  return {
    preview: vi.fn(async (request: unknown) => ({ marker: "preview", request })),
    prepare: vi.fn(async () => ({
      replayed: false,
      response: {
        withdrawalId: WITHDRAWAL_ID,
        action: {},
        typedData: {},
        review: {},
      },
    })),
    submit: vi.fn(async () => ({
      withdrawal: { id: WITHDRAWAL_ID, status: "submitting" },
    })),
    get: vi.fn(async () => ({
      withdrawal: { id: WITHDRAWAL_ID, status: "unknown" },
    })),
  };
}

async function makeServer(options?: {
  withdrawalsEnabled?: boolean;
  previewLimit?: number;
  executionLimit?: number;
}) {
  const withdrawals = fakeWithdrawals();
  const events = new EventEmitter();
  Object.assign(events, { stop: vi.fn() });
  const server = new RfqEngineServer({
    engine: events as unknown as AuctionEngine,
    chainId: 31337,
    port: 0,
    heartbeatMs: 0,
    withdrawals: withdrawals as unknown as WithdrawalEngine,
    withdrawalsEnabled: options?.withdrawalsEnabled ?? true,
    withdrawalPreviewRateLimitPerMin: options?.previewLimit ?? 100,
    withdrawalExecutionRateLimitPerMin: options?.executionLimit ?? 100,
  });
  const { port } = await server.start();
  cleanups.push(() => server.stop());
  return { withdrawals, base: `http://127.0.0.1:${port}` };
}

function post(base: string, path: string, body: unknown, headers?: Record<string, string>) {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const validPreview = {
  owner: OWNER,
  subaccountId: "11",
  assetId: "market:BTC",
};

const validPrepare = {
  ...validPreview,
  tokenUnits: "100000000",
  previewBlockHash: BLOCK_HASH,
};

describe("withdrawal HTTP schemas", () => {
  it("accepts only the exact preview schema and canonical decimal strings", async () => {
    const { base, withdrawals } = await makeServer();
    const valid = await post(base, "/withdrawals/preview", validPreview);
    expect(valid.status).toBe(200);
    expect(withdrawals.preview).toHaveBeenCalledWith(validPreview);

    for (const body of [
      { ...validPreview, subaccountId: "011" },
      { ...validPreview, subaccountId: 11 },
      { ...validPreview, surprise: true },
      { owner: OWNER, subaccountId: "11" },
      { ...validPreview, assetId: "BTC" },
      { ...validPreview, owner: "not-an-address" },
    ]) {
      const response = await post(base, "/withdrawals/preview", body);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({ error: { code: expect.any(String) } });
    }
    expect(withdrawals.preview).toHaveBeenCalledTimes(1);
  });

  it("requires the exact prepare and submit schemas and forwards Idempotency-Key", async () => {
    const { base, withdrawals } = await makeServer();
    const prepared = await post(base, "/withdrawals", validPrepare, {
      "idempotency-key": "owner-withdrawal-0001",
    });
    expect(prepared.status).toBe(201);
    expect(withdrawals.prepare).toHaveBeenCalledWith(validPrepare, "owner-withdrawal-0001");

    const nonCanonical = await post(
      base,
      "/withdrawals",
      { ...validPrepare, tokenUnits: "0100000000" },
      { "idempotency-key": "owner-withdrawal-0002" },
    );
    expect(nonCanonical.status).toBe(400);

    const clientAction = await post(
      base,
      `/withdrawals/${WITHDRAWAL_ID}/submit`,
      { signature: SIGNATURE, action: { owner: OWNER } },
    );
    expect(clientAction.status).toBe(400);
    expect(withdrawals.submit).not.toHaveBeenCalled();

    const submitted = await post(base, `/withdrawals/${WITHDRAWAL_ID}/submit`, {
      signature: SIGNATURE,
    });
    expect(submitted.status).toBe(202);
    expect(withdrawals.submit).toHaveBeenCalledWith(WITHDRAWAL_ID, { signature: SIGNATURE });
  });

  it("advertises Idempotency-Key through CORS preflight", async () => {
    const { base } = await makeServer();
    const response = await fetch(`${base}/withdrawals`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
    expect(response.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "idempotency-key",
    );
  });
});

describe("withdrawal kill switch and rate limits", () => {
  it("blocks every new mutation while keeping status lookups available", async () => {
    const { base, withdrawals } = await makeServer({ withdrawalsEnabled: false });
    const preview = await post(base, "/withdrawals/preview", validPreview);
    const prepared = await post(base, "/withdrawals", validPrepare, {
      "idempotency-key": "owner-withdrawal-0001",
    });
    const submitted = await post(base, `/withdrawals/${WITHDRAWAL_ID}/submit`, {
      signature: SIGNATURE,
    });
    for (const response of [preview, prepared, submitted]) {
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "WITHDRAWALS_DISABLED" },
      });
    }

    const status = await fetch(`${base}/withdrawals/${WITHDRAWAL_ID}`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({
      withdrawal: { id: WITHDRAWAL_ID, status: "unknown" },
    });
    expect(withdrawals.get).toHaveBeenCalledWith(WITHDRAWAL_ID);
  });

  it("uses dedicated preview and execution budgets without rate-limiting status", async () => {
    const { base, withdrawals } = await makeServer({ previewLimit: 1, executionLimit: 1 });
    expect((await post(base, "/withdrawals/preview", validPreview)).status).toBe(200);
    const previewLimited = await post(base, "/withdrawals/preview", validPreview);
    expect(previewLimited.status).toBe(429);

    expect(
      (
        await post(base, "/withdrawals", validPrepare, {
          "idempotency-key": "owner-withdrawal-0001",
        })
      ).status,
    ).toBe(201);
    const executionLimited = await post(base, "/withdrawals", validPrepare, {
      "idempotency-key": "owner-withdrawal-0002",
    });
    expect(executionLimited.status).toBe(429);

    const status = await fetch(`${base}/withdrawals/${WITHDRAWAL_ID}`);
    expect(status.status).toBe(200);
    expect(withdrawals.get).toHaveBeenCalledTimes(1);
  });
});
