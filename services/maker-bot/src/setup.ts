/**
 * --setup: one-time self-provisioning for a funded EOA.
 *
 * Mirrors the vendored integration-test path
 * (v2-matching/test/shared/MatchingBase.t.sol + periphery/SubAccountCreator):
 *   1. Matching.createSubAccount(standardManager)
 *        -> SubAccounts.createAccount(matching, manager); Matching records
 *           subAccountToOwner[id] = our EOA (verified in SubAccountsManager.sol).
 *   2. USDT.approve(cashAsset, amount)
 *   3. CashAsset.deposit(subaccountId, amount)
 *        -> pulls USDT from msg.sender, credits cash to the subaccount
 *           (deposit is permissionless for any recipient account).
 *
 * The resulting USDT cash balance lets the maker pay call premiums and pass
 * SRM margin when buying calls (long options need no extra margin; cash must
 * stay >= 0 after premium + fees).
 */
import type { Address, PublicClient, WalletClient } from "viem";
import {
  cashAssetAbi,
  fromUnit,
  getDeployedAddress,
  matchingAbi,
  mockErc20Abi,
  requireDeployments,
  subAccountsAbi,
  toTokenAmount,
  type DeploymentsFile,
} from "@hedge/shared";
import type { PrivateKeyAccount } from "viem/accounts";
import type { MakerBotConfig } from "./config.js";
import { readState, writeState } from "./state.js";

export interface SetupResult {
  subaccountId: bigint;
  cashBalance18: bigint;
  statePath: string;
}

export async function runSetup(params: {
  cfg: MakerBotConfig;
  account: PrivateKeyAccount;
  publicClient: PublicClient;
  walletClient: WalletClient;
  deployments?: DeploymentsFile;
}): Promise<SetupResult> {
  const { cfg, account, publicClient, walletClient } = params;
  const deployments = params.deployments ?? requireDeployments(cfg.chainId);

  const matching = getDeployedAddress(deployments, "matching");
  const standardManager = getDeployedAddress(deployments, "standardManager");
  const cashAsset = getDeployedAddress(deployments, "cashAsset");
  const subAccounts = getDeployedAddress(deployments, "subAccounts");
  const usdt = getDeployedAddress(deployments, "usdt");

  const usdtDecimals = await publicClient.readContract({
    address: usdt,
    abi: mockErc20Abi,
    functionName: "decimals",
  });
  const depositAmount = toTokenAmount(cfg.depositUsdt, Number(usdtDecimals));

  const balance = await publicClient.readContract({
    address: usdt,
    abi: mockErc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
  if (balance < depositAmount) {
    throw new Error(
      `EOA ${account.address} holds ${fromUnit(balance, Number(usdtDecimals))} USDT but setup ` +
        `needs ${cfg.depositUsdt}. Fund it first (anvil: mint mock USDT to this address).`,
    );
  }

  const chain = walletClient.chain;

  // 1. Create the subaccount under Matching, managed by the SRM.
  console.log(`[setup] Matching.createSubAccount(SRM) via ${account.address}`);
  const { result: subaccountId, request: createReq } = await publicClient.simulateContract({
    address: matching,
    abi: matchingAbi,
    functionName: "createSubAccount",
    args: [standardManager],
    account,
    chain,
  });
  const createTx = await walletClient.writeContract(createReq);
  await publicClient.waitForTransactionReceipt({ hash: createTx });
  console.log(`[setup] subaccount ${subaccountId} created (tx ${createTx})`);

  // Sanity: Matching must record us as the off-chain owner, and the NFT must
  // sit with Matching itself.
  const [recordedOwner, nftOwner] = await Promise.all([
    publicClient.readContract({
      address: matching,
      abi: matchingAbi,
      functionName: "subAccountToOwner",
      args: [subaccountId],
    }),
    publicClient.readContract({
      address: subAccounts,
      abi: subAccountsAbi,
      functionName: "ownerOf",
      args: [subaccountId],
    }),
  ]);
  if (recordedOwner.toLowerCase() !== account.address.toLowerCase()) {
    throw new Error(`Matching.subAccountToOwner mismatch: ${recordedOwner}`);
  }
  if (nftOwner.toLowerCase() !== matching.toLowerCase()) {
    throw new Error(`subaccount NFT not held by Matching: ${nftOwner}`);
  }

  // 2. Approve + 3. deposit USDT cash.
  console.log(`[setup] approving ${cfg.depositUsdt} USDT to CashAsset`);
  const approveTx = await walletClient.writeContract({
    address: usdt,
    abi: mockErc20Abi,
    functionName: "approve",
    args: [cashAsset, depositAmount],
    account,
    chain,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveTx });

  console.log(`[setup] CashAsset.deposit(${subaccountId}, ${cfg.depositUsdt})`);
  const depositTx = await walletClient.writeContract({
    address: cashAsset,
    abi: cashAssetAbi,
    functionName: "deposit",
    args: [subaccountId, depositAmount],
    account,
    chain,
  });
  await publicClient.waitForTransactionReceipt({ hash: depositTx });

  // Verify the 18dp cash balance landed on the subaccount.
  const cashBalance18 = await publicClient.readContract({
    address: subAccounts,
    abi: subAccountsAbi,
    functionName: "getBalance",
    args: [subaccountId, cashAsset, 0n],
  });
  if (cashBalance18 <= 0n) throw new Error("cash balance is zero after deposit");
  console.log(`[setup] subaccount ${subaccountId} cash balance: ${fromUnit(cashBalance18)} USDT`);

  const statePath = writeState(cfg.stateFile, {
    chainId: cfg.chainId,
    owner: account.address,
    subaccountId: subaccountId.toString(),
  });
  console.log(`[setup] state written to ${statePath}`);

  return { subaccountId, cashBalance18, statePath };
}

/** Resolve the maker subaccount: env override > state file. */
export function resolveSubaccountId(cfg: MakerBotConfig, ownerHint?: Address): bigint {
  if (cfg.subaccountId !== null) return cfg.subaccountId;
  const state = (() => {
    try {
      return readState(cfg.stateFile);
    } catch {
      return null;
    }
  })();
  if (state && state.chainId === cfg.chainId) {
    if (ownerHint && state.owner.toLowerCase() !== ownerHint.toLowerCase()) {
      throw new Error(
        `state file ${cfg.stateFile} belongs to ${state.owner}, not ${ownerHint} — re-run --setup`,
      );
    }
    return BigInt(state.subaccountId);
  }
  throw new Error(
    `No maker subaccount: set MAKER_SUBACCOUNT_ID or run \`maker-bot --setup\` first ` +
      `(looked for ${cfg.stateFile})`,
  );
}
