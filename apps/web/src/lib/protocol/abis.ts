/**
 * Minimal ABIs for the sats-options frontend.
 *
 * Fragments copied verbatim from services/shared/src/abis/* (which are
 * auto-extracted from the vendored forge artifacts in protocol/lib/*).
 * Only the entries the frontend actually calls are included so the bundle
 * stays small and browser-safe.
 */

export const matchingAbi = [
  {
    type: "function",
    name: "ACTION_TYPEHASH",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "createSubAccount",
    inputs: [
      { name: "manager", type: "address", internalType: "contract IManager" },
    ],
    outputs: [{ name: "accountId", type: "uint256", internalType: "uint256" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "domainSeparator",
    inputs: [],
    outputs: [{ name: "", type: "bytes32", internalType: "bytes32" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "subAccountToOwner",
    inputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    outputs: [{ name: "", type: "address", internalType: "address" }],
    stateMutability: "view",
  },
] as const;

export const subAccountsAbi = [
  {
    type: "function",
    name: "getAccountBalances",
    inputs: [{ name: "accountId", type: "uint256", internalType: "uint256" }],
    outputs: [
      {
        name: "assetBalances",
        type: "tuple[]",
        internalType: "struct ISubAccounts.AssetBalance[]",
        components: [
          { name: "asset", type: "address", internalType: "contract IAsset" },
          { name: "subId", type: "uint256", internalType: "uint256" },
          { name: "balance", type: "int256", internalType: "int256" },
        ],
      },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getBalance",
    inputs: [
      { name: "accountId", type: "uint256", internalType: "uint256" },
      { name: "asset", type: "address", internalType: "contract IAsset" },
      { name: "subId", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "balance", type: "int256", internalType: "int256" }],
    stateMutability: "view",
  },
  {
    type: "event",
    name: "AccountCreated",
    inputs: [
      { name: "owner", type: "address", indexed: true, internalType: "address" },
      {
        name: "accountId",
        type: "uint256",
        indexed: true,
        internalType: "uint256",
      },
      {
        name: "manager",
        type: "address",
        indexed: true,
        internalType: "address",
      },
    ],
    anonymous: false,
  },
] as const;

export const wrappedErc20AssetAbi = [
  {
    type: "function",
    name: "deposit",
    inputs: [
      { name: "recipientAccount", type: "uint256", internalType: "uint256" },
      { name: "assetAmount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "wrappedAsset",
    inputs: [],
    outputs: [
      { name: "", type: "address", internalType: "contract IERC20Metadata" },
    ],
    stateMutability: "view",
  },
] as const;

/** Mock BTCB/USDT on testnet: standard ERC20 plus an unrestricted mint. */
export const mockErc20Abi = [
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8", internalType: "uint8" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address", internalType: "address" },
      { name: "spender", type: "address", internalType: "address" },
    ],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [{ name: "", type: "bool", internalType: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "mint",
    inputs: [
      { name: "account", type: "address", internalType: "address" },
      { name: "amount", type: "uint256", internalType: "uint256" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

export const scaledUiTokenAbi = [
  {
    type: "function",
    name: "uiMultiplier",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const multiplierRegistryAbi = [
  {
    type: "function",
    name: "multiplierAt",
    inputs: [{ name: "timestamp", type: "uint64", internalType: "uint64" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;

export const lyraSpotFeedAbi = [
  {
    type: "function",
    name: "getSpot",
    inputs: [],
    outputs: [
      { name: "", type: "uint256", internalType: "uint256" },
      { name: "", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;

export const lyraVolFeedAbi = [
  {
    type: "function",
    name: "getVol",
    inputs: [
      { name: "strike", type: "uint128", internalType: "uint128" },
      { name: "expiry", type: "uint64", internalType: "uint64" },
    ],
    outputs: [
      { name: "vol", type: "uint256", internalType: "uint256" },
      { name: "confidence", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;

export const lyraForwardFeedAbi = [
  {
    type: "function",
    name: "getForwardPrice",
    inputs: [{ name: "expiry", type: "uint64", internalType: "uint64" }],
    outputs: [
      { name: "", type: "uint256", internalType: "uint256" },
      { name: "", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
  {
    type: "function",
    name: "getSettlementPrice",
    inputs: [{ name: "expiry", type: "uint64", internalType: "uint64" }],
    outputs: [
      { name: "settled", type: "bool", internalType: "bool" },
      { name: "price", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;

export const lyraRateFeedAbi = [
  {
    type: "function",
    name: "getInterestRate",
    inputs: [{ name: "expiry", type: "uint64", internalType: "uint64" }],
    outputs: [
      { name: "", type: "int256", internalType: "int256" },
      { name: "", type: "uint256", internalType: "uint256" },
    ],
    stateMutability: "view",
  },
] as const;

/** Fee surface inherited by StandardManager from BaseManager. */
export const standardManagerFeeAbi = [
  {
    type: "function",
    name: "minOIFee",
    inputs: [],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;

/** Live per-asset OI fee multiplier configured on SRMPortfolioViewer. */
export const srmPortfolioViewerAbi = [
  {
    type: "function",
    name: "OIFeeRateBPS",
    inputs: [{ name: "asset", type: "address", internalType: "address" }],
    outputs: [{ name: "", type: "uint256", internalType: "uint256" }],
    stateMutability: "view",
  },
] as const;
