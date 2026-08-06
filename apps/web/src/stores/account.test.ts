import { describe, expect, it } from "vitest";
import { resolveStoredSubaccount } from "./account";

const address = "0xABCDEF";

describe("subaccount storage migration", () => {
  it("probes an unscoped legacy id on either network", () => {
    const records = { [address.toLowerCase()]: "42" };

    expect(resolveStoredSubaccount(records, address, 56)).toEqual({
      id: 42n,
      source: "legacy",
    });
    expect(resolveStoredSubaccount(records, address, 97)).toEqual({
      id: 42n,
      source: "legacy",
    });
  });

  it("prefers the id verified and stored for the active chain", () => {
    const records = {
      [address.toLowerCase()]: "42",
      [`56:${address.toLowerCase()}`]: "56",
      [`97:${address.toLowerCase()}`]: "97",
    };

    expect(resolveStoredSubaccount(records, address, 56)).toEqual({
      id: 56n,
      source: "network",
    });
    expect(resolveStoredSubaccount(records, address, 97)).toEqual({
      id: 97n,
      source: "network",
    });
  });
});
