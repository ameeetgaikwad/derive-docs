import {
  encodeFunctionData,
  http,
  createPublicClient,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import {
  lyraForwardFeedAbi,
  matchingAbi,
  standardManagerAbi,
  subAccountsAbi,
  getChain,
  makeWalletClient,
  type Action,
} from "@hedge/shared";

/**
 * Read-side chain boundary — mocked in tests, viem-backed in production.
 */
export interface ChainReader {
  /** Matching.subAccountToOwner — zero address if not deposited into Matching */
  getMatchingSubaccountOwner(subaccountId: bigint): Promise<Address>;
  /** SubAccounts.getBalance(subaccountId, cashAsset, 0) — signed 18dp cash balance */
  getCashBalance(subaccountId: bigint): Promise<bigint>;
  /** Matching.tradeExecutors(address) */
  isTradeExecutor(address: Address): Promise<boolean>;
  /**
   * SRMPortfolioViewer.OIFeeRateBPS(asset) — 18dp rate the SRM charges on
   * OI-increasing trades. Read live: governance can change it at any time.
   */
  getOIFeeRateBPS(asset: Address): Promise<bigint>;
  /** LyraForwardFeed.getForwardPrice(expiry) — 18dp forward price */
  getForwardPrice(forwardFeed: Address, expiry: bigint): Promise<bigint>;
  /** StandardManager.minOIFee() — 18dp floor applied when an OI fee is charged */
  getMinOIFee(): Promise<bigint>;
}

/** BasePortfolioViewer surface the engine needs (no full ABI in shared yet). */
const srmViewerAbi = parseAbi([
  "function OIFeeRateBPS(address asset) view returns (uint256)",
]);

export interface SubmitResult {
  txHash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint | null;
}

/**
 * Write-side chain boundary. The production implementation submits
 * Matching.verifyAndMatch and waits for the receipt.
 */
export interface TxSubmitter {
  readonly executorAddress: Address;
  submitVerifyAndMatch(
    actions: Action[],
    signatures: Hex[],
    actionData: Hex,
  ): Promise<SubmitResult>;
}

/**
 * Exact calldata for Matching.verifyAndMatch(Action[], bytes[], bytes), per
 * protocol/lib/v2-matching/src/Matching.sol. Exposed so tests can assert the
 * args byte-for-byte.
 */
export function buildVerifyAndMatchCalldata(
  actions: Action[],
  signatures: Hex[],
  actionData: Hex,
): Hex {
  return encodeFunctionData({
    abi: matchingAbi,
    functionName: "verifyAndMatch",
    args: [actions, signatures, actionData],
  });
}

export interface ChainAddresses {
  matching: Address;
  subAccounts: Address;
  cashAsset: Address;
  /** SRMPortfolioViewer (deployments key "srmViewer") — OI fee rate reads */
  srmViewer: Address;
  /** StandardManager — minOIFee reads */
  standardManager: Address;
}

export class ViemChainReader implements ChainReader {
  constructor(
    private readonly client: PublicClient,
    private readonly addresses: ChainAddresses,
  ) {}

  async getMatchingSubaccountOwner(subaccountId: bigint): Promise<Address> {
    return this.client.readContract({
      address: this.addresses.matching,
      abi: matchingAbi,
      functionName: "subAccountToOwner",
      args: [subaccountId],
    });
  }

  async getCashBalance(subaccountId: bigint): Promise<bigint> {
    return this.client.readContract({
      address: this.addresses.subAccounts,
      abi: subAccountsAbi,
      functionName: "getBalance",
      args: [subaccountId, this.addresses.cashAsset, 0n],
    });
  }

  async isTradeExecutor(address: Address): Promise<boolean> {
    return this.client.readContract({
      address: this.addresses.matching,
      abi: matchingAbi,
      functionName: "tradeExecutors",
      args: [address],
    });
  }

  async getOIFeeRateBPS(asset: Address): Promise<bigint> {
    return this.client.readContract({
      address: this.addresses.srmViewer,
      abi: srmViewerAbi,
      functionName: "OIFeeRateBPS",
      args: [asset],
    });
  }

  async getForwardPrice(forwardFeed: Address, expiry: bigint): Promise<bigint> {
    const [forwardPrice] = await this.client.readContract({
      address: forwardFeed,
      abi: lyraForwardFeedAbi,
      functionName: "getForwardPrice",
      args: [expiry],
    });
    return forwardPrice;
  }

  async getMinOIFee(): Promise<bigint> {
    return this.client.readContract({
      address: this.addresses.standardManager,
      abi: standardManagerAbi,
      functionName: "minOIFee",
      args: [],
    });
  }
}

export class ViemTxSubmitter implements TxSubmitter {
  readonly executorAddress: Address;

  constructor(
    private readonly wallet: WalletClient,
    private readonly publicClient: PublicClient,
    private readonly matching: Address,
    account: Account,
  ) {
    this.executorAddress = account.address;
  }

  async submitVerifyAndMatch(
    actions: Action[],
    signatures: Hex[],
    actionData: Hex,
  ): Promise<SubmitResult> {
    const account = this.wallet.account;
    if (!account) throw new Error("wallet client has no account");
    const txHash = await this.wallet.writeContract({
      address: this.matching,
      abi: matchingAbi,
      functionName: "verifyAndMatch",
      args: [actions, signatures, actionData],
      chain: this.wallet.chain,
      account,
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    return {
      txHash,
      status: receipt.status === "success" ? "success" : "reverted",
      blockNumber: receipt.blockNumber,
    };
  }
}

/** Convenience factory wiring viem clients for a given RPC/chain. */
export function makeViemChain(params: {
  chainId: number;
  rpcUrl: string;
  account: Account;
  addresses: ChainAddresses;
}): { reader: ViemChainReader; submitter: ViemTxSubmitter; publicClient: PublicClient } {
  const chain = getChain(params.chainId);
  const transport = http(params.rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  // shared factory: forces legacy gas on BSC testnet (97); plain client elsewhere
  const walletClient = makeWalletClient(params.account, {
    chainId: params.chainId,
    rpcUrl: params.rpcUrl,
  });
  return {
    reader: new ViemChainReader(publicClient, params.addresses),
    submitter: new ViemTxSubmitter(
      walletClient,
      publicClient,
      params.addresses.matching,
      params.account,
    ),
    publicClient,
  };
}
