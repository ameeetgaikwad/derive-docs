import { describe, expect, it } from "vitest";

import {
  BSC_MAINNET_GAS_PRICE,
  BSC_TESTNET_GAS_PRICE,
  getChain,
  txOverrides,
} from "../src/clients.js";

describe("txOverrides (forced-legacy gas quirk)", () => {
  it("chain 97 (BSC testnet) forces legacy type at 0.2 gwei", () => {
    expect(txOverrides(97)).toEqual({ type: "legacy", gasPrice: 200_000_000n });
    expect(txOverrides(97).gasPrice).toBe(BSC_TESTNET_GAS_PRICE);
  });

  it("chain 56 (BSC mainnet) forces legacy type at 0.1 gwei (above the 0.05 gwei floor)", () => {
    expect(txOverrides(56)).toEqual({ type: "legacy", gasPrice: 100_000_000n });
    expect(txOverrides(56).gasPrice).toBe(BSC_MAINNET_GAS_PRICE);
  });

  it("anvil (31337) and unknown chains get no overrides", () => {
    expect(txOverrides(31337)).toEqual({});
    expect(txOverrides(1)).toEqual({});
  });
});

describe("getChain", () => {
  it("supports 31337, 97 and 56", () => {
    expect(getChain(31337).id).toBe(31337);
    expect(getChain(97).id).toBe(97);
    expect(getChain(56).id).toBe(56);
  });

  it("throws on unsupported chains", () => {
    expect(() => getChain(1)).toThrow(/Unsupported chainId/);
  });
});
