import {
  BaseError,
  ContractFunctionRevertedError,
  decodeFunctionData,
  parseAbi,
  TransactionReceiptNotFoundError,
  toFunctionSelector,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import {
  cashAssetAbi,
  erc20Abi,
  matchingAbi,
  standardManagerAbi,
  subAccountsAbi,
  wrappedErc20AssetAbi,
  withdrawalModuleAbi,
  getActionTypedData,
  type Action,
} from "@hedge/shared";
import type { SubmitResult, WithdrawalTxSubmitter } from "./chain.js";
import type { WithdrawalAssetDefinition, WithdrawalBlocker } from "./withdrawal-types.js";

const ONE = 10n ** 18n;
const scaledTokenAbi = [
  {
    type: "function",
    name: "uiMultiplier",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;
const withdrawalSimulationAbi = parseAbi([
  "function withdraw(uint256 accountId,uint256 tokenUnits,address recipient)",
  "error BM_AdjustmentsPaused()",
  "error BM_AccountUnderLiquidation()",
  "error BM_NonceAlreadyUsed()",
  "error SRM_PortfolioBelowMargin()",
  "error PMRM_InsufficientMargin()",
  "error SRM_NoNegativeCash()",
  "error SRM_UnsupportedAsset()",
  "error CA_WithdrawBlockedByOngoingAuction()",
  "error CA_OnlyAccountOwner()",
  "error WERC_OnlyAccountOwner()",
  "error WERC_CannotBeNegative()",
  "error ERC20InsufficientBalance(address sender,uint256 balance,uint256 needed)",
]);

export interface WithdrawalPinnedBlock {
  number: bigint;
  hash: Hex;
  timestamp: bigint;
}

export interface WithdrawalSnapshot {
  matchingOwner: Address;
  accountHolder: Address;
  manager: Address;
  /** Nonzero while the Matching NFT escape-hatch cooldown is active. */
  withdrawTimestamp: bigint;
  internalBalance: bigint;
  /** Always populated from CashAsset, even when previewing market collateral. */
  cashWithInterest: bigint;
  /** Native decimals of CashAsset.wrappedAsset (debt denomination). */
  cashTokenDecimals: number;
  /** 18-decimal cash-to-stable rate used by CashAsset during insolvency. */
  cashExchangeRate: bigint;
  cashWithdrawFeeEnabled: boolean;
  initialMargin: bigint;
  initialMarkToMarket: bigint;
  maintenanceMargin: bigint;
  maintenanceMarkToMarket: bigint;
  tokenAddress: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenLiquidity: bigint;
  multiplier: bigint;
}

export interface WithdrawalReceipt {
  status: "success" | "reverted";
  blockNumber: bigint;
  blockHash: Hex;
}

export interface WithdrawalNonceUse {
  txHash: Hex;
  blockNumber: bigint;
}

export interface WithdrawalGateway {
  validateConfiguration(assets: WithdrawalAssetDefinition[]): Promise<void>;
  latestBlock(): Promise<WithdrawalPinnedBlock>;
  blockByHash(hash: Hex): Promise<WithdrawalPinnedBlock | null>;
  blockByNumber(number: bigint): Promise<WithdrawalPinnedBlock | null>;
  snapshot(
    subaccountId: bigint,
    asset: WithdrawalAssetDefinition,
    blockNumber: bigint,
  ): Promise<WithdrawalSnapshot>;
  simulateAssetWithdrawal(params: {
    subaccountId: bigint;
    asset: WithdrawalAssetDefinition;
    tokenUnits: bigint;
    recipient: Address;
    accountHolder: Address;
    blockNumber: bigint;
  }): Promise<{ ok: true } | { ok: false; blocker: WithdrawalBlocker }>;
  isNonceUsed(owner: Address, nonce: bigint): Promise<boolean>;
  verifyActionSignature(
    action: Action,
    signature: Hex,
    chainId: number,
    matching: Address,
  ): Promise<boolean>;
  findActionUse(action: Action, fromBlock: bigint): Promise<WithdrawalNonceUse | null>;
  simulateAndSubmit(
    action: Action,
    signature: Hex,
    onSubmitted: (txHash: Hex) => Promise<void>,
    beforeSimulation?: () => Promise<void>,
  ): Promise<SubmitResult>;
  receipt(txHash: Hex): Promise<WithdrawalReceipt | null>;
  unresolvedTransaction(): Hex | null;
  clearUnresolvedTransaction(txHash: Hex): void;
  adoptUnresolvedTransaction(txHash: Hex): void;
  pauseForUnknownOperation(operationId: string): void;
  clearUnknownOperation(operationId: string): void;
}

export interface WithdrawalGatewayAddresses {
  matching: Address;
  withdrawalModule: Address;
  subAccounts: Address;
  standardManager: Address;
  cashAsset: Address;
}

function revertBlocker(error: unknown): WithdrawalBlocker | null {
  if (!(error instanceof BaseError)) return null;
  const reverted = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);
  if (!(reverted instanceof ContractFunctionRevertedError)) return null;
  const errorName = reverted.data?.errorName;
  const raw = (reverted.data as { raw?: Hex } | undefined)?.raw;
  const mapped = errorName ? BLOCKERS_BY_ERROR_NAME[errorName] : undefined;
  const selectorMapped = raw ? BLOCKERS_BY_SELECTOR[raw.slice(0, 10).toLowerCase()] : undefined;
  return mapped ?? selectorMapped ?? {
    code: "WITHDRAWAL_REVERTED",
    message: "the protocol rejected the withdrawal at the pinned state",
  };
}

const BLOCKERS_BY_ERROR_NAME: Record<string, WithdrawalBlocker> = {
  BM_AdjustmentsPaused: { code: "ADJUSTMENTS_PAUSED", message: "account adjustments are paused" },
  BM_AccountUnderLiquidation: {
    code: "ACCOUNT_UNDER_LIQUIDATION",
    message: "the account has a live liquidation auction",
  },
  SRM_PortfolioBelowMargin: {
    code: "INSUFFICIENT_MARGIN",
    message: "the withdrawal would put the account below initial margin",
  },
  PMRM_InsufficientMargin: {
    code: "INSUFFICIENT_MARGIN",
    message: "the withdrawal would put the account below margin",
  },
  SRM_NoNegativeCash: {
    code: "NEGATIVE_CASH_NOT_ALLOWED",
    message: "the withdrawal would create disallowed negative cash",
  },
  SRM_UnsupportedAsset: {
    code: "UNSUPPORTED_ACCOUNT_ASSET",
    message: "the account contains an unsupported manager asset",
  },
  CA_WithdrawBlockedByOngoingAuction: {
    code: "CASH_WITHDRAWALS_BLOCKED",
    message: "cash withdrawals are globally blocked by an ongoing auction",
  },
  CA_OnlyAccountOwner: {
    code: "ACCOUNT_HOLDER_CHANGED",
    message: "the subaccount holder changed during preview",
  },
  WERC_OnlyAccountOwner: {
    code: "ACCOUNT_HOLDER_CHANGED",
    message: "the subaccount holder changed during preview",
  },
  WERC_CannotBeNegative: {
    code: "INSUFFICIENT_BALANCE",
    message: "the withdrawal exceeds the collateral balance",
  },
  BM_NonceAlreadyUsed: {
    code: "NONCE_ALREADY_USED",
    message: "the manager nonce was already used",
  },
  ERC20InsufficientBalance: {
    code: "ASSET_LIQUIDITY",
    message: "the asset contract lacks enough wrapped-token liquidity",
  },
};

const BLOCKERS_BY_SELECTOR: Record<string, WithdrawalBlocker> = Object.fromEntries(
  [
    ["BM_AdjustmentsPaused()", BLOCKERS_BY_ERROR_NAME.BM_AdjustmentsPaused],
    ["BM_AccountUnderLiquidation()", BLOCKERS_BY_ERROR_NAME.BM_AccountUnderLiquidation],
    ["SRM_PortfolioBelowMargin()", BLOCKERS_BY_ERROR_NAME.SRM_PortfolioBelowMargin],
    ["PMRM_InsufficientMargin()", BLOCKERS_BY_ERROR_NAME.PMRM_InsufficientMargin],
    ["SRM_NoNegativeCash()", BLOCKERS_BY_ERROR_NAME.SRM_NoNegativeCash],
    ["SRM_UnsupportedAsset()", BLOCKERS_BY_ERROR_NAME.SRM_UnsupportedAsset],
    ["CA_WithdrawBlockedByOngoingAuction()", BLOCKERS_BY_ERROR_NAME.CA_WithdrawBlockedByOngoingAuction],
    ["CA_OnlyAccountOwner()", BLOCKERS_BY_ERROR_NAME.CA_OnlyAccountOwner],
    ["WERC_OnlyAccountOwner()", BLOCKERS_BY_ERROR_NAME.WERC_OnlyAccountOwner],
    ["WERC_CannotBeNegative()", BLOCKERS_BY_ERROR_NAME.WERC_CannotBeNegative],
    ["BM_NonceAlreadyUsed()", BLOCKERS_BY_ERROR_NAME.BM_NonceAlreadyUsed],
    ["ERC20InsufficientBalance(address,uint256,uint256)", BLOCKERS_BY_ERROR_NAME.ERC20InsufficientBalance],
  ].map(([signature, blocker]) => [toFunctionSelector(signature as string), blocker]),
) as Record<string, WithdrawalBlocker>;

function actionsEqual(candidate: Action, expected: Action): boolean {
  return (
    candidate.subaccountId === expected.subaccountId &&
    candidate.nonce === expected.nonce &&
    candidate.module.toLowerCase() === expected.module.toLowerCase() &&
    candidate.data.toLowerCase() === expected.data.toLowerCase() &&
    candidate.expiry === expected.expiry &&
    candidate.owner.toLowerCase() === expected.owner.toLowerCase() &&
    candidate.signer.toLowerCase() === expected.signer.toLowerCase()
  );
}

export class ViemWithdrawalGateway implements WithdrawalGateway {
  constructor(
    private readonly client: PublicClient,
    private readonly submitter: WithdrawalTxSubmitter,
    private readonly addresses: WithdrawalGatewayAddresses,
  ) {}

  async validateConfiguration(assets: WithdrawalAssetDefinition[]): Promise<void> {
    const contractAddresses = [
      this.addresses.matching,
      this.addresses.withdrawalModule,
      this.addresses.subAccounts,
      this.addresses.standardManager,
      this.addresses.cashAsset,
      ...assets.flatMap((asset) => [
        asset.assetAddress,
        ...(asset.configuredTokenAddress ? [asset.configuredTokenAddress] : []),
      ]),
    ];
    for (const address of [...new Set(contractAddresses.map((value) => value.toLowerCase()))]) {
      const code = await this.client.getBytecode({ address: address as Address });
      if (!code || code === "0x") throw new Error(`withdrawal dependency has no code: ${address}`);
    }

    const [allowed, moduleMatching, moduleSubAccounts] = await Promise.all([
      this.client.readContract({
        address: this.addresses.matching,
        abi: matchingAbi,
        functionName: "allowedModules",
        args: [this.addresses.withdrawalModule],
      }),
      this.client.readContract({
        address: this.addresses.withdrawalModule,
        abi: withdrawalModuleAbi,
        functionName: "matching",
        args: [],
      }),
      this.client.readContract({
        address: this.addresses.withdrawalModule,
        abi: withdrawalModuleAbi,
        functionName: "subAccounts",
        args: [],
      }),
    ]);
    if (!allowed) throw new Error("withdrawalModule is not allowed by Matching");
    if (moduleMatching.toLowerCase() !== this.addresses.matching.toLowerCase()) {
      throw new Error("withdrawalModule.matching does not match configured Matching");
    }
    if (moduleSubAccounts.toLowerCase() !== this.addresses.subAccounts.toLowerCase()) {
      throw new Error("withdrawalModule.subAccounts does not match configured SubAccounts");
    }

    for (const asset of assets) {
      const abi = asset.kind === "cash" ? cashAssetAbi : wrappedErc20AssetAbi;
      const [assetSubAccounts, wrappedAsset] = await Promise.all([
        this.client.readContract({
          address: asset.assetAddress,
          abi,
          functionName: "subAccounts",
          args: [],
        }),
        this.client.readContract({
          address: asset.assetAddress,
          abi,
          functionName: "wrappedAsset",
          args: [],
        }),
      ]);
      if (assetSubAccounts.toLowerCase() !== this.addresses.subAccounts.toLowerCase()) {
        throw new Error(`${asset.assetId} asset points at a different SubAccounts contract`);
      }
      if (
        asset.configuredTokenAddress &&
        wrappedAsset.toLowerCase() !== asset.configuredTokenAddress.toLowerCase()
      ) {
        throw new Error(`${asset.assetId} wrapped token differs from configured token`);
      }
      // Reading decimals is itself part of startup validation, including for
      // cash where the stablecoin may use 6, 8, 18, or >18 native decimals.
      const decimals = await this.client.readContract({
        address: wrappedAsset,
        abi: erc20Abi,
        functionName: "decimals",
        args: [],
      });
      if (
        asset.configuredTokenDecimals !== null &&
        decimals !== asset.configuredTokenDecimals
      ) {
        throw new Error(`${asset.assetId} token decimals differ from configured decimals`);
      }
    }
  }

  async latestBlock(): Promise<WithdrawalPinnedBlock> {
    const block = await this.client.getBlock({ blockTag: "latest" });
    if (!block.hash) throw new Error("latest block has no hash");
    return { number: block.number, hash: block.hash, timestamp: block.timestamp };
  }

  async blockByHash(hash: Hex): Promise<WithdrawalPinnedBlock | null> {
    try {
      const block = await this.client.getBlock({ blockHash: hash });
      if (!block.hash) return null;
      return { number: block.number, hash: block.hash, timestamp: block.timestamp };
    } catch {
      return null;
    }
  }

  async blockByNumber(number: bigint): Promise<WithdrawalPinnedBlock | null> {
    try {
      const block = await this.client.getBlock({ blockNumber: number });
      if (!block.hash) return null;
      return { number: block.number, hash: block.hash, timestamp: block.timestamp };
    } catch {
      return null;
    }
  }

  async snapshot(
    subaccountId: bigint,
    asset: WithdrawalAssetDefinition,
    blockNumber: bigint,
  ): Promise<WithdrawalSnapshot> {
    const assetAbi = asset.kind === "cash" ? cashAssetAbi : wrappedErc20AssetAbi;
    const [matchingOwner, withdrawTimestamp, accountHolder, manager, internalBalance, tokenAddress] =
      await Promise.all([
      this.client.readContract({
        address: this.addresses.matching,
        abi: matchingAbi,
        functionName: "subAccountToOwner",
        args: [subaccountId],
        blockNumber,
      }),
      this.client.readContract({
        address: this.addresses.matching,
        abi: matchingAbi,
        functionName: "withdrawTimestamp",
        args: [subaccountId],
        blockNumber,
      }),
      this.client.readContract({
        address: this.addresses.subAccounts,
        abi: subAccountsAbi,
        functionName: "ownerOf",
        args: [subaccountId],
        blockNumber,
      }),
      this.client.readContract({
        address: this.addresses.subAccounts,
        abi: subAccountsAbi,
        functionName: "manager",
        args: [subaccountId],
        blockNumber,
      }),
      this.client.readContract({
        address: this.addresses.subAccounts,
        abi: subAccountsAbi,
        functionName: "getBalance",
        args: [subaccountId, asset.assetAddress, 0n],
        blockNumber,
      }),
      this.client.readContract({
        address: asset.assetAddress,
        abi: assetAbi,
        functionName: "wrappedAsset",
        args: [],
        blockNumber,
      }),
      ]);

    const cashTokenAddress = asset.kind === "cash"
      ? tokenAddress
      : await this.client.readContract({
          address: this.addresses.cashAsset,
          abi: cashAssetAbi,
          functionName: "wrappedAsset",
          args: [],
          blockNumber,
        });
    const [initial, maintenance, tokenSymbol, tokenDecimals, tokenLiquidity, multiplier, cashExchangeRate, cashWithdrawFeeEnabled, cashTokenDecimals] =
      await Promise.all([
        this.client.readContract({
          address: this.addresses.standardManager,
          abi: standardManagerAbi,
          functionName: "getMarginAndMarkToMarket",
          args: [subaccountId, true, 0n],
          blockNumber,
        }),
        this.client.readContract({
          address: this.addresses.standardManager,
          abi: standardManagerAbi,
          functionName: "getMarginAndMarkToMarket",
          args: [subaccountId, false, 0n],
          blockNumber,
        }),
        this.client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "symbol",
          args: [],
          blockNumber,
        }),
        this.client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "decimals",
          args: [],
          blockNumber,
        }),
        this.client.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [asset.assetAddress],
          blockNumber,
        }),
        asset.scaledUi
          ? this.client.readContract({
              address: tokenAddress,
              abi: scaledTokenAbi,
              functionName: "uiMultiplier",
              args: [],
              blockNumber,
            })
          : Promise.resolve(ONE),
        this.client.readContract({
          address: this.addresses.cashAsset,
          abi: cashAssetAbi,
          functionName: "getCashToStableExchangeRate",
          args: [],
          blockNumber,
        }),
        this.client.readContract({
          address: this.addresses.cashAsset,
          abi: cashAssetAbi,
          functionName: "temporaryWithdrawFeeEnabled",
          args: [],
          blockNumber,
        }),
        this.client.readContract({
          address: cashTokenAddress,
          abi: erc20Abi,
          functionName: "decimals",
          args: [],
          blockNumber,
        }),
      ]);

    const cashSimulation = await this.client.simulateContract({
      address: this.addresses.cashAsset,
      abi: cashAssetAbi,
      functionName: "calculateBalanceWithInterest",
      args: [subaccountId],
      account: accountHolder,
      blockNumber,
    });

    return {
      matchingOwner,
      accountHolder,
      manager,
      withdrawTimestamp,
      internalBalance,
      cashWithInterest: cashSimulation.result,
      cashTokenDecimals,
      cashExchangeRate,
      cashWithdrawFeeEnabled,
      initialMargin: initial[0],
      initialMarkToMarket: initial[1],
      maintenanceMargin: maintenance[0],
      maintenanceMarkToMarket: maintenance[1],
      tokenAddress,
      tokenSymbol,
      tokenDecimals,
      tokenLiquidity,
      multiplier,
    };
  }

  async simulateAssetWithdrawal(params: {
    subaccountId: bigint;
    asset: WithdrawalAssetDefinition;
    tokenUnits: bigint;
    recipient: Address;
    accountHolder: Address;
    blockNumber: bigint;
  }): Promise<{ ok: true } | { ok: false; blocker: WithdrawalBlocker }> {
    try {
      await this.client.simulateContract({
        address: params.asset.assetAddress,
        abi: withdrawalSimulationAbi,
        functionName: "withdraw",
        args: [params.subaccountId, params.tokenUnits, params.recipient],
        account: params.accountHolder,
        blockNumber: params.blockNumber,
      });
      return { ok: true };
    } catch (error) {
      const blocker = revertBlocker(error);
      if (blocker) return { ok: false, blocker };
      throw error;
    }
  }

  async isNonceUsed(owner: Address, nonce: bigint): Promise<boolean> {
    return this.client.readContract({
      address: this.addresses.withdrawalModule,
      abi: withdrawalModuleAbi,
      functionName: "usedNonces",
      args: [owner, nonce],
    });
  }

  async verifyActionSignature(
    action: Action,
    signature: Hex,
    chainId: number,
    matching: Address,
  ): Promise<boolean> {
    const typedData = getActionTypedData(action, chainId, matching);
    return this.client.verifyTypedData({
      ...typedData,
      message: typedData.message as unknown as Record<string, unknown>,
      address: action.signer,
      signature,
    }).catch(() => false);
  }

  async findActionUse(
    action: Action,
    fromBlock: bigint,
  ): Promise<WithdrawalNonceUse | null> {
    const logs = await this.client.getContractEvents({
      address: this.addresses.withdrawalModule,
      abi: withdrawalModuleAbi,
      eventName: "NonceUsed",
      // nonce is non-indexed, so filter it after decoding.
      args: { owner: action.owner },
      fromBlock,
      toBlock: "latest",
      strict: true,
    });
    const candidates = logs.filter(
      (log) => log.args.nonce === action.nonce && log.transactionHash && log.blockNumber !== null,
    );
    const exact: WithdrawalNonceUse[] = [];
    for (const log of candidates) {
      const transaction = await this.client.getTransaction({ hash: log.transactionHash });
      if (transaction.from.toLowerCase() !== this.submitter.executorAddress.toLowerCase()) {
        continue;
      }
      if (!transaction.to || transaction.to.toLowerCase() !== this.addresses.matching.toLowerCase()) {
        continue;
      }
      const decoded = decodeFunctionData({ abi: matchingAbi, data: transaction.input });
      if (decoded.functionName !== "verifyAndMatch") continue;
      const actions = decoded.args[0];
      if (!actions.some((candidate) => actionsEqual(candidate, action))) continue;
      exact.push({ txHash: log.transactionHash, blockNumber: log.blockNumber });
    }
    return exact.length === 1 ? exact[0]! : null;
  }

  async simulateAndSubmit(
    action: Action,
    signature: Hex,
    onSubmitted: (txHash: Hex) => Promise<void>,
    beforeSimulation?: () => Promise<void>,
  ): Promise<SubmitResult> {
    return this.submitter.simulateAndSubmitVerifyAndMatch(
      [action],
      [signature],
      "0x",
      onSubmitted,
      beforeSimulation,
    );
  }

  async receipt(txHash: Hex): Promise<WithdrawalReceipt | null> {
    try {
      const receipt = await this.client.getTransactionReceipt({ hash: txHash });
      const canonicalBlock = await this.client.getBlock({ blockNumber: receipt.blockNumber });
      if (canonicalBlock.hash.toLowerCase() !== receipt.blockHash.toLowerCase()) return null;
      return {
        status: receipt.status,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
      };
    } catch (error) {
      if (error instanceof TransactionReceiptNotFoundError) return null;
      throw error;
    }
  }

  unresolvedTransaction(): Hex | null {
    return this.submitter.unresolvedTransaction();
  }

  clearUnresolvedTransaction(txHash: Hex): void {
    this.submitter.clearUnresolvedTransaction(txHash);
  }

  adoptUnresolvedTransaction(txHash: Hex): void {
    this.submitter.adoptUnresolvedTransaction(txHash);
  }

  pauseForUnknownOperation(operationId: string): void {
    this.submitter.pauseForUnknownOperation(operationId);
  }

  clearUnknownOperation(operationId: string): void {
    this.submitter.clearUnknownOperation(operationId);
  }
}
