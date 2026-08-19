import { encodeFunctionData, keccak256, type Address, type Hex, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import { buildWithdrawalAction, matchingAbi, type Action } from "@hedge/shared";
import {
  UnresolvedExecutorTransactionError,
  ExecutorAttributionError,
  ViemTxSubmitter,
  type WithdrawalTxSubmitter,
} from "../src/chain.js";
import type { RfqActionIdentity } from "../src/types.js";
import { ViemWithdrawalGateway } from "../src/withdrawal-gateway.js";

const MATCHING = "0x2E2Ed0Cfd3AD2f1d34481277b3204d807Ca2F8c2" as Address;
const MODULE = "0x8198f5d8F8CfFE8f9C413d98a0A55aEB8ab9FbB7" as Address;
const SUB_ACCOUNTS = "0x1291Be112d480055DaFd8a610b7d1e203891C274" as Address;
const MANAGER = "0x9E545E3C0baAB3E08CdfD552C960A1050f373042" as Address;
const CASH = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as Address;
const ASSET = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512" as Address;
const TX_HASH = (`0x${"ab".repeat(32)}`) as Hex;
const RECEIPT_BLOCK_HASH = (`0x${"cd".repeat(32)}`) as Hex;
const SIGNATURE = (`0x${"11".repeat(65)}`) as Hex;

const account = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

const action: Action = buildWithdrawalAction({
  subaccountId: 11n,
  withdrawalModule: MODULE,
  asset: ASSET,
  assetAmount: 1n,
  owner: account.address,
  nonce: 1n,
  expiry: 2_000_000_000n,
});

describe("shared RFQ/withdrawal executor latch", () => {
  it("blocks both write paths after a receipt timeout until the exact hash reconciles", async () => {
    let receiptKnown = false;
    let receiptWaits = 0;
    const wallet = {
      account,
      chain: undefined,
      writeContract: vi.fn(async () => TX_HASH),
    } as unknown as WalletClient;
    const publicClient = {
      simulateContract: vi.fn(async () => ({ result: undefined })),
      waitForTransactionReceipt: vi.fn(async () => {
        receiptWaits++;
        if (receiptWaits === 1) throw new Error("receipt RPC timed out");
        return { status: "success", blockNumber: 102n, blockHash: RECEIPT_BLOCK_HASH };
      }),
      getTransactionReceipt: vi.fn(async () => {
        if (!receiptKnown) throw new Error("receipt not found");
        return { status: "success", blockNumber: 101n, blockHash: RECEIPT_BLOCK_HASH };
      }),
      getBlock: vi.fn(async () => ({ hash: RECEIPT_BLOCK_HASH })),
    } as unknown as PublicClient;
    const submitter = new ViemTxSubmitter(wallet, publicClient, MATCHING, account);

    // RFQ path broadcasts successfully but cannot resolve its receipt.
    await expect(submitter.submitVerifyAndMatch([], [], "0x")).rejects.toThrow(
      "receipt RPC timed out",
    );
    expect(submitter.unresolvedTransaction()).toBe(TX_HASH);

    // The same executor-wide latch blocks both subsequent RFQ and withdrawal writes.
    await expect(submitter.submitVerifyAndMatch([], [], "0x")).rejects.toBeInstanceOf(
      UnresolvedExecutorTransactionError,
    );
    await expect(
      submitter.simulateAndSubmitVerifyAndMatch([action], [SIGNATURE], "0x", async () => {}),
    ).rejects.toBeInstanceOf(UnresolvedExecutorTransactionError);
    expect(wallet.writeContract).toHaveBeenCalledTimes(1);
    expect(publicClient.simulateContract).not.toHaveBeenCalled();

    // Even a now-visible canonical receipt cannot release the process latch;
    // the durable owner must terminalize its journal first.
    receiptKnown = true;
    await expect(submitter.submitVerifyAndMatch([], [], "0x")).rejects.toBeInstanceOf(
      UnresolvedExecutorTransactionError,
    );
    expect(wallet.writeContract).toHaveBeenCalledTimes(1);
    submitter.clearUnresolvedTransaction(TX_HASH);

    // Explicit post-journal clearing lets the next writer proceed.
    const onSubmitted = vi.fn(async () => {});
    await expect(
      submitter.simulateAndSubmitVerifyAndMatch([action], [SIGNATURE], "0x", onSubmitted),
    ).resolves.toMatchObject({ status: "success", blockNumber: 102n });
    expect(publicClient.getTransactionReceipt).toHaveBeenLastCalledWith({ hash: TX_HASH });
    expect(publicClient.simulateContract).toHaveBeenCalledTimes(1);
    expect(wallet.writeContract).toHaveBeenCalledTimes(2);
    expect(onSubmitted).toHaveBeenCalledWith(TX_HASH);
    expect(submitter.unresolvedTransaction()).toBeNull();
  });

  it("keeps the executor latched when a waited receipt is no longer canonical", async () => {
    const reorgedHash = (`0x${"ef".repeat(32)}`) as Hex;
    const wallet = {
      account,
      chain: undefined,
      writeContract: vi.fn(async () => TX_HASH),
    } as unknown as WalletClient;
    const publicClient = {
      waitForTransactionReceipt: vi.fn(async () => ({
        status: "success",
        blockNumber: 102n,
        blockHash: RECEIPT_BLOCK_HASH,
      })),
      getBlock: vi.fn(async () => ({ hash: reorgedHash })),
    } as unknown as PublicClient;
    const submitter = new ViemTxSubmitter(wallet, publicClient, MATCHING, account);

    await expect(submitter.submitVerifyAndMatch([], [], "0x")).rejects.toThrow(
      "is no longer canonical",
    );
    expect(submitter.unresolvedTransaction()).toBe(TX_HASH);
    expect(wallet.writeContract).toHaveBeenCalledTimes(1);
  });
});

describe("exact RFQ execution reconciliation", () => {
  const CALLDATA = "0x123456" as Hex;
  const identities: [RfqActionIdentity, RfqActionIdentity] = [
    {
      subaccountId: 11n,
      nonce: 101n,
      module: MODULE,
      expiry: 2_000_000_000n,
      owner: account.address,
      signer: account.address,
      dataHash: keccak256("0x11"),
    },
    {
      subaccountId: 12n,
      nonce: 202n,
      module: MODULE,
      expiry: 2_000_000_010n,
      owner: ASSET,
      signer: ASSET,
      dataHash: keccak256("0x22"),
    },
  ];

  function makeSubmitter(client: Partial<PublicClient>) {
    const wallet = { account, chain: undefined } as unknown as WalletClient;
    return new ViemTxSubmitter(wallet, client as PublicClient, MATCHING, account);
  }

  it("accepts a known hash only with canonical receipt and exact calldata digest", async () => {
    const client = {
      getTransactionReceipt: vi.fn(async () => ({
        status: "success",
        blockNumber: 55n,
        blockHash: RECEIPT_BLOCK_HASH,
      })),
      getBlock: vi.fn(async () => ({ hash: RECEIPT_BLOCK_HASH, timestamp: 1n })),
      getTransaction: vi.fn(async () => ({ from: account.address, to: MATCHING, input: CALLDATA })),
    };
    await expect(makeSubmitter(client).reconcileVerifyAndMatch({
      txHash: TX_HASH,
      calldataHash: keccak256(CALLDATA),
      actions: identities,
      fromBlock: 40n,
    })).resolves.toEqual({
      state: "mined",
      result: { txHash: TX_HASH, status: "success", blockNumber: 55n },
    });
  });

  it("keeps a known hash ambiguous when its transaction input does not match", async () => {
    const client = {
      getTransactionReceipt: vi.fn(async () => ({
        status: "success",
        blockNumber: 55n,
        blockHash: RECEIPT_BLOCK_HASH,
      })),
      getBlock: vi.fn(async () => ({ hash: RECEIPT_BLOCK_HASH, timestamp: 1n })),
      getTransaction: vi.fn(async () => ({ from: account.address, to: MATCHING, input: "0xdead" as Hex })),
    };
    await expect(makeSubmitter(client).reconcileVerifyAndMatch({
      txHash: TX_HASH,
      calldataHash: keccak256(CALLDATA),
      actions: identities,
      fromBlock: 40n,
    })).rejects.toBeInstanceOf(ExecutorAttributionError);
  });

  it("rejects exact calldata mined by a different registered executor", async () => {
    const foreignExecutor = "0x1111111111111111111111111111111111111111" as Address;
    const client = {
      getTransactionReceipt: vi.fn(async () => ({
        status: "success",
        blockNumber: 55n,
        blockHash: RECEIPT_BLOCK_HASH,
      })),
      getBlock: vi.fn(async () => ({ hash: RECEIPT_BLOCK_HASH, timestamp: 1n })),
      getTransaction: vi.fn(async () => ({ from: foreignExecutor, to: MATCHING, input: CALLDATA })),
    };
    await expect(makeSubmitter(client).reconcileVerifyAndMatch({
      txHash: TX_HASH,
      calldataHash: keccak256(CALLDATA),
      actions: identities,
      fromBlock: 40n,
    })).rejects.toBeInstanceOf(ExecutorAttributionError);
  });

  it("attributes a hashless successful broadcast through nonce event plus exact calldata digest", async () => {
    const client = {
      getContractEvents: vi.fn(async () => [{
        args: { owner: identities[0].owner, nonce: identities[0].nonce },
        transactionHash: TX_HASH,
      }]),
      getTransactionReceipt: vi.fn(async () => ({
        status: "success",
        blockNumber: 55n,
        blockHash: RECEIPT_BLOCK_HASH,
      })),
      getBlock: vi.fn(async () => ({ hash: RECEIPT_BLOCK_HASH, timestamp: 1n })),
      getTransaction: vi.fn(async () => ({ from: account.address, to: MATCHING, input: CALLDATA })),
    };
    await expect(makeSubmitter(client).reconcileVerifyAndMatch({
      txHash: null,
      calldataHash: keccak256(CALLDATA),
      actions: identities,
      fromBlock: 40n,
    })).resolves.toMatchObject({ state: "mined", result: { txHash: TX_HASH } });
  });

  it("proves a hashless attempt terminal only after both expiries and both unused nonces", async () => {
    const readContract = vi.fn(async () => false);
    const client = {
      getContractEvents: vi.fn(async () => []),
      getBlock: vi.fn(async () => ({
        hash: RECEIPT_BLOCK_HASH,
        timestamp: identities[1].expiry + 1n,
      })),
      readContract,
    };
    await expect(makeSubmitter(client).reconcileVerifyAndMatch({
      txHash: null,
      calldataHash: keccak256(CALLDATA),
      actions: identities,
      fromBlock: 40n,
    })).resolves.toEqual({ state: "expired-unused" });
    expect(readContract).toHaveBeenCalledTimes(2);
  });
});

describe("hashless withdrawal attribution", () => {
  it("accepts only the configured executor's exact transaction", async () => {
    const foreignExecutor = "0x1111111111111111111111111111111111111111" as Address;
    const calldata = encodeFunctionData({
      abi: matchingAbi,
      functionName: "verifyAndMatch",
      args: [[action], [SIGNATURE], "0x"],
    });
    const getTransaction = vi
      .fn()
      .mockResolvedValueOnce({ from: foreignExecutor, to: MATCHING, input: calldata })
      .mockResolvedValueOnce({ from: account.address, to: MATCHING, input: calldata });
    const client = {
      getContractEvents: vi.fn(async () => [{
        args: { owner: action.owner, nonce: action.nonce },
        transactionHash: TX_HASH,
        blockNumber: 55n,
      }]),
      getTransaction,
    } as unknown as PublicClient;
    const submitter = { executorAddress: account.address } as WithdrawalTxSubmitter;
    const gateway = new ViemWithdrawalGateway(client, submitter, {
      matching: MATCHING,
      withdrawalModule: MODULE,
      subAccounts: SUB_ACCOUNTS,
      standardManager: MANAGER,
      cashAsset: CASH,
    });

    await expect(gateway.findActionUse(action, 40n)).resolves.toBeNull();
    await expect(gateway.findActionUse(action, 40n)).resolves.toEqual({
      txHash: TX_HASH,
      blockNumber: 55n,
    });
  });
});

describe("withdrawal signature verification boundary", () => {
  it("delegates typed-data verification to the PublicClient for EOA and ERC-1271 support", async () => {
    const verifyTypedData = vi.fn(async () => true);
    const client = { verifyTypedData } as unknown as PublicClient;
    const submitter = {} as WithdrawalTxSubmitter;
    const gateway = new ViemWithdrawalGateway(client, submitter, {
      matching: MATCHING,
      withdrawalModule: MODULE,
      subAccounts: SUB_ACCOUNTS,
      standardManager: MANAGER,
      cashAsset: CASH,
    });

    await expect(
      gateway.verifyActionSignature(action, SIGNATURE, 31337, MATCHING),
    ).resolves.toBe(true);
    expect(verifyTypedData).toHaveBeenCalledWith(
      expect.objectContaining({
        address: action.signer,
        signature: SIGNATURE,
        primaryType: "Action",
        message: expect.objectContaining({ owner: action.owner, signer: action.signer }),
      }),
    );
  });

  it("does not confirm a receipt whose block hash is no longer canonical", async () => {
    const canonicalHash = (`0x${"ef".repeat(32)}`) as Hex;
    const client = {
      getTransactionReceipt: vi.fn(async () => ({
        status: "success",
        blockNumber: 101n,
        blockHash: RECEIPT_BLOCK_HASH,
      })),
      getBlock: vi.fn(async () => ({ hash: canonicalHash })),
    } as unknown as PublicClient;
    const gateway = new ViemWithdrawalGateway(client, {} as WithdrawalTxSubmitter, {
      matching: MATCHING,
      withdrawalModule: MODULE,
      subAccounts: SUB_ACCOUNTS,
      standardManager: MANAGER,
      cashAsset: CASH,
    });

    await expect(gateway.receipt(TX_HASH)).resolves.toBeNull();
    expect(client.getBlock).toHaveBeenCalledWith({ blockNumber: 101n });
  });
});
