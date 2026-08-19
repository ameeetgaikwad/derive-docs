import { setTimeout as delay } from "node:timers/promises";
import { verifyTypedData, zeroAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import { decodeWithdrawData, getActionTypedData, signAction, type Action } from "@hedge/shared";
import {
  ExecutorBroadcastUnknownError,
  ExecutorSimulationError,
  UNKNOWN_BROADCAST_OPERATION,
  type SubmitResult,
} from "../src/chain.js";
import { WithdrawalEngine } from "../src/withdrawal.js";
import type {
  WithdrawalGateway,
  WithdrawalNonceUse,
  WithdrawalPinnedBlock,
  WithdrawalReceipt,
  WithdrawalSnapshot,
} from "../src/withdrawal-gateway.js";
import { InMemoryWithdrawalOperationStore } from "../src/withdrawal-store.js";
import {
  WithdrawalApiError,
  type WithdrawalAssetDefinition,
  type WithdrawalBlocker,
  type WithdrawalOperation,
} from "../src/withdrawal-types.js";
import { parseAction } from "../src/types.js";

const ONE = 10n ** 18n;
const CHAIN_ID = 31337;
const MATCHING = "0x2E2Ed0Cfd3AD2f1d34481277b3204d807Ca2F8c2" as Address;
const WITHDRAWAL_MODULE = "0x8198f5d8F8CfFE8f9C413d98a0A55aEB8ab9FbB7" as Address;
const STANDARD_MANAGER = "0x1291Be112d480055DaFd8a610b7d1e203891C274" as Address;
const CASH_ASSET = "0x9E545E3C0baAB3E08CdfD552C960A1050f373042" as Address;
const CASH_TOKEN = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const BTC_ASSET = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const BTC_TOKEN = "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0" as Address;
const TX_HASH = (`0x${"ab".repeat(32)}`) as Hex;
const RECEIPT_BLOCK_HASH = hash("2");

const owner = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const other = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);

function hash(byte: string): Hex {
  return (`0x${byte.repeat(64)}`) as Hex;
}

const BLOCK: WithdrawalPinnedBlock = { number: 100n, hash: hash("1"), timestamp: 1_000n };

const cashAsset: WithdrawalAssetDefinition = {
  assetId: "cash",
  kind: "cash",
  marketId: null,
  symbol: "USDT",
  assetAddress: CASH_ASSET,
  configuredTokenAddress: CASH_TOKEN,
  configuredTokenDecimals: 6,
  scaledUi: false,
};

const btcAsset: WithdrawalAssetDefinition = {
  assetId: "market:BTC",
  kind: "market-collateral",
  marketId: "BTC",
  symbol: "BTCB",
  assetAddress: BTC_ASSET,
  configuredTokenAddress: BTC_TOKEN,
  configuredTokenDecimals: 8,
  scaledUi: false,
};

function baseSnapshot(): WithdrawalSnapshot {
  return {
    matchingOwner: owner.address,
    accountHolder: MATCHING,
    manager: STANDARD_MANAGER,
    withdrawTimestamp: 0n,
    internalBalance: 100n * ONE,
    cashWithInterest: 100n * ONE,
    cashTokenDecimals: 6,
    cashExchangeRate: ONE,
    cashWithdrawFeeEnabled: false,
    initialMargin: 20n * ONE,
    initialMarkToMarket: 25n * ONE,
    maintenanceMargin: 10n * ONE,
    maintenanceMarkToMarket: 25n * ONE,
    tokenAddress: BTC_TOKEN,
    tokenSymbol: "BTCB",
    tokenDecimals: 8,
    tokenLiquidity: 10n ** 36n,
    multiplier: ONE,
  };
}

class FakeWithdrawalGateway implements WithdrawalGateway {
  latest = BLOCK;
  readonly blocksByNumber = new Map<bigint, WithdrawalPinnedBlock>([[BLOCK.number, BLOCK]]);
  readonly blocksByHash = new Map<Hex, WithdrawalPinnedBlock>([[BLOCK.hash, BLOCK]]);
  snapshotValue = baseSnapshot();
  simulationLimit = 10n ** 60n;
  simulationCalls: bigint[] = [];
  simulationBlocker: WithdrawalBlocker = {
    code: "INSUFFICIENT_MARGIN",
    message: "insufficient margin",
  };
  nonceUsed = false;
  nonceUse: WithdrawalNonceUse | null = null;
  receiptValue: WithdrawalReceipt | null = null;
  submitResult: SubmitResult = { txHash: TX_HASH, status: "success", blockNumber: 101n };
  submitError: Error | null = null;
  submitErrorAfterHash: Error | null = null;
  submitCompletion: Promise<void> | null = null;
  paused: string[] = [];
  cleared: string[] = [];
  activePauses = new Set<string>();
  adopted: Hex[] = [];
  submittedActions: Action[] = [];

