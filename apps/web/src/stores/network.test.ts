import { describe, expect, it } from "vitest";
import {
  coerceEnabledAppChainId,
  DEFAULT_APP_CHAIN_ID,
  ENABLED_APP_CHAIN_IDS,
  isEnabledAppChainId,
} from "./network";

describe("frontend network availability", () => {
  it("exposes BSC testnet and the isolated mainnet staging deployment", () => {
    expect(ENABLED_APP_CHAIN_IDS).toEqual([97, 56]);
    expect(isEnabledAppChainId(97)).toBe(true);
    expect(isEnabledAppChainId(56)).toBe(true);
  });

  it("preserves numeric enabled selections and rejects invalid persisted values", () => {
    expect(coerceEnabledAppChainId(56)).toBe(56);
    expect(coerceEnabledAppChainId(97)).toBe(97);
    expect(coerceEnabledAppChainId("56")).toBe(DEFAULT_APP_CHAIN_ID);
    expect(coerceEnabledAppChainId(1)).toBe(DEFAULT_APP_CHAIN_ID);
  });
});
