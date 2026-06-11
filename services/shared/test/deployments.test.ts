import { describe, expect, it } from "vitest";
import { getDeployedAddress, readDeployments } from "../src/deployments.js";

describe("deployments loader", () => {
  it("returns null when no deployments file exists for a chain", () => {
    expect(readDeployments(999999)).toBeNull();
  });

  it("extracts addresses from flat and nested shapes", () => {
    const addr = "0x00000000000000000000000000000000000000aa";
    expect(getDeployedAddress({ matching: addr }, "matching")).toBe(addr);
    expect(getDeployedAddress({ core: { subAccounts: addr } }, "subAccounts")).toBe(addr);
    expect(() => getDeployedAddress({ core: {} }, "missing")).toThrow("not found");
  });
});
