import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, readSubaccountDirectoryConfig } from "../src/config.js";

const originalChainId = process.env.CHAIN_ID;
afterEach(() => {
  if (originalChainId === undefined) delete process.env.CHAIN_ID;
  else process.env.CHAIN_ID = originalChainId;
});

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

describe("withdrawal config", () => {
  it("defaults fail-closed with dedicated preview and execution limits", () => {
    process.env.CHAIN_ID = "31337";
    const config = loadConfig({});
    expect(config.withdrawalsEnabled).toBe(false);
    expect(config.fundsStorePath).toBeNull();
    expect(config.withdrawalPreviewRateLimitPerMin).toBe(6);
    expect(config.withdrawalExecutionRateLimitPerMin).toBe(12);
  });

  it("requires a durable funds store when enabled off Anvil", () => {
    process.env.CHAIN_ID = "97";
    const executorKey =
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
    expect(() =>
      loadConfig({ WITHDRAWALS_ENABLED: "true", EXECUTOR_PRIVATE_KEY: executorKey }),
    ).toThrow("FUNDS_STORE_PATH");

    const configured = loadConfig({
      WITHDRAWALS_ENABLED: "true",
      FUNDS_STORE_PATH: "/var/lib/hedge/funds.jsonl",
      WITHDRAWAL_PREVIEW_RATE_LIMIT_PER_MIN: "9",
      WITHDRAWAL_EXECUTION_RATE_LIMIT_PER_MIN: "4",
      EXECUTOR_PRIVATE_KEY: executorKey,
    });
    expect(configured).toMatchObject({
      withdrawalsEnabled: true,
      fundsStorePath: "/var/lib/hedge/funds.jsonl",
      withdrawalPreviewRateLimitPerMin: 9,
      withdrawalExecutionRateLimitPerMin: 4,
    });
  });

  it("rejects invalid dedicated withdrawal limits", () => {
    process.env.CHAIN_ID = "31337";
    expect(() => loadConfig({ WITHDRAWAL_PREVIEW_RATE_LIMIT_PER_MIN: "-1" })).toThrow(
      "WITHDRAWAL_PREVIEW_RATE_LIMIT_PER_MIN",
    );
    expect(() => loadConfig({ WITHDRAWAL_EXECUTION_RATE_LIMIT_PER_MIN: "1.5" })).toThrow(
      "WITHDRAWAL_EXECUTION_RATE_LIMIT_PER_MIN",
    );
  });
});
