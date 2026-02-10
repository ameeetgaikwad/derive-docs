import { type Chain } from "viem";

export const DERIVE_TESTNET_API = "https://api-demo.lyra.finance";
export const DERIVE_MAINNET_API = "https://api.lyra.finance";
export const DERIVE_TESTNET_WS = "wss://api-demo.lyra.finance/ws";
export const DERIVE_MAINNET_WS = "wss://api.lyra.finance/ws";

export const DERIVE_API_URL =
  process.env.NEXT_PUBLIC_DERIVE_NETWORK === "testnet"
    ? DERIVE_TESTNET_API
    : DERIVE_MAINNET_API;

// Derive Chain (OP Stack L2) - used for EIP-712 order signing
export const DERIVE_CHAIN_ID = 957;

// EIP-712 domain for order signing
export const DOMAIN_SEPARATOR = {
  name: "Derive",
  version: "1",
  chainId: DERIVE_CHAIN_ID,
};

// Action typehash for EIP-712 signing
export const ACTION_TYPEHASH =
  "Action(uint256 subaccountId,uint256 nonce,uint256 module,bytes data,uint256 expiry,address owner,address signer)";

// Module addresses for order signing (mainnet)
export const TRADE_MODULE_ADDRESS = "0xB8D20c2B7a1Ad2EE33Bc50eF10876eD3035b5e7b";
export const MATCHING_ADDRESS = "0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD";

// Deposit module addresses (mainnet)
export const DEPOSIT_MODULE_ADDRESS = "0x9B3FE5E5a3bcEa5df4E08c41Ce89C4e3Ff01Ace3";
export const STANDARD_RISK_MANAGER_ADDRESS = "0x28c9ddF9A3B29c2E6a561c1BC520954e5A33de5D";
export const USDC_ADDRESS = "0x6879287835A86F50f784313dBEd5E5cCC5bb8481"; // Derive L2 USDC

// Instrument types
export const INSTRUMENT_TYPES = {
  PERP: "perpetual",
  OPTION: "option",
  SPOT: "spot",
} as const;

// Derive Chain (L2) definition for wallet connection
export const deriveChain: Chain = {
  id: 957,
  name: "Derive",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.lyra.finance"],
    },
  },
  blockExplorers: {
    default: {
      name: "Derive Explorer",
      url: "https://explorer.lyra.finance",
    },
  },
};
