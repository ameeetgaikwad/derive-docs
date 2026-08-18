import { describe, expect, it } from "vitest";
import { readSubaccountDirectoryConfig } from "../src/config.js";

describe("readSubaccountDirectoryConfig", () => {
  it("stays disabled without a table and requires authoritative deployment metadata when enabled", () => {
    expect(readSubaccountDirectoryConfig({}, {}, 56)).toBeNull();

    expect(
      readSubaccountDirectoryConfig(
        { SUBACCOUNT_DIRECTORY_TABLE: "hedge-subaccounts" },
        { matchingDeploymentBlock: 115317084 },
        56,
      ),
    ).toEqual({
      tableName: "hedge-subaccounts",
      deploymentBlock: 115317084n,
      confirmationBlocks: 6n,
      chunkSize: 2_000n,
      pollMs: 15_000,
    });

    expect(() =>
      readSubaccountDirectoryConfig(
        { SUBACCOUNT_DIRECTORY_TABLE: "hedge-subaccounts" },
        {},
        56,
      ),
    ).toThrow("matchingDeploymentBlock");
  });

  it("validates explicit indexing overrides", () => {
    const deployments = { matchingDeploymentBlock: "123273721" };
    expect(
      readSubaccountDirectoryConfig(
        {
          SUBACCOUNT_DIRECTORY_TABLE: "hedge-testnet-subaccounts",
          SUBACCOUNT_DIRECTORY_DEPLOYMENT_BLOCK: "123273700",
          SUBACCOUNT_DIRECTORY_CONFIRMATIONS: "2",
          SUBACCOUNT_DIRECTORY_CHUNK_SIZE: "500",
          SUBACCOUNT_DIRECTORY_POLL_MS: "2500",
        },
        deployments,
        97,
      ),
    ).toEqual({
      tableName: "hedge-testnet-subaccounts",
      deploymentBlock: 123273700n,
      confirmationBlocks: 2n,
      chunkSize: 500n,
      pollMs: 2_500,
    });

    expect(() =>
      readSubaccountDirectoryConfig(
        {
          SUBACCOUNT_DIRECTORY_TABLE: "hedge-testnet-subaccounts",
          SUBACCOUNT_DIRECTORY_CONFIRMATIONS: "-1",
        },
        deployments,
        97,
      ),
    ).toThrow("SUBACCOUNT_DIRECTORY_CONFIRMATIONS");
  });
});
