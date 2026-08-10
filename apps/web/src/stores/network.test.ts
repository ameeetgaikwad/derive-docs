import { describe, expect, it } from "vitest";
import {
  coerceEnabledAppChainId,
  DEFAULT_APP_CHAIN_ID,
  ENABLED_APP_CHAIN_IDS,
  isEnabledAppChainId,
} from "./network";

describe("frontend network availability", () => {
  it("exposes only BSC testnet", () => {
    expect(ENABLED_APP_CHAIN_IDS).toEqual([97]);
    expect(isEnabledAppChainId(97)).toBe(true);
    expect(isEnabledAppChainId(56)).toBe(false);
  });

  it("moves a persisted mainnet selection back to testnet", () => {
    expect(coerceEnabledAppChainId(56)).toBe(DEFAULT_APP_CHAIN_ID);
    expect(coerceEnabledAppChainId("56")).toBe(DEFAULT_APP_CHAIN_ID);
  });
});