  async validateConfiguration(): Promise<void> {}
  async latestBlock(): Promise<WithdrawalPinnedBlock> {
    return this.latest;
  }
  async blockByHash(blockHash: Hex): Promise<WithdrawalPinnedBlock | null> {
    return this.blocksByHash.get(blockHash) ?? null;
  }
  async blockByNumber(number: bigint): Promise<WithdrawalPinnedBlock | null> {
    return this.blocksByNumber.get(number) ?? null;
  }
  async snapshot(): Promise<WithdrawalSnapshot> {
    return { ...this.snapshotValue };
  }
  async simulateAssetWithdrawal(params: { tokenUnits: bigint }): Promise<
    { ok: true } | { ok: false; blocker: WithdrawalBlocker }
  > {
    this.simulationCalls.push(params.tokenUnits);
    return params.tokenUnits <= this.simulationLimit
      ? { ok: true }
      : { ok: false, blocker: this.simulationBlocker };
  }
  async isNonceUsed(): Promise<boolean> {
    return this.nonceUsed;
  }
  async verifyActionSignature(
    action: Action,
    signature: Hex,
    chainId: number,
    matching: Address,
  ): Promise<boolean> {
    return verifyTypedData({
      ...getActionTypedData(action, chainId, matching),
      address: action.signer,
      signature,
    }).catch(() => false);
  }
  async findActionUse(): Promise<WithdrawalNonceUse | null> {
    return this.nonceUse;
  }
  async simulateAndSubmit(
    action: Action,
    _signature: Hex,
    onSubmitted: (txHash: Hex) => Promise<void>,
    beforeSimulation?: () => Promise<void>,
  ): Promise<SubmitResult> {
    this.submittedActions.push(action);
    await beforeSimulation?.();
    if (this.submitError) throw this.submitError;
    await onSubmitted(this.submitResult.txHash);
    if (this.submitErrorAfterHash) throw this.submitErrorAfterHash;
    await this.submitCompletion;
    return this.submitResult;
  }
  async receipt(): Promise<WithdrawalReceipt | null> {
    return this.receiptValue;
  }
  unresolvedTransaction(): Hex | null {
    return null;
  }
  clearUnresolvedTransaction(): void {}
  adoptUnresolvedTransaction(txHash: Hex): void {
    this.adopted.push(txHash);
  }
  pauseForUnknownOperation(operationId: string): void {
    this.paused.push(operationId);
    this.activePauses.add(operationId);
  }
  clearUnknownOperation(operationId: string): void {
    this.cleared.push(operationId);
    this.activePauses.delete(operationId);
  }
}

function makeHarness(options?: {
  gateway?: FakeWithdrawalGateway;
  store?: InMemoryWithdrawalOperationStore;
  assets?: WithdrawalAssetDefinition[];
  now?: () => number;
  reservedCash?: (subaccountId: bigint) => bigint | Promise<bigint>;
}) {
  const gateway = options?.gateway ?? new FakeWithdrawalGateway();
  const store = options?.store ?? new InMemoryWithdrawalOperationStore();
  const now = options?.now ?? (() => 1_000_000);
  const engine = new WithdrawalEngine({
    chainId: CHAIN_ID,
    matching: MATCHING,
    withdrawalModule: WITHDRAWAL_MODULE,
    standardManager: STANDARD_MANAGER,
    assets: options?.assets ?? [cashAsset, btcAsset],
    gateway,
    store,
    now,
    reservedCash: options?.reservedCash,
  });
  return { engine, gateway, store };
}

async function prepare(
  engine: WithdrawalEngine,
  assetId: "cash" | "market:BTC" = "market:BTC",
  tokenUnits = "1000",
  key = "withdrawal-key-0001",
) {
  const preview = await engine.preview({
    owner: owner.address,
    subaccountId: "11",
    assetId,
  });
  return engine.prepare(
    {
      owner: owner.address,
      subaccountId: "11",
      assetId,
      tokenUnits,
      previewBlockHash: preview.blockHash,
    },
    key,
  );
}

async function signPrepared(store: InMemoryWithdrawalOperationStore, id: string): Promise<Hex> {
  const operation = await store.get(id);
  if (!operation) throw new Error("missing prepared operation");
  return signAction({
    action: operation.action,
    signer: owner,
    chainId: CHAIN_ID,
    matchingAddress: MATCHING,
  });
}

async function waitForStatus(
  engine: WithdrawalEngine,
  id: string,
  wanted: WithdrawalOperation["status"],
) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const current = await engine.get(id);
    if (current.withdrawal.status === wanted) return current.withdrawal;
    await delay(1);
  }
  throw new Error(`withdrawal ${id} did not reach ${wanted}`);
}

