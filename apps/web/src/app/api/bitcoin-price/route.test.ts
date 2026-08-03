import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

afterEach(() => {
  vi.unstubAllGlobals();
});

function request(query = "history=30d") {
  return new Request(`http://localhost/api/bitcoin-price?${query}`);
}

describe("GET /api/bitcoin-price", () => {
  it("rejects unsupported history ranges without calling a provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request("history=7d"));

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls through Binance symbols to Coinbase", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            [1_700_086_400, 0, 0, 0, 43_000, 1],
            [1_700_000_000, 0, 0, 0, 42_000, 1],
          ]),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());
    const payload = (await response.json()) as {
      success: boolean;
      provider: string;
      points: Array<{ time: number; value: number }>;
    };

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, provider: "coinbase" });
    expect(payload.points).toEqual([
      { time: 1_700_000_000, value: 42_000 },
      { time: 1_700_086_400, value: 43_000 },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("returns a retryable service error when every provider fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(request());
    const payload = (await response.json()) as {
      success: boolean;
      error: string;
    };

    expect(response.status).toBe(503);
    expect(payload).toEqual({
      success: false,
      error: "BTC price history is temporarily unavailable",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
