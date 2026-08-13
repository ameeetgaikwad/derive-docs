import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertRfqEngineChain,
  getRfq,
  rfqEngineUrl,
} from "../rfq-engine";

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

  it("requires an explicit chain-56 endpoint instead of using a legacy fallback", () => {
    vi.stubEnv("NEXT_PUBLIC_RFQ_ENGINE_URL_56", "");
    vi.stubEnv("NEXT_PUBLIC_RFQ_ENGINE_URL", "https://test-only.example");

    expect(() => rfqEngineUrl(56)).toThrow(/NEXT_PUBLIC_RFQ_ENGINE_URL_56/);
    expect(rfqEngineUrl(97)).toBe("https://test-only.example");
  });

  it("verifies that health reports the selected chain", async () => {
    vi.stubEnv("NEXT_PUBLIC_RFQ_ENGINE_URL_56", "https://main-rfq.example");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, service: "rfq-engine", chainId: 56 }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(assertRfqEngineChain(56)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://main-rfq.example/health",
      expect.objectContaining({ headers: expect.any(Object) }),
    );
  });

  it("rejects an RFQ endpoint configured for a different chain", async () => {
    vi.stubEnv("NEXT_PUBLIC_RFQ_ENGINE_URL_56", "https://wrong-rfq.example");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ ok: true, service: "rfq-engine", chainId: 97 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(assertRfqEngineChain(56)).rejects.toThrow(
      /reports chain 97; expected chain 56.*Refusing to move collateral/,
    );
  });
});