describe("WithdrawalEngine preview", () => {
  it("pins reads and simulations to one canonical block and exposes exact diagnostics", async () => {
    const { engine, gateway } = makeHarness();
    const preview = await engine.preview({
      owner: owner.address,
      subaccountId: "11",
      assetId: "market:BTC",
    });

    expect(preview).toMatchObject({
      owner: owner.address,
      subaccountId: "11",
      asset: {
        assetId: "market:BTC",
        tokenAddress: BTC_TOKEN,
        tokenDecimals: 8,
      },
      internalBalance: (100n * ONE).toString(),
      cashWithInterest: (100n * ONE).toString(),
      balanceTokenUnits: "10000000000",
      cashExchangeRate: ONE.toString(),
      cashWithdrawFeeEnabled: false,
      debtTokenUnits: "0",
      protocolMaxTokenUnits: "10000000000",
      recommendedMaxTokenUnits: "10000000000",
      blockNumber: "100",
      blockHash: BLOCK.hash,
      blocker: null,
    });
    expect(gateway.simulationCalls).toEqual([10_000_000_000n]);
  });

  it.each([
    ["ACCOUNT_NOT_IN_MATCHING", { matchingOwner: zeroAddress }],
    ["OWNER_MISMATCH", { matchingOwner: other.address }],
    ["ACCOUNT_NOT_HELD_BY_MATCHING", { accountHolder: other.address }],
    ["ACCOUNT_EXIT_PENDING", { withdrawTimestamp: 1n }],
    ["UNSUPPORTED_MANAGER", { manager: other.address }],
    ["ASSET_CONFIG_MISMATCH", { tokenAddress: other.address }],
    ["ASSET_DECIMALS_MISMATCH", { tokenDecimals: 18 }],
  ] as const)("fails closed with %s", async (code, override) => {
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue = { ...gateway.snapshotValue, ...override };
    const { engine } = makeHarness({ gateway });
    const preview = await engine.preview({
      owner: owner.address,
      subaccountId: "11",
      assetId: "market:BTC",
    });
    expect(preview.blocker?.code).toBe(code);
    expect(preview.protocolMaxTokenUnits).toBe("0");
    expect(gateway.simulationCalls).toHaveLength(0);
  });

  it("rejects assets outside the canonical deployed registry", async () => {
    const { engine } = makeHarness();
    await expect(
      engine.preview({ owner: owner.address, subaccountId: "11", assetId: "market:ETH" }),
    ).rejects.toMatchObject({ body: { code: "UNSUPPORTED_ASSET" } });
  });

  it("finds the exact native-unit max and applies the buffer only when margin-limited", async () => {
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue.internalBalance = 1_000n * 10n ** 10n;
    gateway.simulationLimit = 777n;
    const { engine } = makeHarness({ gateway });
    const preview = await engine.preview({
      owner: owner.address,
      subaccountId: "11",
      assetId: "market:BTC",
    });

    expect(preview.protocolMaxTokenUnits).toBe("777");
    expect(preview.recommendedMaxTokenUnits).toBe("773");
    expect(gateway.simulationCalls[0]).toBe(1_000n);
    expect(gateway.simulationCalls).toContain(778n);
  });

  it("fails closed rather than approximating after 96 binary-search iterations", async () => {
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue = {
      ...gateway.snapshotValue,
      internalBalance: 1n << 100n,
      tokenDecimals: 18,
    };
    gateway.simulationLimit = 1n << 99n;
    const unconfiguredDecimals = { ...btcAsset, configuredTokenDecimals: null };
    const { engine } = makeHarness({ gateway, assets: [unconfiguredDecimals] });

    await expect(
      engine.preview({ owner: owner.address, subaccountId: "11", assetId: "market:BTC" }),
    ).rejects.toMatchObject({ body: { code: "MAX_SEARCH_INCONCLUSIVE", retryable: true } });
    expect(gateway.simulationCalls).toHaveLength(97);
  });

  it("caps cash by positive interest-adjusted cash, liquidity, and maker reservations", async () => {
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue = {
      ...gateway.snapshotValue,
      tokenAddress: CASH_TOKEN,
      tokenSymbol: "USDT",
      tokenDecimals: 6,
      cashWithInterest: 10n * ONE,
      cashExchangeRate: 2n * ONE,
      cashWithdrawFeeEnabled: false,
      tokenLiquidity: 8_000_000n,
    };
    const { engine } = makeHarness({ gateway, reservedCash: () => 4n * ONE });
    const preview = await engine.preview({
      owner: owner.address,
      subaccountId: "11",
      assetId: "cash",
    });

    // The no-borrow cap is independent of a dormant fee exchange rate.
    expect(preview.balanceTokenUnits).toBe("10000000");
    expect(preview.protocolMaxTokenUnits).toBe("6000000");
    expect(gateway.simulationCalls).toEqual([6_000_000n]);
  });

  it("blocks cash while the variable insolvency burn is active without blocking collateral", async () => {
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue = {
      ...gateway.snapshotValue,
      tokenAddress: CASH_TOKEN,
      tokenSymbol: "USDT",
      tokenDecimals: 6,
      cashWithInterest: 10n * ONE,
      cashExchangeRate: ONE / 2n,
      cashWithdrawFeeEnabled: true,
      tokenLiquidity: 8_000_000n,
    };
    const { engine } = makeHarness({ gateway });
    const cash = await engine.preview({
      owner: owner.address,
      subaccountId: "11",
      assetId: "cash",
    });
    expect(cash).toMatchObject({
      cashExchangeRate: (ONE / 2n).toString(),
      cashWithdrawFeeEnabled: true,
      protocolMaxTokenUnits: "0",
      blocker: { code: "CASH_WITHDRAWALS_BLOCKED" },
    });
    expect(gateway.simulationCalls).toHaveLength(0);

    gateway.snapshotValue = {
      ...gateway.snapshotValue,
      tokenAddress: BTC_TOKEN,
      tokenSymbol: "BTCB",
      tokenDecimals: 8,
      internalBalance: ONE,
      tokenLiquidity: 100_000_000n,
    };
    const collateral = await engine.preview({
      owner: owner.address,
      subaccountId: "11",
      assetId: "market:BTC",
    });
    expect(collateral.blocker).toBeNull();
    expect(collateral.protocolMaxTokenUnits).toBe("100000000");
  });

  it("reports interest-adjusted debt in cash-token decimals without blocking collateral preview", async () => {
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue.cashWithInterest = -(ONE + 1n);
    const { engine } = makeHarness({ gateway });
    const preview = await engine.preview({
      owner: owner.address,
      subaccountId: "11",
      assetId: "market:BTC",
    });
    expect(preview.debtTokenUnits).toBe("1000001");
    expect(preview.protocolMaxTokenUnits).toBe("10000000000");
    expect(preview.blocker).toBeNull();
  });

  it("floors buffered cash Max to the representable quantum above 18 decimals", async () => {
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue = {
      ...gateway.snapshotValue,
      tokenAddress: CASH_TOKEN,
      tokenSymbol: "USDT",
      tokenDecimals: 20,
      cashTokenDecimals: 20,
      cashWithInterest: 101n,
      tokenLiquidity: 100_000n,
    };
    gateway.simulationLimit = 10_000n;
    const highDecimalCash = { ...cashAsset, configuredTokenDecimals: null };
    const { engine } = makeHarness({ gateway, assets: [highDecimalCash] });
    const preview = await engine.preview({
      owner: owner.address,
      subaccountId: "11",
      assetId: "cash",
    });
    expect(preview.protocolMaxTokenUnits).toBe("10000");
    expect(preview.recommendedMaxTokenUnits).toBe("9900");
  });

  it("applies the same >18-decimal quantum to collateral", async () => {
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue = {
      ...gateway.snapshotValue,
      internalBalance: 101n,
      tokenDecimals: 20,
    };
    gateway.simulationLimit = 10_000n;
    const highDecimalCollateral = { ...btcAsset, configuredTokenDecimals: null };
    const { engine } = makeHarness({ gateway, assets: [highDecimalCollateral] });
    const preview = await engine.preview({
      owner: owner.address,
      subaccountId: "11",
      assetId: "market:BTC",
    });
    expect(preview.protocolMaxTokenUnits).toBe("10000");
    expect(preview.recommendedMaxTokenUnits).toBe("9900");
    await expect(
      engine.prepare(
        {
          owner: owner.address,
          subaccountId: "11",
          assetId: "market:BTC",
          tokenUnits: "9950",
          previewBlockHash: preview.blockHash,
        },
        "unaligned-collateral-key",
      ),
    ).rejects.toMatchObject({ body: { code: "TOKEN_UNITS_UNALIGNED" } });
  });

  it("detects a pinned-block reorg after simulation", async () => {
    const gateway = new FakeWithdrawalGateway();
    gateway.blocksByNumber.set(BLOCK.number, { ...BLOCK, hash: hash("2") });
    const { engine } = makeHarness({ gateway });
    await expect(
      engine.preview({ owner: owner.address, subaccountId: "11", assetId: "market:BTC" }),
    ).rejects.toMatchObject({ body: { code: "PREVIEW_REORGED", retryable: true } });
  });
});

