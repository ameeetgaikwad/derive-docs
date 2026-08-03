import { afterEach, describe, expect, it, vi } from "vitest";
import { getRfq } from "../rfq-engine";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("RFQ engine network routing", () => {
  it("uses the explicitly captured chain for each request", async () => {
    vi.stubEnv("NEXT_PUBLIC_RFQ_ENGINE_URL_56", "https://main-rfq.example/");
    vi.stubEnv("NEXT_PUBLIC_RFQ_ENGINE_URL_97", "https://test-rfq.example/");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await getRfq("main-auction", 56);
    await getRfq("test-auction", 97);

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://main-rfq.example/rfq/main-auction",
      "https://test-rfq.example/rfq/test-auction",
    ]);
  });
});
