import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareWithdrawal, WithdrawalRequestError } from "./withdrawals";

const OWNER = "0x1111111111111111111111111111111111111111" as const;
const BLOCK_HASH = `0x${"2".repeat(64)}` as const;

describe("withdrawal wire client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps all native units as strings and sends the stable idempotency key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      withdrawal: { id: "w-1" },
      signing: { primaryType: "Action" },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    await prepareWithdrawal({
      owner: OWNER,
      subaccountId: 9_007_199_254_740_993n,
      assetId: "market:BTC",
      tokenUnits: 12_345_678_901_234_567_890n,
      previewBlockHash: BLOCK_HASH,
      idempotencyKey: "withdrawal-key-1",
    }, 97);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3030/withdrawals");
    expect(init.headers).toMatchObject({ "Idempotency-Key": "withdrawal-key-1" });
    expect(JSON.parse(String(init.body))).toEqual({
      owner: OWNER,
      subaccountId: "9007199254740993",
      assetId: "market:BTC",
      tokenUnits: "12345678901234567890",
      previewBlockHash: BLOCK_HASH,
    });
  });

  it("preserves structured service errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: "PREVIEW_STALE", message: "Preview changed", retryable: true, details: { field: "blockHash" } },
    }), { status: 409 })));

    const error = await prepareWithdrawal({
      owner: OWNER,
      subaccountId: 7n,
      assetId: "cash",
      tokenUnits: 1n,
      previewBlockHash: BLOCK_HASH,
      idempotencyKey: "key",
    }, 97).catch((value) => value);
    expect(error).toBeInstanceOf(WithdrawalRequestError);
    expect(error).toMatchObject({
      status: 409,
      body: { code: "PREVIEW_STALE", retryable: true, details: { field: "blockHash" } },
    });
  });
});