describe("WithdrawalEngine prepare", () => {
  it("rejects stale, missing, and non-canonical preview hashes", async () => {
    const stale = new FakeWithdrawalGateway();
    stale.latest = { ...BLOCK, timestamp: 900n };
    stale.blocksByNumber.set(BLOCK.number, stale.latest);
    stale.blocksByHash.clear();
    stale.blocksByHash.set(stale.latest.hash, stale.latest);
    const staleEngine = makeHarness({ gateway: stale }).engine;
    await expect(
      staleEngine.prepare(
        {
          owner: owner.address,
          subaccountId: "11",
          assetId: "market:BTC",
          tokenUnits: "1",
          previewBlockHash: stale.latest.hash,
        },
        "stale-preview-key",
      ),
    ).rejects.toMatchObject({ body: { code: "PREVIEW_EXPIRED", retryable: true } });

    const missing = makeHarness();
    await expect(
      missing.engine.prepare(
        {
          owner: owner.address,
          subaccountId: "11",
          assetId: "market:BTC",
          tokenUnits: "1",
          previewBlockHash: hash("f"),
        },
        "missing-preview-key",
      ),
    ).rejects.toMatchObject({ body: { code: "PREVIEW_EXPIRED" } });

    const reorged = new FakeWithdrawalGateway();
    reorged.blocksByNumber.set(BLOCK.number, { ...BLOCK, hash: hash("2") });
    const reorgedEngine = makeHarness({ gateway: reorged }).engine;
    await expect(
      reorgedEngine.prepare(
        {
          owner: owner.address,
          subaccountId: "11",
          assetId: "market:BTC",
          tokenUnits: "1",
          previewBlockHash: BLOCK.hash,
        },
        "reorg-preview-key",
      ),
    ).rejects.toMatchObject({ body: { code: "PREVIEW_EXPIRED" } });
  });

  it("revalidates Max at latest state and rejects one native unit above it", async () => {
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue.internalBalance = 1_000n * 10n ** 10n;
    gateway.simulationLimit = 777n;
    const { engine } = makeHarness({ gateway });
    const preview = await engine.preview({
      owner: owner.address,
      subaccountId: "11",
      assetId: "market:BTC",
    });
    await expect(
      engine.prepare(
        {
          owner: owner.address,
          subaccountId: "11",
          assetId: "market:BTC",
          tokenUnits: "778",
          previewBlockHash: preview.blockHash,
        },
        "max-plus-one-key",
      ),
    ).rejects.toMatchObject({ body: { code: "AMOUNT_EXCEEDS_MAX" } });
  });

  it("persists a server-generated immutable action and frozen review", async () => {
    const { engine, store } = makeHarness();
    const prepared = await prepare(engine);
    const operation = await store.get(prepared.response.withdrawalId);
    expect(operation).not.toBeNull();
    expect(operation?.actionDigest).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(operation?.action.owner).toBe(owner.address);
    expect(operation?.action.signer).toBe(owner.address);
    expect(operation?.action.module).toBe(WITHDRAWAL_MODULE);
    expect(operation?.action.expiry).toBe(1_600n);
    expect(operation?.review).toEqual(prepared.response.review);
    expect(prepared.response.review).toMatchObject({
      recipient: owner.address,
      assetId: "market:BTC",
      tokenUnits: "1000",
      tokenDecimals: 8,
      preparedBlockHash: BLOCK.hash,
    });
    expect(decodeWithdrawData(operation!.action.data)).toEqual({
      asset: BTC_ASSET,
      assetAmount: 1_000n,
    });
  });

  it("freezes scaled six-decimal display amounts in the prepare review", async () => {
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue = {
      ...gateway.snapshotValue,
      internalBalance: 100n * ONE,
      tokenDecimals: 6,
      multiplier: 2n * ONE,
    };
    const scaledAsset = {
      ...btcAsset,
      configuredTokenDecimals: 6,
      scaledUi: true,
    };
    const { engine } = makeHarness({ gateway, assets: [scaledAsset] });
    const prepared = await prepare(engine, "market:BTC", "1000000", "scaled-review-key");
    expect(prepared.response.review).toMatchObject({
      tokenUnits: "1000000",
      tokenDecimals: 6,
      multiplier: (2n * ONE).toString(),
      displayAmount: "2",
    });
  });

  it("replays the same owner/key/payload, conflicts on changes, and scopes keys by owner", async () => {
    const { engine, gateway } = makeHarness();
    const first = await prepare(engine);
    const replay = await prepare(engine);
    expect(replay.replayed).toBe(true);
    expect(replay.response).toEqual(first.response);

    await expect(prepare(engine, "market:BTC", "999", "withdrawal-key-0001")).rejects.toMatchObject({
      body: { code: "IDEMPOTENCY_CONFLICT" },
    });

    gateway.snapshotValue.matchingOwner = other.address;
    const preview = await engine.preview({ owner: other.address, subaccountId: "11", assetId: "market:BTC" });
    const scoped = await engine.prepare(
      {
        owner: other.address,
        subaccountId: "11",
        assetId: "market:BTC",
        tokenUnits: "1000",
        previewBlockHash: preview.blockHash,
      },
      "withdrawal-key-0001",
    );
    expect(scoped.response.withdrawalId).not.toBe(first.response.withdrawalId);
  });

  it("atomically coalesces concurrent same-key preparation", async () => {
    const { engine } = makeHarness();
    const [first, second] = await Promise.all([prepare(engine), prepare(engine)]);
    expect(new Set([first.response.withdrawalId, second.response.withdrawalId])).toHaveLength(1);
    expect([first.replayed, second.replayed].filter(Boolean)).toHaveLength(1);
  });

  it("uses distinct 256-bit random nonces for distinct operations", async () => {
    const { engine } = makeHarness();
    const first = await prepare(engine, "market:BTC", "1000", "random-nonce-key-1");
    const second = await prepare(engine, "market:BTC", "1000", "random-nonce-key-2");
    const firstNonce = BigInt(first.response.action.nonce);
    const secondNonce = BigInt(second.response.action.nonce);
    expect(firstNonce).toBeGreaterThan(0n);
    expect(firstNonce).toBeLessThan(1n << 256n);
    expect(secondNonce).not.toBe(firstNonce);
  });

  it("rejects unrepresentable >18-decimal cash token units", async () => {
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue = {
      ...gateway.snapshotValue,
      tokenAddress: CASH_TOKEN,
      tokenSymbol: "USDT",
      tokenDecimals: 20,
      cashTokenDecimals: 20,
      cashWithInterest: 101n,
    };
    const highDecimalCash = { ...cashAsset, configuredTokenDecimals: null };
    const { engine } = makeHarness({ gateway, assets: [highDecimalCash] });
    const preview = await engine.preview({ owner: owner.address, subaccountId: "11", assetId: "cash" });
    await expect(
      engine.prepare(
        {
          owner: owner.address,
          subaccountId: "11",
          assetId: "cash",
          tokenUnits: "9950",
          previewBlockHash: preview.blockHash,
        },
        "unaligned-cash-key",
      ),
    ).rejects.toMatchObject({ body: { code: "TOKEN_UNITS_UNALIGNED" } });
  });
});

describe("WithdrawalEngine signed execution and recovery", () => {
  it("leaves a prepared operation retryable after an invalid signature", async () => {
    const { engine } = makeHarness();
    const prepared = await prepare(engine);
    const badSignature = await other.signMessage({ message: "not this withdrawal" });
    await expect(
      engine.submit(prepared.response.withdrawalId, { signature: badSignature }),
    ).rejects.toMatchObject({ body: { code: "INVALID_SIGNATURE" } });
    expect((await engine.get(prepared.response.withdrawalId)).withdrawal.status).toBe("prepared");
  });

  it("fails closed when a used nonce cannot be attributed to the exact action", async () => {
    const { engine, gateway, store } = makeHarness();
    const prepared = await prepare(engine);
    const signature = await signPrepared(store, prepared.response.withdrawalId);
    gateway.nonceUsed = true;
    await expect(
      engine.submit(prepared.response.withdrawalId, { signature }),
    ).rejects.toMatchObject({ body: { code: "NONCE_ATTRIBUTION_UNKNOWN" } });
    expect((await engine.get(prepared.response.withdrawalId)).withdrawal.status).toBe("unknown");
    expect(gateway.submittedActions).toHaveLength(0);
  });

  it("moves through submitting/submitted to confirmed and submits exactly the stored action", async () => {
    const { engine, gateway, store } = makeHarness();
    const prepared = await prepare(engine);
    const operation = await store.get(prepared.response.withdrawalId);
    const signature = await signPrepared(store, prepared.response.withdrawalId);
    const accepted = await engine.submit(prepared.response.withdrawalId, { signature });
    expect(accepted.withdrawal.status).toBe("submitting");
    const immediate = await engine.get(prepared.response.withdrawalId);
    expect(immediate.withdrawal.status).toBe("submitting");
    expect(gateway.paused).toHaveLength(0);
    const confirmed = await waitForStatus(engine, prepared.response.withdrawalId, "confirmed");
    expect(confirmed).toMatchObject({ txHash: TX_HASH, blockNumber: "101", error: null });
    expect(gateway.submittedActions).toEqual([operation!.action]);
  });

  it("releases an early status-lookup latch after background confirmation so later writes proceed", async () => {
    let releaseReceipt!: () => void;
    const gateway = new FakeWithdrawalGateway();
    gateway.submitCompletion = new Promise<void>((resolve) => {
      releaseReceipt = resolve;
    });
    const { engine, store } = makeHarness({ gateway });
    const first = await prepare(engine, "market:BTC", "1000", "early-get-latch-first");
    const firstSignature = await signPrepared(store, first.response.withdrawalId);

    await engine.submit(first.response.withdrawalId, { signature: firstSignature });
    const submitted = await waitForStatus(engine, first.response.withdrawalId, "submitted");
    expect(submitted.txHash).toBe(TX_HASH);
    expect(gateway.activePauses).toContain(first.response.withdrawalId);

    releaseReceipt();
    const confirmed = await waitForStatus(engine, first.response.withdrawalId, "confirmed");
    expect(confirmed.error).toBeNull();
    expect(gateway.cleared).toContain(first.response.withdrawalId);
    expect(gateway.activePauses).not.toContain(first.response.withdrawalId);

    // Model the next shared-executor write after the race. A stale operation
    // latch would reject this before simulation/broadcast in production.
    gateway.submitCompletion = null;
    const second = await prepare(engine, "market:BTC", "1000", "early-get-latch-second");
    const secondSignature = await signPrepared(store, second.response.withdrawalId);
    await engine.submit(second.response.withdrawalId, { signature: secondSignature });
    await expect(waitForStatus(engine, second.response.withdrawalId, "confirmed")).resolves.toMatchObject({
      status: "confirmed",
    });
    expect(gateway.submittedActions).toHaveLength(2);
  });

  it("rejects a failed final simulation without broadcasting", async () => {
    const { engine, gateway, store } = makeHarness();
    const prepared = await prepare(engine);
    const signature = await signPrepared(store, prepared.response.withdrawalId);
    gateway.submitError = new ExecutorSimulationError(new Error("final eth_call reverted"));
    await engine.submit(prepared.response.withdrawalId, { signature });
    const rejected = await waitForStatus(engine, prepared.response.withdrawalId, "rejected");
    expect(rejected.txHash).toBeNull();
    expect(rejected.error).toMatchObject({ code: "SIGNED_SIMULATION_REJECTED" });
  });

  it("rechecks maker cash reservations inside the final executor queue", async () => {
    let reservation = 0n;
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue = {
      ...gateway.snapshotValue,
      tokenAddress: CASH_TOKEN,
      tokenSymbol: "USDT",
      tokenDecimals: 6,
      cashWithInterest: 100n * ONE,
    };
    const { engine, store } = makeHarness({
      gateway,
      reservedCash: () => reservation,
    });
    const prepared = await prepare(engine, "cash", "10000000", "reservation-race-key");
    const signature = await signPrepared(store, prepared.response.withdrawalId);
    reservation = 95n * ONE;

    await engine.submit(prepared.response.withdrawalId, { signature });
    const rejected = await waitForStatus(engine, prepared.response.withdrawalId, "rejected");
    expect(rejected.error).toMatchObject({
      code: "POLICY_MAX_REDUCED",
      details: { latestPolicyMaxTokenUnits: "5000000" },
    });
    expect(rejected.txHash).toBeNull();
  });

  it("rechecks the NFT cooldown immediately before the signed simulation", async () => {
    const { engine, gateway, store } = makeHarness();
    const prepared = await prepare(engine);
    const signature = await signPrepared(store, prepared.response.withdrawalId);
    gateway.snapshotValue.withdrawTimestamp = 123n;

    await engine.submit(prepared.response.withdrawalId, { signature });
    const rejected = await waitForStatus(engine, prepared.response.withdrawalId, "rejected");
    expect(rejected.error).toMatchObject({
      code: "POLICY_CHANGED",
      details: { blockerCode: "ACCOUNT_EXIT_PENDING" },
    });
    expect(rejected.txHash).toBeNull();
  });

  it("rejects cash if the variable insolvency burn activates before final execution", async () => {
    const gateway = new FakeWithdrawalGateway();
    gateway.snapshotValue = {
      ...gateway.snapshotValue,
      tokenAddress: CASH_TOKEN,
      tokenSymbol: "USDT",
      tokenDecimals: 6,
      cashWithInterest: 100n * ONE,
    };
    const { engine, store } = makeHarness({ gateway });
    const prepared = await prepare(engine, "cash", "1000000", "cash-fee-race-key");
    const signature = await signPrepared(store, prepared.response.withdrawalId);
    gateway.snapshotValue.cashWithdrawFeeEnabled = true;
    gateway.snapshotValue.cashExchangeRate = ONE / 2n;

    await engine.submit(prepared.response.withdrawalId, { signature });
    const rejected = await waitForStatus(engine, prepared.response.withdrawalId, "rejected");
    expect(rejected.error).toMatchObject({
      code: "POLICY_CHANGED",
      details: { blockerCode: "CASH_WITHDRAWALS_BLOCKED" },
    });
    expect(rejected.txHash).toBeNull();
  });

  it("marks broadcast-without-hash ambiguity unknown and pauses the executor", async () => {
    const { engine, gateway, store } = makeHarness();
    const prepared = await prepare(engine);
    const signature = await signPrepared(store, prepared.response.withdrawalId);
    gateway.submitError = new ExecutorBroadcastUnknownError({ cause: new Error("rpc disconnected") });
    await engine.submit(prepared.response.withdrawalId, { signature });
    const unknown = await waitForStatus(engine, prepared.response.withdrawalId, "unknown");
    expect(unknown.error?.code).toBe("BROADCAST_OUTCOME_UNKNOWN");
    expect(unknown.txHash).toBeNull();
    expect(gateway.paused).toContain(prepared.response.withdrawalId);
  });

  it("keeps a broadcast hash submitted across receipt timeout and restart recovery", async () => {
    const gateway = new FakeWithdrawalGateway();
    const store = new InMemoryWithdrawalOperationStore();
    const first = makeHarness({ gateway, store });
    const prepared = await prepare(first.engine);
    const signature = await signPrepared(store, prepared.response.withdrawalId);
    gateway.submitErrorAfterHash = new Error("receipt timeout");
    await first.engine.submit(prepared.response.withdrawalId, { signature });
    const submitted = await waitForStatus(first.engine, prepared.response.withdrawalId, "submitted");
    expect(submitted).toMatchObject({
      txHash: TX_HASH,
      error: { code: "RECEIPT_UNAVAILABLE", retryable: true },
    });
    expect(gateway.adopted).toContain(TX_HASH);
    expect(gateway.paused).toContain(prepared.response.withdrawalId);

    const restarted = makeHarness({ gateway, store });
    const summary = await restarted.engine.recover();
    expect(summary.pending).toBe(1);
    expect((await restarted.engine.get(prepared.response.withdrawalId)).withdrawal.status).toBe(
      "submitted",
    );
  });

  it("marks an ambiguous restart unknown, pauses writes, and recovers by nonce/event/receipt", async () => {
    const { engine, gateway, store } = makeHarness();
    const prepared = await prepare(engine);
    const operation = await store.get(prepared.response.withdrawalId);
    operation!.status = "submitting";
    operation!.submittedAt = 1_000_001;
    await store.put(operation!);

    const unknown = await engine.get(operation!.id);
    expect(unknown.withdrawal.status).toBe("unknown");
    expect(unknown.withdrawal.error?.code).toBe("BROADCAST_OUTCOME_UNKNOWN");
    expect(gateway.paused).toContain(operation!.id);

    gateway.nonceUsed = true;
    gateway.nonceUse = { txHash: TX_HASH, blockNumber: 101n };
    gateway.receiptValue = {
      status: "success",
      blockNumber: 101n,
      blockHash: RECEIPT_BLOCK_HASH,
    };
    const recovered = await engine.get(operation!.id);
    expect(recovered.withdrawal).toMatchObject({
      status: "confirmed",
      txHash: TX_HASH,
      blockNumber: "101",
      error: null,
    });
    expect(gateway.cleared).toContain(operation!.id);
  });

  it("expires a hashless unused action after canonical time and releases both executor latches", async () => {
    let now = 1_000_000;
    const { engine, gateway, store } = makeHarness({ now: () => now });
    const prepared = await prepare(engine, "market:BTC", "1000", "hashless-expiry-key");
    const operation = (await store.get(prepared.response.withdrawalId))!;
    operation.status = "submitting";
    operation.submittedAt = 1_000_001;
    await store.put(operation);

    const unknown = await engine.get(operation.id);
    expect(unknown.withdrawal.status).toBe("unknown");
    gateway.pauseForUnknownOperation(UNKNOWN_BROADCAST_OPERATION);
    expect(gateway.activePauses).toEqual(
      new Set([operation.id, UNKNOWN_BROADCAST_OPERATION]),
    );

    const afterExpiry: WithdrawalPinnedBlock = {
      number: 101n,
      hash: hash("3"),
      timestamp: operation.action.expiry + 1n,
    };
    gateway.latest = afterExpiry;
    gateway.blocksByNumber.set(afterExpiry.number, afterExpiry);
    gateway.blocksByHash.set(afterExpiry.hash, afterExpiry);
    now = Number(afterExpiry.timestamp) * 1_000;
    const expired = await engine.get(operation.id);
    expect(expired.withdrawal).toMatchObject({
      status: "expired",
      error: { code: "ACTION_EXPIRED_UNEXECUTED" },
    });
    expect(gateway.activePauses).toEqual(new Set());
    expect(gateway.cleared).toEqual(
      expect.arrayContaining([operation.id, UNKNOWN_BROADCAST_OPERATION]),
    );

    const next = await prepare(engine, "market:BTC", "1000", "after-hashless-expiry-key");
    const nextSignature = await signPrepared(store, next.response.withdrawalId);
    await engine.submit(next.response.withdrawalId, { signature: nextSignature });
    await expect(waitForStatus(engine, next.response.withdrawalId, "confirmed")).resolves.toMatchObject({
      status: "confirmed",
    });
  });

  it("expires unsigned operations and never auto-retries them", async () => {
    let now = 1_000_000;
    const { engine, gateway } = makeHarness({ now: () => now });
    const prepared = await prepare(engine);
    now = 1_600_000;
    const expired = await engine.get(prepared.response.withdrawalId);
    expect(expired.withdrawal.status).toBe("expired");
    expect(gateway.submittedActions).toHaveLength(0);
  });
});

describe("strict decimal parsing at the engine boundary", () => {
  it.each(["", "-1", "+1", "1.0", " 1", "01"])("rejects non-canonical subaccountId %j", async (value) => {
    const { engine } = makeHarness();
    await expect(
      engine.preview({ owner: owner.address, subaccountId: value, assetId: "market:BTC" }),
    ).rejects.toBeInstanceOf(WithdrawalApiError);
  });
});
